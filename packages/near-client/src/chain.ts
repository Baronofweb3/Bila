import type {
  AgentView, CheckResult, OwnerView, PaymentOutcome, PaymentView, Policy,
} from "@bila/shared";

/** Everything the MCP server and API need from the chain. Money = bigint yocto. */
export interface BilaChain {
  getAgent(agentId: string): Promise<AgentView | null>;
  getAgentByAccount(account: string): Promise<AgentView | null>;
  listAgents(owner: string): Promise<AgentView[]>;
  getOwner(owner: string): Promise<OwnerView | null>;
  listAgentPayments(agentId: string, offset?: number, limit?: number): Promise<PaymentView[]>;
  checkPayment(agentId: string, recipient: string, amountYocto: bigint): Promise<CheckResult>;
  /**
   * Submit `request_payment` signed by the agent's own function-call key.
   * The contract decides; this only relays. Returns the contract's outcome.
   */
  requestPayment(agentAccount: string, p: {
    requestId: string; recipient: string; amountYocto: bigint; memo?: string;
  }): Promise<PaymentOutcome>;
}

/** A transaction the OWNER must sign in their wallet (needs a full-access key). */
export interface PreparedOwnerTx {
  kind: "register_agent" | "set_policy" | "pause_agent" | "resume_agent" | "revoke_agent" | "deposit" | "withdraw";
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  /** yoctoNEAR as decimal string */
  depositYocto: string;
  gasTgas: number;
  summary: string;
}

export type PolicyInput = {
  dailyYocto: bigint; weeklyYocto: bigint; monthlyYocto: bigint; maxTxYocto: bigint;
  allowedRecipients: string[] | null;
};

export function toContractPolicy(p: PolicyInput): Policy {
  return {
    daily_limit: p.dailyYocto.toString(), weekly_limit: p.weeklyYocto.toString(),
    monthly_limit: p.monthlyYocto.toString(), max_transaction: p.maxTxYocto.toString(),
    allowed_recipients: p.allowedRecipients,
  };
}
