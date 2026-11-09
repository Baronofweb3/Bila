import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
export class NearBilaChain {
    cfg;
    keys;
    provider;
    constructor(cfg, keys) {
        this.cfg = cfg;
        this.keys = keys;
        this.provider = new JsonRpcProvider({ url: cfg.rpcUrl });
    }
    view(method, args) {
        return this.provider.callFunction({ contractId: this.cfg.contractId, method, args });
    }
    async getAgent(agentId) { return (await this.view("get_agent", { agent_id: agentId })) ?? null; }
    async getAgentByAccount(account) { return (await this.view("get_agent_by_account", { account_id: account })) ?? null; }
    async listAgents(owner) { return (await this.view("list_agents", { owner_id: owner })) ?? []; }
    async getOwner(owner) { return (await this.view("get_owner", { account_id: owner })) ?? null; }
    async listAgentPayments(agentId, offset = 0, limit = 20) {
        return (await this.view("list_agent_payments", { agent_id: agentId, offset: String(offset), limit: String(limit) })) ?? [];
    }
    async checkPayment(agentId, recipient, amountYocto) {
        const r = await this.view("check_payment", { agent_id: agentId, recipient, amount: amountYocto.toString() });
        if (!r)
            throw new Error("check_payment returned nothing");
        return r;
    }
    async requestPayment(agentAccount, p) {
        const signer = KeyPairSigner.fromSecretKey((await this.keys(agentAccount)));
        const account = new Account(agentAccount, this.provider, signer);
        // Function-call keys cannot attach a deposit; gas only.
        const out = await account.callFunction({
            contractId: this.cfg.contractId,
            methodName: "request_payment",
            args: { request_id: p.requestId, recipient: p.recipient, amount: p.amountYocto.toString(), memo: p.memo ?? null },
            gas: 100000000000000n,
            deposit: 0n,
        });
        if (!out)
            throw new Error("request_payment returned no outcome");
        return out;
    }
}
