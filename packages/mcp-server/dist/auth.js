import { createHash, randomBytes } from "node:crypto";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
/**
 * Stores only SHA-256 hashes of tokens. Tokens are 256-bit random, so a plain
 * hash lookup is safe (no timing oracle on a guessable secret).
 */
export class TokenStore {
    byHash = new Map();
    issue(principal) {
        const prefix = principal.role === "agent" ? "bila_ag_" : "bila_ow_";
        const token = prefix + randomBytes(32).toString("base64url");
        this.byHash.set(sha256(token), principal);
        return token; // shown once; only the hash is kept
    }
    revoke(token) { this.byHash.delete(sha256(token)); }
    revokeAgent(agentAccount) {
        for (const [h, p] of this.byHash)
            if (p.role === "agent" && p.agentAccount === agentAccount)
                this.byHash.delete(h);
    }
    authenticate(token) {
        if (!token || token.length > 200)
            return null;
        return this.byHash.get(sha256(token)) ?? null;
    }
    export() { return Object.fromEntries(this.byHash); }
    load(data) { for (const [h, p] of Object.entries(data))
        this.byHash.set(h, p); }
}
export function bearerFrom(header) {
    const m = /^Bearer ([A-Za-z0-9_\-]+)$/.exec(header ?? "");
    return m?.[1];
}
