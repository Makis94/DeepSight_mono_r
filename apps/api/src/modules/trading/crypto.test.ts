import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AgentKeyDecryptionError, decryptAgentKey, encryptAgentKey } from "./crypto.js";

const KEY = randomBytes(32).toString("hex");

describe("encryptAgentKey / decryptAgentKey", () => {
  it("round-trips a plaintext private key", () => {
    const plaintext = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567";
    const encrypted = encryptAgentKey(plaintext, KEY);
    expect(decryptAgentKey(encrypted, KEY)).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const plaintext = "0x00";
    expect(encryptAgentKey(plaintext, KEY)).not.toBe(encryptAgentKey(plaintext, KEY));
  });

  it("throws AgentKeyDecryptionError on the wrong key", () => {
    const encrypted = encryptAgentKey("0x00", KEY);
    const wrongKey = randomBytes(32).toString("hex");
    expect(() => decryptAgentKey(encrypted, wrongKey)).toThrow(AgentKeyDecryptionError);
  });

  it("throws AgentKeyDecryptionError on tampered ciphertext (auth tag mismatch)", () => {
    const encrypted = encryptAgentKey("0x00", KEY);
    const parts = encrypted.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${(parts[2] ?? "").slice(0, -2)}ff`;
    expect(() => decryptAgentKey(tampered, KEY)).toThrow(AgentKeyDecryptionError);
  });

  it("throws AgentKeyDecryptionError on a malformed encrypted string", () => {
    expect(() => decryptAgentKey("not-the-right-format", KEY)).toThrow(AgentKeyDecryptionError);
  });

  // code-review (2026-09-23): createDecipheriv/setAuthTag used to run outside the try block,
  // so this exact case (right shape, wrong-length iv/authTag — e.g. truncated storage) threw
  // a raw Node crypto error instead of AgentKeyDecryptionError.
  it("throws AgentKeyDecryptionError (not a raw Node crypto error) on a bad-length iv", () => {
    const encrypted = encryptAgentKey("0x00", KEY);
    const parts = encrypted.split(":");
    const truncatedIv = `${(parts[0] ?? "").slice(0, 4)}:${parts[1]}:${parts[2]}`;
    expect(() => decryptAgentKey(truncatedIv, KEY)).toThrow(AgentKeyDecryptionError);
  });

  it("throws AgentKeyDecryptionError (not a raw Node crypto error) on a bad-length authTag", () => {
    const encrypted = encryptAgentKey("0x00", KEY);
    const parts = encrypted.split(":");
    const truncatedTag = `${parts[0]}:${(parts[1] ?? "").slice(0, 4)}:${parts[2]}`;
    expect(() => decryptAgentKey(truncatedTag, KEY)).toThrow(AgentKeyDecryptionError);
  });
});
