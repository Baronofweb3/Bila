import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts agent function-call keys at rest (AES-256-GCM). The master key comes
 * from the environment (BILA_MASTER_KEY, 64 hex chars) and never touches disk or logs.
 * These keys can only call request_payment on the BILA contract, with no deposit.
 */
export class KeyVault {
  private key: Buffer;
  constructor(masterKeyHex: string) {
    if (!/^[0-9a-f]{64}$/i.test(masterKeyHex)) throw new Error("BILA_MASTER_KEY must be 64 hex characters (32 bytes)");
    this.key = Buffer.from(masterKeyHex, "hex");
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
  }
  decrypt(blob: string): string {
    const [iv, tag, ct] = blob.split(".").map((p) => Buffer.from(p, "base64"));
    if (!iv || !tag || !ct) throw new Error("malformed ciphertext");
    const d = createDecipheriv("aes-256-gcm", this.key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  }
}
