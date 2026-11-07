//! Unit tests: every mandatory BILA scenario, asserted on contract state and on
//! the transfer receipts actually scheduled — not just on return values.

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const DAY: u64 = 86_400 * 1_000_000_000;
/// Monday 2026-11-02 00:00:00 UTC
const MON: u64 = 20_759 * DAY;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("baron.testnet")
}
fn bot() -> AccountId {
    acc("researchbot.testnet")
}
fn vendor() -> AccountId {
    acc("data-vendor.testnet")
}
fn contract() -> AccountId {
    acc("bila.testnet")
}

fn ctx(predecessor: AccountId, deposit: u128, ts: u64) {
    ctx_with(predecessor, deposit, ts, vec![]);
}

fn ctx_with(predecessor: AccountId, deposit: u128, ts: u64, results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(1_000))
        .block_timestamp(ts);
    testing_env!(b.build(), near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), results);
}

/// Callback context: predecessor is the contract itself (#[private]).
fn callback(c: &mut BilaCore, payment_id: u64, ok: bool, ts: u64) -> PaymentOutcome {
    let r = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
    ctx_with(contract(), 0, ts, vec![r]);
    c.on_payment_settled(U64(payment_id), if ok { Ok(()) } else { Err(PromiseError::Failed) })
}

/// Spec example scaled to NEAR: 10/day, 40/week, 100/month, max 2.5 per tx.
fn default_policy() -> Policy {
    Policy {
        daily_limit: U128(10 * NEAR),
        weekly_limit: U128(40 * NEAR),
        monthly_limit: U128(100 * NEAR),
        max_transaction: U128(5 * NEAR / 2),
        allowed_recipients: None,
    }
}

fn setup_with(treasury: u128, policy: Policy) -> BilaCore {
    ctx(owner(), 0, MON);
    let mut c = BilaCore::new();
    ctx(owner(), NEAR, MON);
    c.storage_deposit();
    ctx(owner(), treasury, MON);
    c.deposit();
    ctx(owner(), NEAR / 10, MON);
    c.register_agent(bot(), "ResearchBot".into(), policy);
    c
}

fn setup() -> BilaCore {
    setup_with(500 * NEAR, default_policy())
}

/// Agent requests a payment. Returns (outcome-if-value, payment_id-if-promise, transfers scheduled).
fn pay(c: &mut BilaCore, req: &str, to: AccountId, amount: u128, ts: u64) -> (Option<PaymentOutcome>, Option<u64>, Vec<(AccountId, u128)>) {
    ctx(bot(), 0, ts);
    let next_id = c.next_payment_id;
    let res = c.request_payment(req.into(), to, U128(amount), None);
    // Promises are scheduled when dropped; inspect receipts afterwards.
    let (o, pid) = match res {
        PromiseOrValue::Value(o) => (Some(o), None),
        PromiseOrValue::Promise(p) => {
            drop(p);
            (None, Some(next_id))
        }
    };
    (o, pid, transfers())
}

fn transfers() -> Vec<(AccountId, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.clone();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => Some((to.clone(), deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

fn pay_and_settle(c: &mut BilaCore, req: &str, amount: u128, ts: u64) {
    let (o, pid, _) = pay(c, req, vendor(), amount, ts);
    assert!(o.is_none(), "expected approval, got {:?}", o);
    let out = callback(c, pid.unwrap(), true, ts);
    assert_eq!(out.status, OutcomeStatus::Settled);
}

fn rejected(o: Option<PaymentOutcome>) -> RejectReason {
    let o = o.expect("expected a rejection value, got an approved promise");
    assert_eq!(o.status, OutcomeStatus::Rejected);
    o.reason.unwrap()
}

fn owner_state(c: &BilaCore) -> OwnerView {
    c.get_owner(owner()).unwrap()
}

// ---------------------------------------------------------------------
// 1. Within budget: approved, reserved, transfer scheduled, then settled.
#[test]
fn payment_within_budget_settles() {
    let mut c = setup();
    let before = owner_state(&c).balance.0;
    let (o, pid, tx) = pay(&mut c, "r1", vendor(), 3 * NEAR / 2, MON + 100);
    assert!(o.is_none());
    assert_eq!(tx, vec![(vendor(), 3 * NEAR / 2)], "exactly one transfer of the requested amount");
    assert_eq!(owner_state(&c).reserved.0, 3 * NEAR / 2);
    assert_eq!(c.get_payment(U64(pid.unwrap())).unwrap().status, PaymentStatus::Pending);

    callback(&mut c, pid.unwrap(), true, MON + 200);
    let o = owner_state(&c);
    assert_eq!(o.reserved.0, 0);
    assert_eq!(o.balance.0, before - 3 * NEAR / 2);
    assert_eq!(o.total_settled.0, 3 * NEAR / 2);
    assert_eq!(c.get_payment(U64(pid.unwrap())).unwrap().status, PaymentStatus::Settled);
}

// 2. Per-transaction limit.
#[test]
fn exceeds_max_transaction() {
    let mut c = setup();
    let (o, _, tx) = pay(&mut c, "r1", vendor(), 4 * NEAR, MON);
    assert_eq!(rejected(o), RejectReason::ExceedsMaxTransaction);
    assert!(tx.is_empty(), "no transfer may be scheduled");
    assert_eq!(owner_state(&c).reserved.0, 0);
    assert_eq!(c.get_agent(U64(1)).unwrap().rejected_count.0, 1);
}

// 3. Daily allowance exhausted while weekly/monthly still have room.
#[test]
fn exceeds_daily_allowance() {
    let mut c = setup();
    for i in 0..4 {
        pay_and_settle(&mut c, &format!("d{i}"), 5 * NEAR / 2, MON + i);
    }
    let a = c.get_agent(U64(1)).unwrap();
    assert_eq!(a.budget.remaining_today.0, 0);
    assert_eq!(a.budget.remaining_this_week.0, 30 * NEAR);
    let (o, _, tx) = pay(&mut c, "d5", vendor(), NEAR, MON + 10);
    assert_eq!(rejected(o), RejectReason::ExceedsDailyLimit);
    assert!(tx.is_empty());
    // Next UTC day: allowed again.
    let (o, _, _) = pay(&mut c, "d6", vendor(), NEAR, MON + DAY);
    assert!(o.is_none());
}

// 4. Weekly allowance (Mon..Sun UTC).
#[test]
fn exceeds_weekly_allowance() {
    let mut c = setup();
    for day in 0..4u64 {
        for i in 0..4 {
            pay_and_settle(&mut c, &format!("w{day}-{i}"), 5 * NEAR / 2, MON + day * DAY + i);
        }
    }
    // Friday: daily fresh, weekly exhausted.
    let fri = MON + 4 * DAY;
    let (o, _, tx) = pay(&mut c, "w-fri", vendor(), NEAR, fri);
    assert_eq!(rejected(o), RejectReason::ExceedsWeeklyLimit);
    assert!(tx.is_empty());
    // Next Monday: new week.
    let (o, _, _) = pay(&mut c, "w-next", vendor(), NEAR, MON + 7 * DAY);
    assert!(o.is_none());
}

// 5. Monthly allowance (calendar month UTC).
#[test]
fn exceeds_monthly_allowance() {
    let mut p = default_policy();
    p.monthly_limit = U128(45 * NEAR);
    let mut c = setup_with(500 * NEAR, p);
    for day in 0..4u64 {
        for i in 0..4 {
            pay_and_settle(&mut c, &format!("m{day}-{i}"), 5 * NEAR / 2, MON + day * DAY + i);
        }
    }
    let week2 = MON + 7 * DAY; // 2026-11-09
    pay_and_settle(&mut c, "m-w2a", 5 * NEAR / 2, week2);
    pay_and_settle(&mut c, "m-w2b", 5 * NEAR / 2, week2 + 1);
    let (o, _, tx) = pay(&mut c, "m-over", vendor(), NEAR, week2 + 2);
    assert_eq!(rejected(o), RejectReason::ExceedsMonthlyLimit);
    assert!(tx.is_empty());
    // 2026-12-01 = day 20_788: new month.
    let (o, _, _) = pay(&mut c, "m-dec", vendor(), NEAR, 20_788 * DAY);
    assert!(o.is_none());
}

// 6. Insufficient treasury funds.
#[test]
fn insufficient_treasury() {
    let mut c = setup_with(2 * NEAR, default_policy());
    let (o, _, tx) = pay(&mut c, "r1", vendor(), 5 * NEAR / 2, MON);
    assert_eq!(rejected(o), RejectReason::InsufficientTreasury);
    assert!(tx.is_empty());
}

// 7. Unregistered agent.
#[test]
fn unregistered_agent_rejected() {
    let mut c = setup();
    ctx(acc("rogue.testnet"), 0, MON);
    let res = c.request_payment("x".into(), vendor(), U128(NEAR), None);
    let PromiseOrValue::Value(o) = res else { panic!("must not approve") };
    assert_eq!(o.reason, Some(RejectReason::UnregisteredAgent));
    assert!(transfers().is_empty());
}

// 8. Paused agent.
#[test]
fn paused_agent_rejected() {
    let mut c = setup();
    ctx(owner(), 0, MON);
    c.pause_agent(U64(1));
    let (o, _, tx) = pay(&mut c, "r1", vendor(), NEAR, MON);
    assert_eq!(rejected(o), RejectReason::AgentPaused);
    assert!(tx.is_empty());
    assert_eq!(c.get_agent(U64(1)).unwrap().budget.spendable_now.0, 0);
    // Resume needs the owner's full-access key (1 yocto).
    ctx(owner(), 1, MON);
    c.resume_agent(U64(1));
    let (o, _, _) = pay(&mut c, "r2", vendor(), NEAR, MON);
    assert!(o.is_none());
}

// 9. Agent cannot touch its own controls.
#[test]
#[should_panic(expected = "only the agent's owner")]
fn agent_cannot_modify_own_budget() {
    let mut c = setup();
    let p = Policy {
        daily_limit: U128(1_000 * NEAR),
        weekly_limit: U128(1_000 * NEAR),
        monthly_limit: U128(1_000 * NEAR),
        max_transaction: U128(1_000 * NEAR),
        allowed_recipients: None,
    };
    ctx(bot(), 1, MON);
    c.set_policy(U64(1), p);
}

#[test]
#[should_panic(expected = "only the agent's owner")]
fn agent_cannot_resume_itself() {
    let mut c = setup();
    ctx(owner(), 0, MON);
    c.pause_agent(U64(1));
    ctx(bot(), 1, MON);
    c.resume_agent(U64(1));
}

#[test]
#[should_panic(expected = "owner not found")]
fn agent_cannot_withdraw_treasury() {
    let mut c = setup();
    ctx(bot(), 1, MON);
    let _ = c.withdraw(U128(NEAR));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn set_policy_requires_full_access_key() {
    let mut c = setup();
    ctx(owner(), 0, MON);
    c.set_policy(U64(1), default_policy());
}

// 10. Duplicate request: no second transfer, no double reservation.
#[test]
fn duplicate_request_is_idempotent() {
    let mut c = setup();
    let (_, pid, tx1) = pay(&mut c, "same-id", vendor(), 2 * NEAR, MON);
    assert_eq!(tx1.len(), 1);
    let (o, _, tx2) = pay(&mut c, "same-id", vendor(), 2 * NEAR, MON + 1);
    let o = o.expect("duplicate must return a value");
    assert!(o.duplicate);
    assert_eq!(o.payment_id, Some(U64(pid.unwrap())));
    assert!(tx2.is_empty(), "duplicate must not schedule a transfer");
    assert_eq!(owner_state(&c).reserved.0, 2 * NEAR);
    // Same id, different params -> conflict, still no transfer.
    let (o, _, tx3) = pay(&mut c, "same-id", vendor(), NEAR, MON + 2);
    assert_eq!(rejected(o), RejectReason::IdempotencyConflict);
    assert!(tx3.is_empty());
}

// 11. Two in-flight requests cannot jointly exceed a budget.
#[test]
fn concurrent_requests_cannot_overspend() {
    let mut p = default_policy();
    p.daily_limit = U128(3 * NEAR);
    p.max_transaction = U128(2 * NEAR);
    let mut c = setup_with(500 * NEAR, p);
    // Both submitted before either settles.
    let (o1, pid1, tx1) = pay(&mut c, "c1", vendor(), 2 * NEAR, MON);
    let (o2, _, tx2) = pay(&mut c, "c2", vendor(), 2 * NEAR, MON);
    assert!(o1.is_none() && tx1.len() == 1);
    assert_eq!(rejected(o2), RejectReason::ExceedsDailyLimit);
    assert!(tx2.is_empty());
    assert_eq!(owner_state(&c).reserved.0, 2 * NEAR);
    callback(&mut c, pid1.unwrap(), true, MON + 5);
}

#[test]
fn concurrent_requests_cannot_overdraw_treasury() {
    let mut c = setup_with(3 * NEAR, default_policy());
    let (o1, _, _) = pay(&mut c, "t1", vendor(), 2 * NEAR, MON);
    let (o2, _, tx2) = pay(&mut c, "t2", vendor(), 2 * NEAR, MON);
    assert!(o1.is_none());
    assert_eq!(rejected(o2), RejectReason::InsufficientTreasury);
    assert!(tx2.is_empty());
}

// 12. Settlement fails after reservation: everything released.
#[test]
fn failed_settlement_releases_reservation() {
    let mut c = setup();
    let before = owner_state(&c);
    let (_, pid, _) = pay(&mut c, "f1", vendor(), 2 * NEAR, MON);
    assert_eq!(c.get_agent(U64(1)).unwrap().budget.spent_today.0, 2 * NEAR);
    let out = callback(&mut c, pid.unwrap(), false, MON + 5);
    assert_eq!(out.status, OutcomeStatus::Failed);
    let after = owner_state(&c);
    assert_eq!(after.reserved.0, 0);
    assert_eq!(after.balance.0, before.balance.0);
    assert_eq!(after.total_settled.0, 0);
    let a = c.get_agent(U64(1)).unwrap();
    assert_eq!(a.budget.spent_today.0, 0);
    assert_eq!(a.reserved.0, 0);
    assert_eq!(c.get_payment(U64(pid.unwrap())).unwrap().status, PaymentStatus::Failed);
}

#[test]
fn failure_after_period_rollover_does_not_corrupt_new_period() {
    let mut c = setup();
    let (_, pid, _) = pay(&mut c, "late", vendor(), 2 * NEAR, MON + DAY - 1);
    pay_and_settle(&mut c, "next-day", NEAR, MON + DAY);
    callback(&mut c, pid.unwrap(), false, MON + DAY + 1);
    // Next day's counter must keep its own 1 NEAR.
    assert_eq!(c.get_agent(U64(1)).unwrap().budget.spent_today.0, NEAR);
}

#[test]
#[should_panic(expected = "payment already resolved")]
fn callback_cannot_resolve_twice() {
    let mut c = setup();
    let (_, pid, _) = pay(&mut c, "x", vendor(), NEAR, MON);
    callback(&mut c, pid.unwrap(), true, MON);
    callback(&mut c, pid.unwrap(), false, MON);
}

#[test]
#[should_panic(expected = "callback is private")]
fn callback_is_private() {
    let mut c = setup();
    let (_, pid, _) = pay(&mut c, "x", vendor(), NEAR, MON);
    ctx_with(bot(), 0, MON, vec![PromiseResult::Failed]);
    c.on_payment_settled(U64(pid.unwrap()), Err(PromiseError::Failed));
}

// 13. Revoked agent.
#[test]
fn revoked_agent_rejected() {
    let mut c = setup();
    ctx(owner(), 0, MON);
    c.revoke_agent(U64(1));
    let (o, _, tx) = pay(&mut c, "r1", vendor(), NEAR, MON);
    assert_eq!(rejected(o), RejectReason::AgentRevoked);
    assert!(tx.is_empty());
}

#[test]
#[should_panic(expected = "agent is not paused")]
fn revoked_agent_cannot_be_resumed() {
    let mut c = setup();
    ctx(owner(), 0, MON);
    c.revoke_agent(U64(1));
    ctx(owner(), 1, MON);
    c.resume_agent(U64(1));
}

// 14. Owner cannot withdraw reserved funds.
#[test]
#[should_panic(expected = "amount exceeds unreserved balance")]
fn owner_cannot_withdraw_reserved_funds() {
    let mut c = setup_with(10 * NEAR, default_policy());
    pay(&mut c, "r1", vendor(), 5 * NEAR / 2, MON);
    ctx(owner(), 1, MON);
    let _ = c.withdraw(U128(10 * NEAR));
}

#[test]
fn owner_can_withdraw_unreserved_funds() {
    let mut c = setup_with(10 * NEAR, default_policy());
    pay(&mut c, "r1", vendor(), 5 * NEAR / 2, MON);
    ctx(owner(), 1, MON);
    let _ = c.withdraw(U128(15 * NEAR / 2));
    assert_eq!(transfers(), vec![(owner(), 15 * NEAR / 2)]);
    let o = owner_state(&c);
    assert_eq!(o.available.0, 0);
    assert_eq!(o.reserved.0, 5 * NEAR / 2);
    // Failed withdrawal restores the balance.
    ctx_with(contract(), 0, MON, vec![PromiseResult::Failed]);
    c.on_withdraw(owner(), U128(15 * NEAR / 2), Err(PromiseError::Failed));
    assert_eq!(owner_state(&c).available.0, 15 * NEAR / 2);
}

// ---- extra enforcement ----

#[test]
fn recipient_allowlist_enforced() {
    let mut p = default_policy();
    p.allowed_recipients = Some(vec![vendor()]);
    let mut c = setup_with(500 * NEAR, p);
    let (o, _, tx) = pay(&mut c, "a1", acc("unknown.testnet"), NEAR, MON);
    assert_eq!(rejected(o), RejectReason::RecipientNotAllowed);
    assert!(tx.is_empty());
    let (o, _, _) = pay(&mut c, "a2", vendor(), NEAR, MON);
    assert!(o.is_none());
}

#[test]
fn agent_cannot_pay_itself_or_contract() {
    let mut c = setup();
    let (o, _, _) = pay(&mut c, "s1", bot(), NEAR, MON);
    assert_eq!(rejected(o), RejectReason::ForbiddenRecipient);
    let (o, _, _) = pay(&mut c, "s2", contract(), NEAR, MON);
    assert_eq!(rejected(o), RejectReason::ForbiddenRecipient);
}

#[test]
fn zero_and_bad_request_rejected() {
    let mut c = setup();
    let (o, _, _) = pay(&mut c, "z", vendor(), 0, MON);
    assert_eq!(rejected(o), RejectReason::InvalidAmount);
    let (o, _, _) = pay(&mut c, "bad id with spaces", vendor(), NEAR, MON);
    assert_eq!(rejected(o), RejectReason::InvalidRequestId);
}

#[test]
fn pending_expiry_is_conservative_and_correctable() {
    let mut c = setup();
    let start = owner_state(&c).balance.0;
    let (_, pid, _) = pay(&mut c, "e1", vendor(), 2 * NEAR, MON);
    ctx(owner(), 0, MON + PENDING_EXPIRY_NS);
    let p = c.expire_payment(U64(pid.unwrap()));
    assert_eq!(p.status, PaymentStatus::Expired);
    let o = owner_state(&c);
    assert_eq!(o.reserved.0, 0);
    assert_eq!(o.balance.0, start - 2 * NEAR, "expired counts as spent");
    // A late failure callback restores funds.
    callback(&mut c, pid.unwrap(), false, MON + PENDING_EXPIRY_NS + 1);
    assert_eq!(owner_state(&c).balance.0, start);
}

#[test]
#[should_panic(expected = "payment has not reached expiry")]
fn cannot_expire_early() {
    let mut c = setup();
    let (_, pid, _) = pay(&mut c, "e1", vendor(), NEAR, MON);
    ctx(owner(), 0, MON + 1);
    c.expire_payment(U64(pid.unwrap()));
}

#[test]
#[should_panic(expected = "max_transaction must be <= daily_limit")]
fn incoherent_policy_rejected() {
    let mut p = default_policy();
    p.max_transaction = U128(11 * NEAR);
    setup_with(10 * NEAR, p);
}

#[test]
#[should_panic(expected = "requires a full-access key")]
fn register_requires_deposit() {
    ctx(owner(), 0, MON);
    let mut c = BilaCore::new();
    c.register_agent(bot(), "x".into(), default_policy());
}

#[test]
fn storage_is_charged_to_owner() {
    let mut c = setup();
    let s0 = owner_state(&c).storage_balance.0;
    pay(&mut c, "s1", vendor(), NEAR, MON);
    let s1 = owner_state(&c).storage_balance.0;
    assert!(s1 < s0, "payment record storage must be paid by the owner");
}

#[test]
fn history_newest_first() {
    let mut c = setup();
    pay_and_settle(&mut c, "h1", NEAR, MON);
    pay_and_settle(&mut c, "h2", NEAR, MON + 1);
    let h = c.list_agent_payments(U64(1), None, None);
    assert_eq!(h.iter().map(|p| p.request_id.as_str()).collect::<Vec<_>>(), vec!["h2", "h1"]);
}

#[test]
fn check_payment_dry_run_matches_enforcement() {
    let c = setup();
    ctx(bot(), 0, MON);
    let ok = c.check_payment(U64(1), vendor(), U128(NEAR));
    assert!(ok.allowed);
    let bad = c.check_payment(U64(1), vendor(), U128(3 * NEAR));
    assert_eq!(bad.reason, Some(RejectReason::ExceedsMaxTransaction));
}
