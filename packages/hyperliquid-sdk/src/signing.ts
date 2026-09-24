import { z } from "zod";

// EIP-712 typed-data construction for Hyperliquid's "user-signed actions" — the signing
// scheme where the USER'S OWN wallet produces the signature (as opposed to "L1 actions",
// e.g. placing an order, which an approved agent wallet signs — NOT implemented here; see
// CLAUDE.md's Phase A/B split, 2026-09-22: order/agent signing is Phase B only).
//
// Hyperliquid's own Signing docs (hyperliquid-docs MCP, verified 2026-09-20) explicitly warn
// against hand-deriving this ("there are many potential ways in which signatures can be
// wrong... it is recommended to read through the Python SDK carefully"). Every shape below
// was copied from, not guessed to match, the official Python SDK's
// hyperliquid/utils/signing.py (github.com/hyperliquid-dex/hyperliquid-python-sdk, fetched
// and read directly, verified 2026-09-22):
//   - user_signed_payload() for the EIP-712 domain/types/primaryType envelope
//   - sign_agent() for ApproveAgent's specific field list and primaryType string
//   - sign_user_signed_action() for signatureChainId/hyperliquidChain
//
// The Python SDK hardcodes signatureChainId to "0x66eee" for every user-signed action
// regardless of mainnet/testnet ("signatureChainId is the chain used by the wallet to sign
// and can be any chain" — verified directly in signing.py's own comment, 2026-09-22).
//
// CONFIRMED CORRECT — 2026-09-24, real testnet round-trip. This was an OPEN VERIFICATION
// ITEM (flagged by hyperliquid-api-reviewer, 2026-09-22): the hyperliquid-docs MCP does not
// confirm "0x66eee" anywhere and its own worked EIP-712 examples (SpotSend, withdraw3) use
// "0xa4b1"/42161 (Arbitrum One) for BOTH "Mainnet" and "Testnet" hyperliquidChain values
// instead — the MCP alone couldn't settle whether "0x66eee" was truly arbitrary (as the
// Python SDK's own comment claims) or actually wrong. Resolved by doing exactly what this
// comment used to ask for: a real MetaMask wallet signed a real approveAgent typed-data
// payload built with "0x66eee" (domain chainId 421614, Arbitrum Sepolia), and Hyperliquid's
// testnet /exchange ACCEPTED the signature — it rejected the call on an unrelated business
// rule ("Must deposit before performing actions"), not on signature/domain verification. A
// wrong signatureChainId would fail signature verification itself, not reach a downstream
// account-state check — this is real evidence "0x66eee" is correct, not just that local
// recovery succeeds (which the Signing docs, verified 2026-09-20, warn is not sufficient
// proof on its own — this is the stronger, actual-server-acceptance check they ask for).
export const USER_SIGNED_ACTION_SIGNATURE_CHAIN_ID = "0x66eee";

export type HyperliquidChain = "Mainnet" | "Testnet";

export function hyperliquidChainFor(isMainnet: boolean): HyperliquidChain {
  return isMainnet ? "Mainnet" : "Testnet";
}

// EIP-712 typed-data shape, matching what viem's `signTypedData` (or any EIP-712-capable
// wallet client) expects for `domain`/`types`/`primaryType`/`message`. This module never
// imports a wallet library — apps/web is the one place a real signature is produced (the
// user's own wallet signs it), so this stays a plain data-construction function with no
// signing capability of its own.
export interface Eip712TypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

const APPROVE_AGENT_SIGN_TYPES = [
  { name: "hyperliquidChain", type: "string" },
  { name: "agentAddress", type: "address" },
  { name: "agentName", type: "string" },
  { name: "nonce", type: "uint64" },
] as const;

// Required by eth_signTypedData_v4 itself (EIP-712's own spec), not Hyperliquid-specific —
// wallets that call the raw JSON-RPC method directly (apps/web/src/lib/wallet.ts does, no
// viem/wagmi) look up `types.EIP712Domain` to hash the domain separator and throw if it's
// missing. Libraries like viem/ethers auto-inject this when you pass a `domain` object
// separately, which is why this omission wasn't caught until a real-wallet test (code-review,
// 2026-09-23 — flagged as an untested-path launch blocker, not yet independently confirmed
// against a live wallet at the time of this fix).
const EIP712_DOMAIN_TYPES = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

export const approveAgentActionSchema = z.object({
  type: z.literal("approveAgent"),
  hyperliquidChain: z.enum(["Mainnet", "Testnet"]),
  signatureChainId: z.literal(USER_SIGNED_ACTION_SIGNATURE_CHAIN_ID),
  agentAddress: z.string(),
  agentName: z.string(),
  nonce: z.number().int().positive(),
});
export type ApproveAgentAction = z.infer<typeof approveAgentActionSchema>;

// Named agent, not one of the account's single "unnamed" slot — a matching agentName is
// what makes re-linking idempotent (re-approving deregisters the previous agent with the
// same name, per nonces-and-api-wallets docs, verified 2026-09-20), and avoids silently
// colliding with an unnamed agent wallet the user may have approved for some other app.
export const AGENT_NAME = "HyperTracker";

/**
 * Builds the unsigned approveAgent action. `nonce` must be the current timestamp in
 * milliseconds (Hyperliquid docs: "must match nonce in outer request body") — the caller
 * passes it in rather than this function calling Date.now() itself, so the exact same value
 * can be reused for both the action object and the outer POST /exchange request body.
 */
export function buildApproveAgentAction(
  agentAddress: string,
  nonce: number,
  isMainnet: boolean,
): ApproveAgentAction {
  return {
    type: "approveAgent",
    hyperliquidChain: hyperliquidChainFor(isMainnet),
    signatureChainId: USER_SIGNED_ACTION_SIGNATURE_CHAIN_ID,
    // Lowercased per the Signing docs' own recommendation (verified 2026-09-20) — see
    // agent-wallet.ts's AgentWallet.address doc comment.
    agentAddress: agentAddress.toLowerCase(),
    agentName: AGENT_NAME,
    nonce,
  };
}

/**
 * The EIP-712 payload apps/web hands to the user's own wallet (e.g. viem's
 * `walletClient.signTypedData(buildApproveAgentTypedData(...))`) — WE never see or produce
 * this signature, only the shape it must be computed over.
 */
export function buildApproveAgentTypedData(action: ApproveAgentAction): Eip712TypedData {
  return {
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: parseInt(action.signatureChainId, 16),
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: {
      EIP712Domain: EIP712_DOMAIN_TYPES.map((field) => ({ ...field })),
      "HyperliquidTransaction:ApproveAgent": APPROVE_AGENT_SIGN_TYPES.map((field) => ({
        ...field,
      })),
    },
    primaryType: "HyperliquidTransaction:ApproveAgent",
    // Only the 4 fields listed in APPROVE_AGENT_SIGN_TYPES actually get hashed by a
    // standards-compliant EIP-712 encoder — passing the full action (including `type`,
    // which is not itself part of the signed struct) matches the reference SDK's own
    // `user_signed_payload(primary_type, payload_types, action)`, which does the same.
    message: action,
  };
}

export const eip712SignatureSchema = z.object({
  r: z.string(),
  s: z.string(),
  v: z.number().int(),
});
export type Eip712Signature = z.infer<typeof eip712SignatureSchema>;
