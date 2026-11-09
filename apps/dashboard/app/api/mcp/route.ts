import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { TokenStore, createBilaServer } from "@bila/mcp-server";
import { NearBilaChain } from "@bila/near-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hosted BILA MCP endpoint (AGENT role only).
 * Owner tools are never exposed here: loosening actions need the owner's own wallet.
 *
 * Auth: `Authorization: Bearer <token>` or, for connectors that cannot set headers,
 * the token as a query parameter: /api/mcp?k=<token>.
 * Only the SHA-256 of the token lives in the environment.
 */

const RPCS = [process.env.BILA_RPC_URL, "https://test.rpc.fastnear.com", "https://rpc.testnet.near.org", "https://near-testnet.lava.build"].filter(Boolean) as string[];
let rpcPick: Promise<string> | undefined;
function pickRpc(): Promise<string> {
  rpcPick ??= (async () => {
    for (const url of RPCS) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: [] }), signal: AbortSignal.timeout(4000) });
        if (r.ok) return url;
      } catch { /* try next */ }
    }
    return RPCS[0]!;
  })();
  return rpcPick;
}

const bearer = (h: string | null) => /^Bearer ([A-Za-z0-9_\-]+)$/.exec(h ?? "")?.[1];
const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function handle(req: Request): Promise<Response> {
  const agentAccount = process.env.BILA_AGENT_ACCOUNT;
  const tokenHash = process.env.BILA_AGENT_TOKEN_SHA256;
  const secretKey = process.env.BILA_AGENT_SECRET_KEY;
  const contractId = process.env.NEXT_PUBLIC_BILA_CONTRACT_ID ?? "bila-treasury-01.testnet";
  if (!agentAccount || !tokenHash || !secretKey) return json(503, { error: "MCP endpoint not configured" });

  const q = new URL(req.url).searchParams.get("k") ?? undefined;
  const token = bearer(req.headers.get("authorization")) ?? q;
  const store = new TokenStore();
  store.load({ [tokenHash]: { role: "agent", agentAccount } });
  const principal = store.authenticate(token);
  if (!principal) return json(401, { error: "unauthorized" });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const chain = new NearBilaChain({ rpcUrl: await pickRpc(), contractId }, async (acct) => {
    if (acct !== agentAccount) throw new Error("no key for this account");
    return secretKey;
  });
  const server = createBilaServer(principal, { chain, contractId, registerStorageYocto: 0n });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } catch (e) {
    console.error("mcp error:", (e as Error).message);
    return json(400, { error: "bad request" });
  }
}

export { handle as POST, handle as GET, handle as DELETE };
// sha256 helper kept for docs/tests
export const _sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
