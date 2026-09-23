// Thin EIP-1193 wrapper around the browser's injected wallet (MetaMask/Rabby/etc,
// window.ethereum) — deliberately no wallet library (viem/wagmi/ethers): the only two calls
// this feature needs are `eth_requestAccounts` and `eth_signTypedData_v4`, both plain
// EIP-1193 JSON-RPC methods, so a whole library would just be dead weight. Mirrors
// packages/hyperliquid-sdk's own choice (@noble/curves over viem/ethers for agent-key
// generation) of minimal deps over a heavy wallet SDK for a narrow need.
//
// STANDALONE SITE ONLY, by design (CLAUDE.md dual-context rule) — a Telegram Mini App
// WebView does not inject window.ethereum the way a desktop/mobile browser does; there is no
// wallet-connect flow here for the Mini App context yet (would need a real WalletConnect
// integration, a separate, larger feature not built in this pass). See
// features/trading/AccountLinkCard.tsx for how the Mini App context is told to open the
// standalone site instead, rather than silently failing.
import type { Eip712TypedDataResponse } from "@hypertracker/shared/schemas/trading";

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && window.ethereum !== undefined;
}

export class WalletError extends Error {}

/** Prompts the browser wallet's connect dialog and returns the first authorized address, lowercased. */
export async function connectWallet(): Promise<string> {
  const provider = window.ethereum;
  if (!provider) {
    throw new WalletError("No browser wallet found (install MetaMask, Rabby, or similar).");
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) {
    throw new WalletError("Wallet connected but returned no account.");
  }
  return address.toLowerCase();
}

/**
 * Signs an EIP-712 typed-data payload with the connected wallet and returns {r, s, v} — the
 * exact shape packages/hyperliquid-sdk's signing.ts / apps/api's confirmLinkBodySchema
 * expect. `eth_signTypedData_v4` takes the payload as a JSON STRING (not an object) per its
 * own spec — a common footgun this wrapper hides.
 */
export async function signTypedData(
  address: string,
  typedData: Eip712TypedDataResponse,
): Promise<{ r: string; s: string; v: number }> {
  const provider = window.ethereum;
  if (!provider) {
    throw new WalletError("No browser wallet found.");
  }
  const signature = (await provider.request({
    method: "eth_signTypedData_v4",
    params: [address, JSON.stringify(typedData)],
  })) as string;

  // eth_signTypedData_v4 returns one 0x-prefixed 65-byte hex string (r ++ s ++ v), not a
  // structured object — split it into the {r, s, v} shape the backend expects.
  const hex = signature.startsWith("0x") ? signature.slice(2) : signature;
  if (hex.length !== 130) {
    throw new WalletError(`Unexpected signature length from wallet: ${hex.length} hex chars.`);
  }
  const r = `0x${hex.slice(0, 64)}`;
  const s = `0x${hex.slice(64, 128)}`;
  const vByte = parseInt(hex.slice(128, 130), 16);
  // Some wallets return 0/1 instead of 27/28 for the recovery id — normalize to 27/28, the
  // form Hyperliquid's own signature verification expects (standard Ethereum convention).
  const v = vByte < 27 ? vByte + 27 : vByte;

  return { r, s, v };
}
