/**
 * Encrypts agent function-call keys at rest (AES-256-GCM). The master key comes
 * from the environment (BILA_MASTER_KEY, 64 hex chars) and never touches disk or logs.
 * These keys can only call request_payment on the BILA contract, with no deposit.
 */
export declare class KeyVault {
    private key;
    constructor(masterKeyHex: string);
    encrypt(plain: string): string;
    decrypt(blob: string): string;
}
