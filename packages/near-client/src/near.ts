import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import type { AgentView, CheckResult, OwnerView, PaymentOutcome, PaymentView } from "@bila/shared";
import type { BilaChain } from "./chain.js";

export interface NearConfig {
  rpcUrl: string;           // e.g. https://rpc.testnet.near.org
  contractId: string;       // e.g. agentbilla.testnet (or a sub-account)
}
/** Resolves an agent account's function-call secret key ("ed25519:..."). */
export type AgentKeySource = (agentAccount: string) => Promise<string>;

export class NearBilaChain implements BilaChain {
  private provider: JsonRpcProvider;
  constructor(private cfg: NearConfig, private keys: AgentKeySource) {
    this.provider = new JsonRpcProvider({ url: cfg.rpcUrl });
  }

  private view<T extends object>(method: string, args: Record<string, unknown>): Promise<T | undefined> {
    return this.provider.callFunction<T>({ contractId: this.cfg.contractId, method, args });
  }
  async getAgent(agentId: string) { return (await this.view<AgentView>("get_agent", { agent_id: agentId })) ?? null; }
  async getAgentByAccount(account: string) { return (await this.view<AgentView>("get_agent_by_account", { account_id: account })) ?? null; }
  async listAgents(owner: string) { return (await this.view<AgentView[]>("list_agents", { owner_id: owner })) ?? []; }
  async getOwner(owner: string) { return (await this.view<OwnerView>("get_owner", { account_id: owner })) ?? null; }
  async listAgentPayments(agentId: string, offset = 0, limit = 20) {
    return (await this.view<PaymentView[]>("list_agent_payments", { agent_id: agentId, offset: String(offset), limit: String(limit) })) ?? [];
  }
  async checkPayment(agentId: string, recipient: string, amountYocto: bigint) {
    const r = await this.view<CheckResult>("check_payment", { agent_id: agentId, recipient, amount: amountYocto.toString() });
    if (!r) throw new Error("check_payment returned nothing");
    return r;
  }

  async requestPayment(agentAccount: string, p: { requestId: string; recipient: string; amountYocto: bigint; memo?: string }): Promise<PaymentOutcome> {
    const signer = KeyPairSigner.fromSecretKey((await this.keys(agentAccount)) as `ed25519:${string}`);
    const account = new Account(agentAccount, this.provider, signer);
    // Function-call keys cannot attach a deposit; gas only.
    const out = await account.callFunction<PaymentOutcome>({
      contractId: this.cfg.contractId,
      methodName: "request_payment",
      args: { request_id: p.requestId, recipient: p.recipient, amount: p.amountYocto.toString(), memo: p.memo ?? null },
      gas: 100_000_000_000_000n,
      deposit: 0n,
    });
    if (!out) throw new Error("request_payment returned no outcome");
    return out;
  }
}
