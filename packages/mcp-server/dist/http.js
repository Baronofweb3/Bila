import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerFrom } from "./auth.js";
import { createBilaServer } from "./tools.js";
const MAX_BODY = 64 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQ_PER_WINDOW = 120;
async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY)
            throw new Error("body too large");
        chunks.push(c);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}
function send(res, status, body) {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}
/** Stateless Streamable HTTP endpoint at /mcp. Every request is authenticated. */
export function createHttpServer(store, deps) {
    const hits = new Map();
    const limited = (key) => {
        const now = Date.now();
        const h = hits.get(key);
        if (!h || now - h.t > WINDOW_MS) {
            hits.set(key, { n: 1, t: now });
            return false;
        }
        return ++h.n > MAX_REQ_PER_WINDOW;
    };
    return createServer(async (req, res) => {
        try {
            if (req.url === "/health")
                return send(res, 200, { ok: true });
            if (req.url !== "/mcp")
                return send(res, 404, { error: "not found" });
            const principal = store.authenticate(bearerFrom(req.headers.authorization));
            if (!principal) {
                res.setHeader("www-authenticate", 'Bearer realm="bila"');
                return send(res, 401, { error: "unauthorized" });
            }
            const key = principal.role === "agent" ? principal.agentAccount : principal.owner;
            if (limited(key))
                return send(res, 429, { error: "rate limited" });
            if (req.method !== "POST")
                return send(res, 405, { error: "method not allowed" });
            const body = await readJson(req);
            const server = createBilaServer(principal, deps);
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            res.on("close", () => { void transport.close(); void server.close(); });
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
        }
        catch (e) {
            if (!res.headersSent)
                send(res, 400, { error: "bad request" });
            // never log tokens, keys or request bodies
            console.error("mcp error:", e.message);
        }
    });
}
