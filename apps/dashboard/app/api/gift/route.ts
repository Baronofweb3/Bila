import { randomBytes } from "node:crypto";
import { NearBilaChain } from "@bila/near-client";
import { parseNear } from "@bila/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mock gifting platform. Each POST = the platform asking BILA to pay one gift.
 * Amount, recipient and memo are chosen HERE (server side) so the browser cannot pick them.
 * The contract still decides: anything over the agent's limits is rejected on chain.
 * Optional: set GIFT_DEMO_PIN to require ?pin= on the call.
 */

const RPCS = [process.env.BILA_RPC_URL, "https://test.rpc.fastnear.com", "https://rpc.testnet.near.org", "https://near-testnet.lava.build"].filter(Boolean) as string[];
let rpcPick: Promise<string> | undefined;
function pickRpc(): Promise<string> {
  rpcPick ??= (async () => {
    for (const url of RPCS) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: [] }), signal: AbortSignal.timeout(4000) });
        if (r.ok) return url;
      } catch { /* next */ }
    }
    return RPCS[0]!;
  })();
  return rpcPick;
}

const GIFTS = ["Birthday gift", "Thank-you gift", "Wedding gift", "Holiday gift", "Welcome gift", "Anniversary gift", "Graduation gift"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
const rnd = (min: number, max: number) => min + Math.random() * (max - min);

/** Mostly small gifts, some mid, a few big ones that should get blocked. */
function randomAmount(): string {
  const r = Math.random();
  const v = r < 0.55 ? rnd(0.05, 0.4) : r < 0.8 ? rnd(0.4, 0.9) : rnd(1, 3);
  return v.toFixed(2);
}

let last = 0;

export async function POST(req: Request): Promise<Response> {
  const pin = process.env.GIFT_DEMO_PIN;
  if (pin && new URL(req.url).searchParams.get("pin") !== pin) return Response.json({ error: "unauthorized" }, { status: 401 });

  const agentAccount = process.env.BILA_AGENT_ACCOUNT;
  const secretKey = process.env.BILA_AGENT_SECRET_KEY;
  const contractId = process.env.NEXT_PUBLIC_BILA_CONTRACT_ID ?? "bila-treasury-01.testnet";
  if (!agentAccount || !secretKey) return Response.json({ error: "not configured" }, { status: 503 });

  const now = Date.now();
  if (now - last < 1500) return Response.json({ error: "too fast" }, { status: 429 });
  last = now;

  const recipients = (process.env.GIFT_RECIPIENTS ?? "agentbilla.testnet,bila-owner-01.testnet").split(",").map((s) => s.trim()).filter(Boolean);
  const amountNear = randomAmount();
  const recipient = pick(recipients);
  const memo = pick(GIFTS);
  const requestId = `gift-${now}-${randomBytes(3).toString("hex")}`;

  try {
    const chain = new NearBilaChain({ rpcUrl: await pickRpc(), contractId }, async () => secretKey);
    const out = await chain.requestPayment(agentAccount, { requestId, recipient, amountYocto: parseNear(amountNear), memo });
    return Response.json({ ok: true, requestId, amountNear, memo, status: out.status, reason: out.reason });
  } catch (e) {
    console.error("gift error:", (e as Error).message);
    return Response.json({ ok: false, requestId, amountNear, memo, error: "chain call failed" }, { status: 502 });
  }
}
