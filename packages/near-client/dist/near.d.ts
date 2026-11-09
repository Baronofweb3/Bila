import type { AgentView, CheckResult, OwnerView, PaymentOutcome, PaymentView } from "@bila/shared";
import type { BilaChain } from "./chain.js";
export interface NearConfig {
    rpcUrl: string;
    contractId: string;
}
/** Resolves an agent account's function-call secret key ("ed25519:..."). */
export type AgentKeySource = (agentAccount: string) => Promise<string>;
export declare class NearBilaChain implements BilaChain {
    private cfg;
    private keys;
    private provider;
    constructor(cfg: NearConfig, keys: AgentKeySource);
    private view;
    getAgent(agentId: string): Promise<AgentView | null>;
    getAgentByAccount(account: string): Promise<AgentView | null>;
    listAgents(owner: string): Promise<AgentView[]>;
    getOwner(owner: string): Promise<OwnerView | null>;
    listAgentPayments(agentId: string, offset?: number, limit?: number): Promise<PaymentView[]>;
    checkPayment(agentId: string, recipient: string, amountYocto: bigint): Promise<CheckResult>;
    requestPayment(agentAccount: string, p: {
        requestId: string;
        recipient: string;
        amountYocto: bigint;
        memo?: string;
    }): Promise<PaymentOutcome>;
}
