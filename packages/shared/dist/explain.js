/** Plain-language reasons shown to agents, owners and in the dashboard. */
export const REJECT_EXPLANATIONS = {
    unregistered_agent: "This account is not a registered BILA agent.",
    agent_paused: "The owner has paused this agent. Payments are blocked until the owner resumes it.",
    agent_revoked: "This agent was revoked permanently. It can never spend again.",
    invalid_amount: "The amount must be greater than zero.",
    invalid_request_id: "request_id must be 1-64 characters: letters, numbers, - _ : .",
    memo_too_long: "The memo is longer than 140 bytes.",
    idempotency_conflict: "This request_id was already used with a different recipient or amount.",
    forbidden_recipient: "Agents cannot pay themselves or the BILA contract.",
    recipient_not_allowed: "This recipient is not on the owner's approved recipient list.",
    exceeds_max_transaction: "The amount is above this agent's per-transaction limit.",
    exceeds_daily_limit: "The amount is more than the agent has left today (UTC).",
    exceeds_weekly_limit: "The amount is more than the agent has left this week (Mon-Sun, UTC).",
    exceeds_monthly_limit: "The amount is more than the agent has left this month (UTC).",
    insufficient_treasury: "The owner's unreserved treasury balance is too low.",
    insufficient_storage_balance: "The owner must top up the storage balance before more payments can be recorded.",
};
