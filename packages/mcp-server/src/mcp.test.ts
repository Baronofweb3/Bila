import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { AgentView, PaymentOutcome } from "@bila/shared";
import { parseNear, YOCTO_PER_NEAR } from "@bila/shared";
import type { BilaChain } from "@bila/near-client";
import { TokenStore, createBilaServer, createHttpServer, KeyVault, type Principal } from "./index.js";

const NEAR = YOCTO_PER_NEAR.toString();
const mkAgent = (id: string, owner: string, account: string): AgentView => ({
  id, owner, account, name: `bot${id}`, status: "active",
  policy: { daily_limit: NEAR, weekly_limit: NEAR, monthly_limit: NEAR, max_transaction: NEAR, allowed_recipients: null },
  budget: {
    spent_today: "0", spent_this_week: "0", spent_this_month: "0",
    remaining_today: NEAR, remaining_this_week: NEAR, remaining_this_month: NEAR,
    max_transaction: NEAR, spendable_now: NEAR,
  },
  reserved: "0", settled: "0", payment_count: "0", rejected_count: "0", created_at: "0",
});

const agents = [mkAgent("1", "alice.testnet", "bot1.testnet"), mkAgent("2", "bob.testnet", "bot2.testnet")];

/** Records what the MCP layer asks the chain to do. The contract (not this stub) is the policy authority. */
class StubChain implements BilaChain {
  payments: { agentAccount: string; requestId: string; recipient: string; amountYocto: bigint }[] = [];
  async getAgent(id: string) { return agents.find((a) => a.id === id) ?? null; }
  async getAgentByAccount(acc: string) { return agents.find((a) => a.account === acc) ?? null; }
  async listAgents(owner: string) { return agents.filter((a) => a.owner === owner); }
  async getOwner() { return null; }
  async listAgentPayments() { return []; }
  async checkPayment() { return { allowed: true, reason: null, budget: null }; }
  async requestPayment(agentAccount: string, p: { requestId: string; recipient: string; amountYocto: bigint }): Promise<PaymentOutcome> {
    this.payments.push({ agentAccount, ...p });
    return { status: "pending", payment_id: "1", request_id: p.requestId, amount: p.amountYocto.toString(), reason: null, duplicate: false };
  }
}

async function connect(principal: Principal, chain: StubChain) {
  const server = createBilaServer(principal, { chain, contractId: "agentbilla.testnet", registerStorageYocto: parseNear("0.1") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const textOf = (r: any) => r.content[0].text as string;

describe("tool surface", () => {
  it("agents see only agent tools; no settle/authorize/withdraw anywhere", async () => {
    const agent = await connect({ role: "agent", agentAccount: "bot1.testnet" }, new StubChain());
    const owner = await connect({ role: "owner", owner: "alice.testnet" }, new StubChain());
    const a = (await agent.listTools()).tools.map((t) => t.name).sort();
    const o = (await owner.listTools()).tools.map((t) => t.name).sort();
    expect(a).toEqual(["check_budget", "get_agent_status", "get_transaction_history", "request_payment"]);
    expect(o).toEqual(["check_budget", "get_agent_status", "get_transaction_history", "pause_agent", "register_agent", "resume_agent", "set_budget"]);
    for (const n of [...a, ...o]) expect(n).not.toMatch(/authorize|settle|withdraw|revoke/);
  });
});

describe("agent isolation", () => {
  it("payment is always signed as the credential's agent; extra agent args are not honoured", async () => {
    const chain = new StubChain();
    const c = await connect({ role: "agent", agentAccount: "bot1.testnet" }, chain);
    await c.callTool({ name: "request_payment", arguments: {
      request_id: "r1", recipient: "vendor.testnet", amount_near: "0.5",
      agent_id: "2", agent_account: "bot2.testnet",
    } });
    expect(chain.payments).toHaveLength(1);
    expect(chain.payments[0]!.agentAccount).toBe("bot1.testnet");
    expect(chain.payments[0]!.amountYocto).toBe(parseNear("0.5"));
  });
  it("agent status is only its own", async () => {
    const c = await connect({ role: "agent", agentAccount: "bot1.testnet" }, new StubChain());
    const r = await c.callTool({ name: "get_agent_status", arguments: { agent_id: "2" } });
    expect(JSON.parse(textOf(r)).agent_id).toBe("1");
  });
  it("bad amounts never reach the chain", async () => {
    const chain = new StubChain();
    const c = await connect({ role: "agent", agentAccount: "bot1.testnet" }, chain);
    for (const amount_near of ["-1", "1e3", "0.5.5", "NaN"]) {
      const r: any = await c.callTool({ name: "request_payment", arguments: { request_id: "x", recipient: "v.testnet", amount_near } });
      expect(r.isError).toBe(true);
    }
    expect(chain.payments).toHaveLength(0);
  });
});

describe("owner scoping and prepared (not executed) actions", () => {
  it("owner cannot read or change another owner's agent", async () => {
    const c = await connect({ role: "owner", owner: "alice.testnet" }, new StubChain());
    for (const [name, args] of [
      ["get_agent_status", { agent_id: "2" }],
      ["pause_agent", { agent_id: "2" }],
      ["resume_agent", { agent_id: "2" }],
      ["check_budget", { agent_id: "2", recipient: "v.testnet", amount_near: "1" }],
      ["get_transaction_history", { agent_id: "2" }],
      ["set_budget", { agent_id: "2", daily_near: "1", weekly_near: "1", monthly_near: "1", max_per_payment_near: "1" }],
    ] as const) {
      const r: any = await c.callTool({ name, arguments: args });
      expect(r.isError, name).toBe(true);
    }
  });
  it("set_budget only prepares a wallet transaction with 1 yocto", async () => {
    const chain = new StubChain();
    const c = await connect({ role: "owner", owner: "alice.testnet" }, chain);
    const r: any = await c.callTool({ name: "set_budget", arguments: { agent_id: "1", daily_near: "10", weekly_near: "40", monthly_near: "100", max_per_payment_near: "2.5" } });
    const out = JSON.parse(textOf(r));
    expect(out.needs_wallet_signature).toBe(true);
    expect(out.transaction.methodName).toBe("set_policy");
    expect(out.transaction.depositYocto).toBe("1");
    expect(out.transaction.args.policy.max_transaction).toBe(parseNear("2.5").toString());
    expect(chain.payments).toHaveLength(0);
  });
});

describe("HTTP auth", () => {
  let srv: Server; let base: string; const store = new TokenStore(); let agentTok: string;
  beforeAll(async () => {
    agentTok = store.issue({ role: "agent", agentAccount: "bot1.testnet" });
    srv = createHttpServer(store, { chain: new StubChain(), contractId: "agentbilla.testnet", registerStorageYocto: 1n });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => { srv.close(); });

  it("rejects missing, malformed and unknown tokens with 401", async () => {
    for (const h of [{}, { authorization: "Bearer nope" }, { authorization: "Basic abc" }, { authorization: "Bearer bila_ag_" + "A".repeat(43) }]) {
      const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...h }, body: "{}" });
      expect(r.status).toBe(401);
    }
  });
  it("valid agent token works end to end over Streamable HTTP", async () => {
    const client = new Client({ name: "t", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers: { authorization: `Bearer ${agentTok}` } } }));
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("request_payment");
    const r = await client.callTool({ name: "request_payment", arguments: { request_id: "h1", recipient: "v.testnet", amount_near: "0.1" } });
    expect(JSON.parse(textOf(r)).status).toBe("pending");
    await client.close();
  });
  it("revoked token stops working immediately", async () => {
    const t = store.issue({ role: "agent", agentAccount: "bot1.testnet" });
    store.revokeAgent("bot1.testnet");
    const r = await fetch(base, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(r.status).toBe(401);
  });
});

describe("KeyVault + TokenStore", () => {
  it("encrypts at rest, detects tampering, never stores raw tokens", () => {
    const v = new KeyVault("11".repeat(32));
    const secret = "ed25519:SECRETSECRETSECRET";
    const blob = v.encrypt(secret);
    expect(blob).not.toContain("SECRET");
    expect(v.decrypt(blob)).toBe(secret);
    const parts = blob.split("."); parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => v.decrypt(parts.join("."))).toThrow();
    expect(() => new KeyVault("short")).toThrow();
    const s = new TokenStore(); const tok = s.issue({ role: "owner", owner: "a.testnet" });
    expect(JSON.stringify(s.export())).not.toContain(tok);
  });
});
