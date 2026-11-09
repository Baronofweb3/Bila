export const CONTRACT = process.env.NEXT_PUBLIC_BILA_CONTRACT_ID ?? "bila-treasury-01.testnet";
export const DEFAULT_OWNER = process.env.NEXT_PUBLIC_BILA_OWNER ?? "bila-owner-01.testnet";
const RPCS = [
  "https://test.rpc.fastnear.com",
  "https://rpc.testnet.near.org",
  "https://near-testnet.lava.build",
];

export type Policy = {
  daily_limit: string; weekly_limit: string; monthly_limit: string;
  max_transaction: string; allowed_recipients: string[] | null;
};
export type Budget = {
  max_transaction: string; spent_today: string; spent_this_week: string; spent_this_month: string;
  remaining_today: string; remaining_this_week: string; remaining_this_month: string; spendable_now: string;
};
export type Agent = {
  id: string; owner: string; account: string; name: string; status: "active" | "paused" | "revoked";
  policy: Policy; budget: Budget; reserved: string; settled: string;
  payment_count: string; rejected_count: string; created_at: string;
};
export type Owner = {
  account: string; balance: string; reserved: string; available: string; storage_balance: string;
  total_deposited: string; total_withdrawn: string; total_settled: string; agents: string[];
};
export type Payment = {
  id: string; agent_id: string; owner: string; recipient: string; amount: string; request_id: string;
  memo: string | null; status: "pending" | "settled" | "failed" | "expired"; created_at: string; resolved_at: string | null;
};

async function rpc(body: unknown): Promise<any> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) return await r.json();
    } catch (e) { last = e; }
  }
  throw new Error(`All RPC endpoints failed: ${String(last)}`);
}

export async function view<T>(method: string, args: object): Promise<T> {
  const args_base64 = btoa(JSON.stringify(args));
  const res = await rpc({
    jsonrpc: "2.0", id: "bila", method: "query",
    params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64 },
  });
  if (res.error || res.result?.error) throw new Error(res.result?.error ?? res.error?.data ?? "RPC error");
  const bytes = new Uint8Array(res.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export async function loadAll(ownerId: string) {
  const owner = await view<Owner | null>("get_owner", { account_id: ownerId });
  if (!owner) return { owner: null, agents: [] as Agent[], payments: [] as Payment[] };
  const agents = await view<Agent[]>("list_agents", { owner_id: ownerId });
  const lists = await Promise.all(
    agents.map((a) => view<Payment[]>("list_agent_payments", { agent_id: a.id, limit: "20" })),
  );
  const payments = lists.flat().sort((a, b) => (BigInt(b.created_at) > BigInt(a.created_at) ? 1 : -1));
  return { owner, agents, payments };
}
