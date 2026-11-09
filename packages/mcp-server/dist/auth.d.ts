export type Principal = {
    role: "agent";
    agentAccount: string;
} | {
    role: "owner";
    owner: string;
};
export interface CredentialStore {
    /** Resolve a bearer token to a principal, or null. Never throws on bad input. */
    authenticate(token: string | undefined): Principal | null;
}
/**
 * Stores only SHA-256 hashes of tokens. Tokens are 256-bit random, so a plain
 * hash lookup is safe (no timing oracle on a guessable secret).
 */
export declare class TokenStore implements CredentialStore {
    private byHash;
    issue(principal: Principal): string;
    revoke(token: string): void;
    revokeAgent(agentAccount: string): void;
    authenticate(token: string | undefined): Principal | null;
    export(): Record<string, Principal>;
    load(data: Record<string, Principal>): void;
}
export declare function bearerFrom(header: string | undefined): string | undefined;
