/** Mirrors the JSON views returned by bila_core. u128/u64 arrive as decimal strings. */
export type AgentStatus = "active" | "paused" | "revoked";
export type PaymentStatus = "pending" | "settled" | "failed" | "expired";

export type RejectReason =
  | "unregistered_agent" | "agent_paused" | "agent_revoked" | "invalid_amount"
  | "invalid_request_id" | "memo_too_long" | "idempotency_conflict" | "forbidden_recipient"
  | "recipient_not_allowed" | "exceeds_max_transaction" | "exceeds_daily_limit"
  | "exceeds_weekly_limit" | "exceeds_monthly_limit" | "insufficient_treasury"
  | "insufficient_storage_balance";

export interface Policy {
  daily_limit: string; weekly_limit: string; monthly_limit: string; max_transaction: string;
  allowed_recipients: string[] | null;
}
export interface BudgetView {
  spent_today: string; spent_this_week: string; spent_this_month: string;
  remaining_today: string; remaining_this_week: string; remaining_this_month: string;
  max_transaction: string; spendable_now: string;
}
export interface AgentView {
  id: string; owner: string; account: string; name: string; status: AgentStatus;
  policy: Policy; budget: BudgetView; reserved: string; settled: string;
  payment_count: string; rejected_count: string; created_at: string;
}
export interface OwnerView {
  account: string; balance: string; reserved: string; available: string; storage_balance: string;
  total_deposited: string; total_withdrawn: string; total_settled: string; agents: string[];
}
export interface PaymentView {
  id: string; agent_id: string; owner: string; recipient: string; amount: string;
  request_id: string; memo: string | null; status: PaymentStatus; created_at: string; resolved_at: string | null;
}
export interface PaymentOutcome {
  status: "pending" | "settled" | "failed" | "expired" | "rejected";
  payment_id: string | null; request_id: string; amount: string;
  reason: RejectReason | null; duplicate: boolean;
}
export interface CheckResult { allowed: boolean; reason: RejectReason | null; budget: BudgetView | null }
