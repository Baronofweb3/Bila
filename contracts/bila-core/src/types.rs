use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

use crate::periods::Periods;

pub type AgentId = u64;
pub type PaymentId = u64;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Active,
    Paused,
    /// Terminal. A revoked agent can never spend again.
    Revoked,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PaymentStatus {
    /// Funds reserved against every limit; transfer in flight.
    Pending,
    /// Transfer confirmed by callback.
    Settled,
    /// Transfer failed; reservation released.
    Failed,
    /// No callback seen before the expiry window. Counted as spent (conservative)
    /// until a late callback proves otherwise.
    Expired,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RejectReason {
    UnregisteredAgent,
    AgentPaused,
    AgentRevoked,
    InvalidAmount,
    InvalidRequestId,
    MemoTooLong,
    IdempotencyConflict,
    ForbiddenRecipient,
    RecipientNotAllowed,
    ExceedsMaxTransaction,
    ExceedsDailyLimit,
    ExceedsWeeklyLimit,
    ExceedsMonthlyLimit,
    InsufficientTreasury,
    InsufficientStorageBalance,
}

/// All amounts are yoctoNEAR (1 NEAR = 10^24 yocto). Integers only.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pub daily_limit: U128,
    pub weekly_limit: U128,
    pub monthly_limit: U128,
    pub max_transaction: U128,
    /// None = any recipient (except forbidden ones). Some(list) = allowlist only.
    pub allowed_recipients: Option<Vec<AccountId>>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counter {
    pub period: u64,
    pub amount: u128,
}

impl Counter {
    pub fn current(&self, period: u64) -> u128 {
        if self.period == period {
            self.amount
        } else {
            0
        }
    }
    pub fn add(&mut self, period: u64, amount: u128) {
        if self.period != period {
            self.period = period;
            self.amount = 0;
        }
        self.amount = self.amount.checked_add(amount).expect("counter overflow");
    }
    /// Release only if still inside the same period; once a period has rolled
    /// over the counter was already reset and nothing must be subtracted.
    pub fn release(&mut self, period: u64, amount: u128) {
        if self.period == period {
            self.amount = self.amount.checked_sub(amount).expect("counter underflow");
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Usage {
    pub day: Counter,
    pub week: Counter,
    pub month: Counter,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Owner {
    /// Restricted treasury funds attributed to this owner (excludes storage).
    pub balance: u128,
    /// Portion of `balance` locked by in-flight payments.
    pub reserved: u128,
    /// NEAR set aside to pay for this owner's on-chain records.
    pub storage_balance: u128,
    pub total_deposited: u128,
    pub total_withdrawn: u128,
    pub total_settled: u128,
    pub agents: Vec<AgentId>,
}

impl Owner {
    pub fn new() -> Self {
        Self {
            balance: 0,
            reserved: 0,
            storage_balance: 0,
            total_deposited: 0,
            total_withdrawn: 0,
            total_settled: 0,
            agents: vec![],
        }
    }
    pub fn available(&self) -> u128 {
        self.balance.checked_sub(self.reserved).expect("reserved > balance")
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub id: AgentId,
    pub owner: AccountId,
    /// The only account allowed to request payments as this agent.
    pub account: AccountId,
    pub name: String,
    pub status: AgentStatus,
    pub policy: Policy,
    pub usage: Usage,
    pub reserved: u128,
    pub settled: u128,
    pub payment_count: u64,
    pub rejected_count: u64,
    pub created_at: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Payment {
    pub id: PaymentId,
    pub agent_id: AgentId,
    pub owner: AccountId,
    pub recipient: AccountId,
    pub amount: u128,
    pub request_id: String,
    pub memo: Option<String>,
    pub status: PaymentStatus,
    pub periods: Periods,
    pub created_at: u64,
    pub resolved_at: Option<u64>,
}

// ---------- JSON views ----------

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct OwnerView {
    pub account: AccountId,
    pub balance: U128,
    pub reserved: U128,
    pub available: U128,
    pub storage_balance: U128,
    pub total_deposited: U128,
    pub total_withdrawn: U128,
    pub total_settled: U128,
    pub agents: Vec<U64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct BudgetView {
    pub spent_today: U128,
    pub spent_this_week: U128,
    pub spent_this_month: U128,
    pub remaining_today: U128,
    pub remaining_this_week: U128,
    pub remaining_this_month: U128,
    pub max_transaction: U128,
    /// Largest single payment that would pass right now (min of all limits + treasury).
    pub spendable_now: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct AgentView {
    pub id: U64,
    pub owner: AccountId,
    pub account: AccountId,
    pub name: String,
    pub status: AgentStatus,
    pub policy: Policy,
    pub budget: BudgetView,
    pub reserved: U128,
    pub settled: U128,
    pub payment_count: U64,
    pub rejected_count: U64,
    pub created_at: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PaymentView {
    pub id: U64,
    pub agent_id: U64,
    pub owner: AccountId,
    pub recipient: AccountId,
    pub amount: U128,
    pub request_id: String,
    pub memo: Option<String>,
    pub status: PaymentStatus,
    pub created_at: U64,
    pub resolved_at: Option<U64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeStatus {
    Pending,
    Settled,
    Failed,
    Expired,
    Rejected,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PaymentOutcome {
    pub status: OutcomeStatus,
    pub payment_id: Option<U64>,
    pub request_id: String,
    pub amount: U128,
    pub reason: Option<RejectReason>,
    /// True when this request_id was already processed; no new transfer happened.
    pub duplicate: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct CheckResult {
    pub allowed: bool,
    pub reason: Option<RejectReason>,
    pub budget: Option<BudgetView>,
}

impl From<&Payment> for PaymentView {
    fn from(p: &Payment) -> Self {
        Self {
            id: U64(p.id),
            agent_id: U64(p.agent_id),
            owner: p.owner.clone(),
            recipient: p.recipient.clone(),
            amount: U128(p.amount),
            request_id: p.request_id.clone(),
            memo: p.memo.clone(),
            status: p.status,
            created_at: U64(p.created_at),
            resolved_at: p.resolved_at.map(U64),
        }
    }
}

impl From<PaymentStatus> for OutcomeStatus {
    fn from(s: PaymentStatus) -> Self {
        match s {
            PaymentStatus::Pending => OutcomeStatus::Pending,
            PaymentStatus::Settled => OutcomeStatus::Settled,
            PaymentStatus::Failed => OutcomeStatus::Failed,
            PaymentStatus::Expired => OutcomeStatus::Expired,
        }
    }
}
