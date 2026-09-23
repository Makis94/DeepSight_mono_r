import crypto from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3";
import { describe, expect, it } from "vitest";
import { generateAgentWallet } from "./agent-wallet.js";

// Independently re-derives the address via Node's own OpenSSL-backed ECDH API — a
// completely separate code path from @noble/curves — as a cross-check that
// agent-wallet.ts's public-key-to-address assembly (strip the 0x04 prefix, keccak256, last
// 20 bytes) is standard EVM address derivation, not a subtly-wrong lookalike.
function independentlyDeriveAddress(privateKeyHex: string): string {
  const privBytes = Buffer.from(privateKeyHex.slice(2), "hex");
  const ecdh = crypto.createECDH("secp256k1");
  ecdh.setPrivateKey(privBytes);
  const uncompressedPubKey = ecdh.getPublicKey();
  const pubNoPrefix = uncompressedPubKey.subarray(1);
  const hash = keccak_256(pubNoPrefix);
  return `0x${Buffer.from(hash.slice(-20)).toString("hex")}`;
}

describe("generateAgentWallet", () => {
  it("produces a lowercased 0x + 40 hex char address", () => {
    const wallet = generateAgentWallet();
    expect(wallet.address).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("produces a 0x + 64 hex char private key", () => {
    const wallet = generateAgentWallet();
    expect(wallet.privateKeyHex).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("generates a different keypair every call", () => {
    const a = generateAgentWallet();
    const b = generateAgentWallet();
    expect(a.privateKeyHex).not.toBe(b.privateKeyHex);
    expect(a.address).not.toBe(b.address);
  });

  it("matches an independently-derived address via Node's own crypto module", () => {
    for (let i = 0; i < 5; i++) {
      const wallet = generateAgentWallet();
      expect(independentlyDeriveAddress(wallet.privateKeyHex)).toBe(wallet.address);
    }
  });
});
