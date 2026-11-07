//! BILA core contract.
//!
//! Enforces, on-chain and independently of any AI model or backend:
//! - who may spend (registered, active agent; caller == agent account)
//! - how much (per-tx, daily, weekly, monthly; reserved atomically at request time)
//! - to whom (optional allowlist; never to itself, the agent, or this contract)
//! - from what (owner's restricted treasury; owners withdraw only unreserved funds)
//!
//! Loosening controls (register, set_policy, resume, withdraw) requires 1 yoctoNEAR,
//! which only a full-access key (the owner's wallet) can attach. Tightening controls
//! (pause, revoke) need no deposit so they work as an emergency switch.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

mod periods;
mod types;

pub use periods::{periods_at, Periods};
pub use types::*;

const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(15);
const MAX_AGENTS_PER_OWNER: usize = 50;
const MAX_RECIPIENTS: usize = 50;
const MAX_NAME_LEN: usize = 48;
const MAX_REQUEST_ID_LEN: usize = 64;
const MAX_MEMO_LEN: usize = 140;
/// Storage headroom an owner must hold before a payment is accepted.
const PAYMENT_STORAGE_PRECHECK_BYTES: u64 = 1_000;
/// After this window a Pending payment may be expired by its owner.
pub const PENDING_EXPIRY_NS: u64 = 15 * 60 * 1_000_000_000;
const MAX_PAGE: u64 = 100;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Owners,
    Agents,
    AgentByAccount,
    Payments,
    Idempotency,
    AgentPayments,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct BilaCore {
    owners: LookupMap<AccountId, Owner>,
    agents: LookupMap<AgentId, Agent>,
    agent_by_account: LookupMap<AccountId, AgentId>,
    payments: LookupMap<PaymentId, Payment>,
    /// "agent_id:request_id" -> payment id
    idempotency: LookupMap<String, PaymentId>,
    /// (agent_id, index) -> payment id, for paginated history
    agent_payments: LookupMap<(AgentId, u64), PaymentId>,
    next_agent_id: AgentId,
    next_payment_id: PaymentId,
}

#[near]
impl BilaCore {
    #[init]
    pub fn new() -> Self {
        Self {
            owners: LookupMap::new(StorageKey::Owners),
            agents: LookupMap::new(StorageKey::Agents),
            agent_by_account: LookupMap::new(StorageKey::AgentByAccount),
            payments: LookupMap::new(StorageKey::Payments),
            idempotency: LookupMap::new(StorageKey::Idempotency),
            agent_payments: LookupMap::new(StorageKey::AgentPayments),
            next_agent_id: 1,
            next_payment_id: 1,
        }
    }

    // =====================================================================
    // Owner: treasury
    // =====================================================================

    /// Fund the caller's restricted treasury with the attached NEAR.
    #[payable]
    pub fn deposit(&mut self) -> OwnerView {
        let owner_id = env::predecessor_account_id();
        let mut amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach NEAR to deposit");
        let before = env::storage_usage();
        let mut owner = self.owners.get(&owner_id).cloned().unwrap_or_else(Owner::new);
        let is_new = !self.owners.contains_key(&owner_id);
        if is_new {
            // First deposit pays for the owner record itself.
            self.owners.insert(owner_id.clone(), owner.clone());
            self.owners.flush();
            let cost = storage_cost(env::storage_usage().saturating_sub(before));
            require!(amount > cost, "deposit too small to cover owner record storage");
            amount -= cost;
        }
        owner.balance = add(owner.balance, amount);
        owner.total_deposited = add(owner.total_deposited, amount);
        self.owners.insert(owner_id.clone(), owner.clone());
        emit("deposit", json!({ "owner": owner_id, "amount": U128(amount) }));
        self.owner_view(&owner_id, &owner)
    }

    /// Add NEAR to the caller's storage balance (pays for agent and payment records).
    #[payable]
    pub fn storage_deposit(&mut self) -> OwnerView {
        let owner_id = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach NEAR for storage");
        let mut owner = self.owners.get(&owner_id).cloned().unwrap_or_else(Owner::new);
        owner.storage_balance = add(owner.storage_balance, amount);
        let before = env::storage_usage();
        self.owners.insert(owner_id.clone(), owner);
        self.owners.flush();
        self.charge_storage(&owner_id, before);
        let owner = self.owners.get(&owner_id).unwrap().clone();
        self.owner_view(&owner_id, &owner)
    }

    /// Withdraw unreserved treasury funds to the owner's own account.
    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let owner_id = env::predecessor_account_id();
        let amount = amount.0;
        let mut owner = self.expect_owner(&owner_id);
        require!(amount > 0, "amount must be > 0");
        require!(amount <= owner.available(), "amount exceeds unreserved balance");
        owner.balance -= amount;
        owner.total_withdrawn = add(owner.total_withdrawn, amount);
        self.owners.insert(owner_id.clone(), owner);
        emit("withdraw_started", json!({ "owner": owner_id, "amount": U128(amount) }));
        Promise::new(owner_id.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_withdraw(owner_id, U128(amount)),
            )
    }

    #[private]
    pub fn on_withdraw(
        &mut self,
        owner_id: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        assert_self();
        if result.is_ok() {
            emit("withdraw_settled", json!({ "owner": owner_id, "amount": amount }));
            return true;
        }
        let mut owner = self.expect_owner(&owner_id);
        owner.balance = add(owner.balance, amount.0);
        owner.total_withdrawn -= amount.0;
        self.owners.insert(owner_id.clone(), owner);
        emit("withdraw_failed", json!({ "owner": owner_id, "amount": amount }));
        false
    }

    // =====================================================================
    // Owner: agents and policies
    // =====================================================================

    /// Register an agent. Attached deposit goes to the owner's storage balance.
    #[payable]
    pub fn register_agent(
        &mut self,
        agent_account: AccountId,
        name: String,
        policy: Policy,
    ) -> AgentView {
        let owner_id = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= 1, "requires a full-access key (attach at least 1 yoctoNEAR)");
        require!(agent_account != owner_id, "agent account must differ from owner");
        require!(agent_account != env::current_account_id(), "agent cannot be this contract");
        require!(
            !self.agent_by_account.contains_key(&agent_account),
            "account already registered as an agent"
        );
        require!(!name.is_empty() && name.len() <= MAX_NAME_LEN, "invalid agent name");
        validate_policy(&policy);

        let before = env::storage_usage();
        let mut owner = self.owners.get(&owner_id).cloned().unwrap_or_else(Owner::new);
        require!(owner.agents.len() < MAX_AGENTS_PER_OWNER, "too many agents");
        owner.storage_balance = add(owner.storage_balance, attached);

        let id = self.next_agent_id;
        self.next_agent_id += 1;
        owner.agents.push(id);
        let agent = Agent {
            id,
            owner: owner_id.clone(),
            account: agent_account.clone(),
            name,
            status: AgentStatus::Active,
            policy,
            usage: Usage::default(),
            reserved: 0,
            settled: 0,
            payment_count: 0,
            rejected_count: 0,
            created_at: env::block_timestamp(),
        };
        self.owners.insert(owner_id.clone(), owner);
        self.agents.insert(id, agent);
        self.agent_by_account.insert(agent_account.clone(), id);
        self.flush_all();
        self.charge_storage(&owner_id, before);

        emit(
            "agent_registered",
            json!({ "agent_id": U64(id), "owner": owner_id, "account": agent_account }),
        );
        self.get_agent(U64(id)).unwrap()
    }

    #[payable]
    pub fn set_policy(&mut self, agent_id: U64, policy: Policy) -> AgentView {
        assert_one_yocto();
        validate_policy(&policy);
        let mut agent = self.expect_agent_owned_by_caller(agent_id.0);
        require!(agent.status != AgentStatus::Revoked, "agent is revoked");
        let before = env::storage_usage();
        agent.policy = policy;
        self.agents.insert(agent.id, agent.clone());
        self.agents.flush();
        // Policy size can grow (allowlist); charge any delta.
        self.charge_storage(&agent.owner, before);
        emit("policy_updated", json!({ "agent_id": agent_id }));
        self.get_agent(agent_id).unwrap()
    }

    /// Emergency stop. No deposit required so a limited key can trigger it.
    pub fn pause_agent(&mut self, agent_id: U64) -> AgentView {
        let mut agent = self.expect_agent_owned_by_caller(agent_id.0);
        require!(agent.status == AgentStatus::Active, "agent is not active");
        agent.status = AgentStatus::Paused;
        self.agents.insert(agent.id, agent);
        emit("agent_paused", json!({ "agent_id": agent_id }));
        self.get_agent(agent_id).unwrap()
    }

    #[payable]
    pub fn resume_agent(&mut self, agent_id: U64) -> AgentView {
        assert_one_yocto();
        let mut agent = self.expect_agent_owned_by_caller(agent_id.0);
        require!(agent.status == AgentStatus::Paused, "agent is not paused");
        agent.status = AgentStatus::Active;
        self.agents.insert(agent.id, agent);
        emit("agent_resumed", json!({ "agent_id": agent_id }));
        self.get_agent(agent_id).unwrap()
    }

    /// Permanent. Pending payments still resolve normally.
    pub fn revoke_agent(&mut self, agent_id: U64) -> AgentView {
        let mut agent = self.expect_agent_owned_by_caller(agent_id.0);
        require!(agent.status != AgentStatus::Revoked, "agent already revoked");
        agent.status = AgentStatus::Revoked;
        self.agents.insert(agent.id, agent);
        emit("agent_revoked", json!({ "agent_id": agent_id }));
        self.get_agent(agent_id).unwrap()
    }

    /// Owner may expire a payment whose callback never arrived. The amount stays
    /// counted as spent (funds may have left); a late failure callback restores it.
    pub fn expire_payment(&mut self, payment_id: U64) -> PaymentView {
        let caller = env::predecessor_account_id();
        let mut p = self.payments.get(&payment_id.0).expect("payment not found").clone();
        require!(p.owner == caller, "only the owner");
        require!(p.status == PaymentStatus::Pending, "payment is not pending");
        require!(
            env::block_timestamp() >= p.created_at + PENDING_EXPIRY_NS,
            "payment has not reached expiry"
        );
        self.finalize_spent(&p);
        p.status = PaymentStatus::Expired;
        p.resolved_at = Some(env::block_timestamp());
        self.payments.insert(p.id, p.clone());
        emit("payment_expired", json!({ "payment_id": payment_id }));
        PaymentView::from(&p)
    }

    // =====================================================================
    // Agent: payments
    // =====================================================================

    /// Called by the agent's own account. Policy rejections return a structured
    /// outcome (no panic) so the reason is visible to the agent and the indexer.
    pub fn request_payment(
        &mut self,
        request_id: String,
        recipient: AccountId,
        amount: U128,
        memo: Option<String>,
    ) -> PromiseOrValue<PaymentOutcome> {
        let caller = env::predecessor_account_id();
        let amount = amount.0;
        let reject = |reason| {
            PromiseOrValue::Value(PaymentOutcome {
                status: OutcomeStatus::Rejected,
                payment_id: None,
                request_id: request_id.clone(),
                amount: U128(amount),
                reason: Some(reason),
                duplicate: false,
            })
        };

        if request_id.is_empty()
            || request_id.len() > MAX_REQUEST_ID_LEN
            || !request_id.chars().all(|c| c.is_ascii_alphanumeric() || "-_:.".contains(c))
        {
            return reject(RejectReason::InvalidRequestId);
        }
        let Some(&agent_id) = self.agent_by_account.get(&caller) else {
            emit("payment_rejected", json!({ "caller": caller, "reason": RejectReason::UnregisteredAgent }));
            return reject(RejectReason::UnregisteredAgent);
        };

        // Idempotency: same request_id never moves money twice.
        let idem_key = format!("{agent_id}:{request_id}");
        if let Some(&pid) = self.idempotency.get(&idem_key) {
            let p = self.payments.get(&pid).unwrap();
            if p.recipient != recipient || p.amount != amount {
                return reject(RejectReason::IdempotencyConflict);
            }
            return PromiseOrValue::Value(PaymentOutcome {
                status: p.status.into(),
                payment_id: Some(U64(pid)),
                request_id,
                amount: U128(amount),
                reason: None,
                duplicate: true,
            });
        }

        let mut agent = self.agents.get(&agent_id).unwrap().clone();
        let mut owner = self.expect_owner(&agent.owner);
        let now = env::block_timestamp();
        let periods = periods_at(now);

        let verdict = if memo.as_ref().is_some_and(|m| m.len() > MAX_MEMO_LEN) {
            Err(RejectReason::MemoTooLong)
        } else {
            evaluate(&agent, &owner, &recipient, amount, periods)
        };
        if let Err(reason) = verdict {
            agent.rejected_count += 1;
            self.agents.insert(agent_id, agent);
            emit(
                "payment_rejected",
                json!({
                    "agent_id": U64(agent_id), "request_id": request_id,
                    "recipient": recipient, "amount": U128(amount), "reason": reason
                }),
            );
            return reject(reason);
        }

        // ---- Atomic reservation: counted against every limit right now. ----
        owner.reserved = add(owner.reserved, amount);
        agent.reserved = add(agent.reserved, amount);
        agent.usage.day.add(periods.day, amount);
        agent.usage.week.add(periods.week, amount);
        agent.usage.month.add(periods.month, amount);

        let payment_id = self.next_payment_id;
        self.next_payment_id += 1;
        let index = agent.payment_count;
        agent.payment_count += 1;
        let payment = Payment {
            id: payment_id,
            agent_id,
            owner: agent.owner.clone(),
            recipient: recipient.clone(),
            amount,
            request_id: request_id.clone(),
            memo,
            status: PaymentStatus::Pending,
            periods,
            created_at: now,
            resolved_at: None,
        };

        let before = env::storage_usage();
        let owner_id = agent.owner.clone();
        self.owners.insert(owner_id.clone(), owner);
        self.agents.insert(agent_id, agent);
        self.payments.insert(payment_id, payment);
        self.idempotency.insert(idem_key, payment_id);
        self.agent_payments.insert((agent_id, index), payment_id);
        self.flush_all();
        self.charge_storage(&owner_id, before);

        emit(
            "payment_reserved",
            json!({
                "payment_id": U64(payment_id), "agent_id": U64(agent_id),
                "request_id": request_id, "recipient": recipient, "amount": U128(amount)
            }),
        );

        PromiseOrValue::Promise(
            Promise::new(recipient)
                .transfer(NearToken::from_yoctonear(amount))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_FOR_CALLBACK)
                        .on_payment_settled(U64(payment_id)),
                ),
        )
    }

    #[private]
    pub fn on_payment_settled(
        &mut self,
        payment_id: U64,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> PaymentOutcome {
        assert_self();
        let mut p = self.payments.get(&payment_id.0).expect("payment not found").clone();
        let ok = result.is_ok();
        match (p.status, ok) {
            (PaymentStatus::Pending, true) => {
                self.finalize_spent(&p);
                p.status = PaymentStatus::Settled;
            }
            (PaymentStatus::Pending, false) => {
                self.release_reservation(&p);
                p.status = PaymentStatus::Failed;
            }
            // Late callbacks after expiry: correct the conservative assumption.
            (PaymentStatus::Expired, true) => p.status = PaymentStatus::Settled,
            (PaymentStatus::Expired, false) => {
                self.undo_spent(&p);
                p.status = PaymentStatus::Failed;
            }
            _ => env::panic_str("payment already resolved"),
        }
        p.resolved_at = Some(env::block_timestamp());
        self.payments.insert(p.id, p.clone());
        emit(
            if p.status == PaymentStatus::Settled { "payment_settled" } else { "payment_failed" },
            json!({ "payment_id": payment_id, "amount": U128(p.amount) }),
        );
        PaymentOutcome {
            status: p.status.into(),
            payment_id: Some(payment_id),
            request_id: p.request_id,
            amount: U128(p.amount),
            reason: None,
            duplicate: false,
        }
    }

    // =====================================================================
    // Views
    // =====================================================================

    pub fn get_owner(&self, account_id: AccountId) -> Option<OwnerView> {
        self.owners.get(&account_id).map(|o| self.owner_view(&account_id, o))
    }

    pub fn get_agent(&self, agent_id: U64) -> Option<AgentView> {
        let a = self.agents.get(&agent_id.0)?;
        let owner = self.owners.get(&a.owner)?;
        Some(agent_view(a, owner, periods_at(env::block_timestamp())))
    }

    pub fn get_agent_by_account(&self, account_id: AccountId) -> Option<AgentView> {
        let id = *self.agent_by_account.get(&account_id)?;
        self.get_agent(U64(id))
    }

    pub fn list_agents(&self, owner_id: AccountId) -> Vec<AgentView> {
        let Some(owner) = self.owners.get(&owner_id) else { return vec![] };
        owner.agents.iter().filter_map(|id| self.get_agent(U64(*id))).collect()
    }

    pub fn get_payment(&self, payment_id: U64) -> Option<PaymentView> {
        self.payments.get(&payment_id.0).map(PaymentView::from)
    }

    /// Newest first.
    pub fn list_agent_payments(&self, agent_id: U64, offset: Option<U64>, limit: Option<U64>) -> Vec<PaymentView> {
        let Some(agent) = self.agents.get(&agent_id.0) else { return vec![] };
        let offset = offset.map(|v| v.0).unwrap_or(0);
        let limit = limit.map(|v| v.0).unwrap_or(20).min(MAX_PAGE);
        let total = agent.payment_count;
        (0..limit)
            .map_while(|i| total.checked_sub(1 + offset + i))
            .filter_map(|idx| self.agent_payments.get(&(agent_id.0, idx)))
            .filter_map(|pid| self.payments.get(pid).map(PaymentView::from))
            .collect()
    }

    /// Dry-run of the policy check, for agents and the MCP server.
    pub fn check_payment(&self, agent_id: U64, recipient: AccountId, amount: U128) -> CheckResult {
        let Some(agent) = self.agents.get(&agent_id.0) else {
            return CheckResult { allowed: false, reason: Some(RejectReason::UnregisteredAgent), budget: None };
        };
        let owner = self.owners.get(&agent.owner).unwrap();
        let periods = periods_at(env::block_timestamp());
        let verdict = evaluate(agent, owner, &recipient, amount.0, periods);
        CheckResult {
            allowed: verdict.is_ok(),
            reason: verdict.err(),
            budget: Some(budget_view(agent, owner, periods)),
        }
    }

    // =====================================================================
    // Internal
    // =====================================================================

    fn finalize_spent(&mut self, p: &Payment) {
        let mut owner = self.expect_owner(&p.owner);
        let mut agent = self.agents.get(&p.agent_id).unwrap().clone();
        owner.reserved -= p.amount;
        owner.balance -= p.amount;
        owner.total_settled = add(owner.total_settled, p.amount);
        agent.reserved -= p.amount;
        agent.settled = add(agent.settled, p.amount);
        self.owners.insert(p.owner.clone(), owner);
        self.agents.insert(p.agent_id, agent);
    }

    fn release_reservation(&mut self, p: &Payment) {
        let mut owner = self.expect_owner(&p.owner);
        let mut agent = self.agents.get(&p.agent_id).unwrap().clone();
        owner.reserved -= p.amount;
        agent.reserved -= p.amount;
        agent.usage.day.release(p.periods.day, p.amount);
        agent.usage.week.release(p.periods.week, p.amount);
        agent.usage.month.release(p.periods.month, p.amount);
        self.owners.insert(p.owner.clone(), owner);
        self.agents.insert(p.agent_id, agent);
    }

    fn undo_spent(&mut self, p: &Payment) {
        let mut owner = self.expect_owner(&p.owner);
        let mut agent = self.agents.get(&p.agent_id).unwrap().clone();
        owner.balance = add(owner.balance, p.amount);
        owner.total_settled -= p.amount;
        agent.settled -= p.amount;
        agent.usage.day.release(p.periods.day, p.amount);
        agent.usage.week.release(p.periods.week, p.amount);
        agent.usage.month.release(p.periods.month, p.amount);
        self.owners.insert(p.owner.clone(), owner);
        self.agents.insert(p.agent_id, agent);
    }

    fn charge_storage(&mut self, owner_id: &AccountId, before: u64) {
        let after = env::storage_usage();
        if after <= before {
            return;
        }
        let cost = storage_cost(after - before);
        let mut owner = self.expect_owner(owner_id);
        require!(owner.storage_balance >= cost, "insufficient storage balance; call storage_deposit");
        owner.storage_balance -= cost;
        self.owners.insert(owner_id.clone(), owner);
    }

    fn flush_all(&mut self) {
        self.owners.flush();
        self.agents.flush();
        self.agent_by_account.flush();
        self.payments.flush();
        self.idempotency.flush();
        self.agent_payments.flush();
    }

    fn expect_owner(&self, owner_id: &AccountId) -> Owner {
        self.owners.get(owner_id).cloned().unwrap_or_else(|| env::panic_str("owner not found"))
    }

    fn expect_agent_owned_by_caller(&self, agent_id: AgentId) -> Agent {
        let agent = self.agents.get(&agent_id).cloned().unwrap_or_else(|| env::panic_str("agent not found"));
        require!(agent.owner == env::predecessor_account_id(), "only the agent's owner");
        agent
    }

    fn owner_view(&self, id: &AccountId, o: &Owner) -> OwnerView {
        OwnerView {
            account: id.clone(),
            balance: U128(o.balance),
            reserved: U128(o.reserved),
            available: U128(o.available()),
            storage_balance: U128(o.storage_balance),
            total_deposited: U128(o.total_deposited),
            total_withdrawn: U128(o.total_withdrawn),
            total_settled: U128(o.total_settled),
            agents: o.agents.iter().map(|a| U64(*a)).collect(),
        }
    }
}

// ---------- pure policy logic ----------

pub(crate) fn evaluate(
    agent: &Agent,
    owner: &Owner,
    recipient: &AccountId,
    amount: u128,
    periods: Periods,
) -> Result<(), RejectReason> {
    match agent.status {
        AgentStatus::Revoked => return Err(RejectReason::AgentRevoked),
        AgentStatus::Paused => return Err(RejectReason::AgentPaused),
        AgentStatus::Active => {}
    }
    if amount == 0 {
        return Err(RejectReason::InvalidAmount);
    }
    if *recipient == agent.account || *recipient == env::current_account_id() {
        return Err(RejectReason::ForbiddenRecipient);
    }
    if let Some(list) = &agent.policy.allowed_recipients {
        if !list.contains(recipient) {
            return Err(RejectReason::RecipientNotAllowed);
        }
    }
    let p = &agent.policy;
    if amount > p.max_transaction.0 {
        return Err(RejectReason::ExceedsMaxTransaction);
    }
    if amount > p.daily_limit.0.saturating_sub(agent.usage.day.current(periods.day)) {
        return Err(RejectReason::ExceedsDailyLimit);
    }
    if amount > p.weekly_limit.0.saturating_sub(agent.usage.week.current(periods.week)) {
        return Err(RejectReason::ExceedsWeeklyLimit);
    }
    if amount > p.monthly_limit.0.saturating_sub(agent.usage.month.current(periods.month)) {
        return Err(RejectReason::ExceedsMonthlyLimit);
    }
    if amount > owner.available() {
        return Err(RejectReason::InsufficientTreasury);
    }
    if owner.storage_balance < storage_cost(PAYMENT_STORAGE_PRECHECK_BYTES) {
        return Err(RejectReason::InsufficientStorageBalance);
    }
    Ok(())
}

fn validate_policy(p: &Policy) {
    require!(p.max_transaction.0 > 0, "max_transaction must be > 0");
    require!(p.max_transaction.0 <= p.daily_limit.0, "max_transaction must be <= daily_limit");
    require!(p.daily_limit.0 <= p.weekly_limit.0, "daily_limit must be <= weekly_limit");
    require!(p.weekly_limit.0 <= p.monthly_limit.0, "weekly_limit must be <= monthly_limit");
    if let Some(list) = &p.allowed_recipients {
        require!(!list.is_empty(), "allowlist must not be empty (use null for any recipient)");
        require!(list.len() <= MAX_RECIPIENTS, "too many allowed recipients");
    }
}

fn budget_view(a: &Agent, o: &Owner, periods: Periods) -> BudgetView {
    let p = &a.policy;
    let (d, w, m) = (
        a.usage.day.current(periods.day),
        a.usage.week.current(periods.week),
        a.usage.month.current(periods.month),
    );
    let rd = p.daily_limit.0.saturating_sub(d);
    let rw = p.weekly_limit.0.saturating_sub(w);
    let rm = p.monthly_limit.0.saturating_sub(m);
    let spendable = if a.status == AgentStatus::Active {
        rd.min(rw).min(rm).min(p.max_transaction.0).min(o.available())
    } else {
        0
    };
    BudgetView {
        spent_today: U128(d),
        spent_this_week: U128(w),
        spent_this_month: U128(m),
        remaining_today: U128(rd),
        remaining_this_week: U128(rw),
        remaining_this_month: U128(rm),
        max_transaction: p.max_transaction,
        spendable_now: U128(spendable),
    }
}

fn agent_view(a: &Agent, o: &Owner, periods: Periods) -> AgentView {
    AgentView {
        id: U64(a.id),
        owner: a.owner.clone(),
        account: a.account.clone(),
        name: a.name.clone(),
        status: a.status,
        policy: a.policy.clone(),
        budget: budget_view(a, o, periods),
        reserved: U128(a.reserved),
        settled: U128(a.settled),
        payment_count: U64(a.payment_count),
        rejected_count: U64(a.rejected_count),
        created_at: U64(a.created_at),
    }
}

/// Defense in depth on top of #[private]: callbacks only from this contract.
fn assert_self() {
    require!(env::predecessor_account_id() == env::current_account_id(), "callback is private");
}

fn storage_cost(bytes: u64) -> u128 {
    env::storage_byte_cost().as_yoctonear() * bytes as u128
}

fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).unwrap_or_else(|| env::panic_str("arithmetic overflow"))
}

/// NEP-297 event log.
fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "bila", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[cfg(test)]
mod tests;
