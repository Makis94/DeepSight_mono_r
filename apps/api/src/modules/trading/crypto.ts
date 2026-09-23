import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the standard/recommended size for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Envelope-encrypts an agent private key for storage in
 * trading_accounts.agentPrivateKeyEncrypted — never store agent keys in plaintext (see that
 * column's own doc comment). AES-256-GCM: authenticated encryption, so a tampered ciphertext
 * fails to decrypt rather than silently returning garbage key material.
 *
 * Output format: `<iv>:<authTag>:<ciphertext>`, all hex — a single text column, no separate
 * columns for iv/tag needed.
 */
export function encryptAgentKey(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export class AgentKeyDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentKeyDecryptionError";
  }
}

export function decryptAgentKey(encrypted: string, keyHex: string): string {
  // Everything that can throw on malformed/corrupted input lives inside this one try —
  // code-review (2026-09-23) caught that createDecipheriv/setAuthTag used to run BEFORE the
  // try block, so a bad-length iv/authTag (corrupted storage, or a truncated string) threw
  // Node's own raw crypto error instead of this function's documented AgentKeyDecryptionError
  // contract, which any caller catching only that type would let propagate uncaught.
  try {
    const parts = encrypted.split(":");
    if (parts.length !== 3) {
      throw new AgentKeyDecryptionError(
        "malformed encrypted agent key — expected iv:authTag:ciphertext",
      );
    }
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const key = Buffer.from(keyHex, "hex");
    const iv = Buffer.from(ivHex as string, "hex");
    const authTag = Buffer.from(authTagHex as string, "hex");
    const ciphertext = Buffer.from(ciphertextHex as string, "hex");

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (err) {
    if (err instanceof AgentKeyDecryptionError) throw err;
    throw new AgentKeyDecryptionError(
      `failed to decrypt agent key — wrong AGENT_KEY_ENCRYPTION_KEY or corrupted data: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
