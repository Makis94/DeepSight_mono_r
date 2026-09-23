import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";

// Generates a fresh Ethereum-style keypair to use as a Hyperliquid API (agent) wallet — this
// is NEVER the user's own key. The user approves this address with their own wallet's
// signature (see signing.ts's buildApproveAgentTypedData, signed client-side in apps/web);
// we only ever hold this agent's key, which per Hyperliquid's nonces-and-api-wallets docs
// (verified 2026-09-20) can only sign — it cannot itself be the funded/custodial account.
//
// Deliberately minimal deps (@noble/curves + @noble/hashes, both tiny and audited) rather
// than a full wallet library (viem/ethers) — this file only ever needs "generate a private
// key and derive its address", nothing else.
export interface AgentWallet {
  // Lowercased, 0x-prefixed — Hyperliquid's own Signing docs (verified 2026-09-20) call out
  // uppercase address characters as a common signing pitfall ("lowercase any address before
  // signing and sending"), so this is stored/used lowercased everywhere, never re-derived
  // with mixed-case (EIP-55) formatting.
  address: string;
  // 0x-prefixed 32-byte private key. The caller (apps/worker's linking flow) is responsible
  // for encrypting this before it reaches packages/db's trading_accounts.agentPrivateKeyEncrypted
  // — this function only generates key material, it does not touch storage.
  privateKeyHex: string;
}

function privateKeyToAddress(privateKey: Uint8Array): string {
  // Uncompressed public key is 65 bytes: 0x04 prefix + 32-byte x + 32-byte y. The Ethereum
  // address is the last 20 bytes of keccak256 of the 64-byte (x || y) point, i.e. the
  // public key with that leading 0x04 byte stripped — standard secp256k1-to-address
  // derivation, not Hyperliquid-specific.
  const uncompressedPubKey = secp256k1.getPublicKey(privateKey, false);
  const pubKeyWithoutPrefix = uncompressedPubKey.slice(1);
  const hash = keccak_256(pubKeyWithoutPrefix);
  const addressBytes = hash.slice(-20);
  return `0x${bytesToHex(addressBytes)}`;
}

export function generateAgentWallet(): AgentWallet {
  const privateKey = randomBytes(32);
  return {
    address: privateKeyToAddress(privateKey),
    privateKeyHex: `0x${bytesToHex(privateKey)}`,
  };
}
