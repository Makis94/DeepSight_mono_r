// Subpath import — see realtime-client.ts for why the package root is avoided in browser code.
import {
  activeCoinsResponseSchema,
  coinPricesResponseSchema,
} from "@hypertracker/shared/schemas/coins";
import type { CoinPrice } from "@hypertracker/shared/schemas/coins";
import { recentEventsResponseSchema } from "@hypertracker/shared/schemas/events";
import type { SettingsResponse } from "@hypertracker/shared/schemas/settings";
import { z } from "zod";
import { watchedWalletResponseSchema } from "@hypertracker/shared/schemas/watched-wallet";
import {
  createInvoiceResponseSchema,
  subscriptionResponseSchema,
  type CreateInvoiceResponse,
  type SubscriptionResponse,
} from "@hypertracker/shared/schemas/subscription";
import type { RealtimeEvent } from "./realtime-client.js";

const API_URL = import.meta.env.VITE_API_URL;

// Harmless in production (a real API host just ignores an unknown header) — needed only
// when VITE_API_URL points at an ngrok free-tier tunnel, which otherwise serves an HTML
// interstitial instead of JSON to any origin that hasn't clicked through it first.
const NGROK_SKIP_WARNING_HEADERS = { "ngrok-skip-browser-warning": "true" };

interface AuthResponse {
  token: string;
}

export async function authenticateWithMiniApp(initData: string): Promise<string> {
  const response = await fetch(`${API_URL}/auth/mini-app`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...NGROK_SKIP_WARNING_HEADERS },
    body: JSON.stringify({ initData }),
  });
  if (!response.ok) {
    throw new Error(`mini-app auth failed: ${response.status}`);
  }
  const data = (await response.json()) as AuthResponse;
  return data.token;
}

export async function authenticateWithLoginWidget(
  payload: Record<string, string>,
): Promise<string> {
  const response = await fetch(`${API_URL}/auth/login-widget`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...NGROK_SKIP_WARNING_HEADERS },
    body: JSON.stringify({ payload }),
  });
  if (!response.ok) {
    throw new Error(`login-widget auth failed: ${response.status}`);
  }
  const data = (await response.json()) as AuthResponse;
  return data.token;
}

export type WatchedWallet = z.infer<typeof watchedWalletResponseSchema>;

const listWatchedWalletsResponseSchema = z.object({
  wallets: z.array(watchedWalletResponseSchema),
});

export async function listWatchedWallets(token: string): Promise<WatchedWallet[]> {
  const response = await fetch(`${API_URL}/watched-wallets`, {
    headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
  });
  if (!response.ok) {
    throw new Error(`failed to list watched wallets: ${response.status}`);
  }
  return listWatchedWalletsResponseSchema.parse(await response.json()).wallets;
}

// "precise" = one of the platform's 10 full-fidelity Hyperliquid-subscription slots;
// "common" = matched against the public trades feed instead (unlimited, lower fidelity).
// See CLAUDE.md-adjacent apps/worker/src/common-wallet-tracker for the split. Only one
// wallet per user can hold "precise" at a time — requesting it for a different wallet
// auto-swaps the old one back to "common" server-side.
const precisePromoteResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("assigned") }),
  z.object({ status: z.literal("queued"), queuePosition: z.number().int().positive() }),
]);
export type PrecisePromoteResult = z.infer<typeof precisePromoteResponseSchema>;

export async function promoteToPrecise(
  token: string,
  walletId: number,
): Promise<PrecisePromoteResult> {
  const response = await fetch(`${API_URL}/watched-wallets/${walletId}/precise`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
  });
  if (!response.ok) {
    throw new Error(`failed to request precise tracking: ${response.status}`);
  }
  return precisePromoteResponseSchema.parse(await response.json());
}

export async function demoteToCommon(token: string, walletId: number): Promise<void> {
  const response = await fetch(`${API_URL}/watched-wallets/${walletId}/precise`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
  });
  if (!response.ok) {
    throw new Error(`failed to release precise slot: ${response.status}`);
  }
}

// Thrown specifically for a 409 slot-limit response so callers can distinguish "show the
// slot-full popup" from any other failure (network error, invalid address, ...).
export class WalletSlotLimitError extends Error {}

// Adds a wallet to this user's list (up to MAX_WATCHED_WALLETS, see packages/shared) rather
// than replacing a single slot.
export async function trackWallet(token: string, address: string): Promise<WatchedWallet> {
  const response = await fetch(`${API_URL}/watched-wallets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...NGROK_SKIP_WARNING_HEADERS,
    },
    body: JSON.stringify({ address }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    const message = body?.error ?? `failed to track wallet: ${response.status}`;
    if (body?.code === "SLOT_LIMIT") {
      throw new WalletSlotLimitError(message);
    }
    throw new Error(message);
  }
  const data = (await response.json()) as { wallet: WatchedWallet };
  return data.wallet;
}

export async function untrackWallet(token: string, address: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/watched-wallets?address=${encodeURIComponent(address)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
    },
  );
  if (!response.ok) {
    throw new Error(`failed to untrack wallet: ${response.status}`);
  }
}

// Reuses the shared response schema's inferred type directly rather than hand-rolling a
// duplicate interface next to it — see CLAUDE.md's Zod rule on schema/type drift.
export type Settings = SettingsResponse;

export async function getSettings(token: string): Promise<Settings> {
  const response = await fetch(`${API_URL}/settings`, {
    headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
  });
  if (!response.ok) {
    throw new Error(`failed to load settings: ${response.status}`);
  }
  return (await response.json()) as Settings;
}

// The top-250-CMC ∩ Hyperliquid-listed coin list (coin_registry, isActive=true) — populates
// the coin filter dropdown on the large-trades feed.
export async function listActiveCoins(token: string): Promise<string[]> {
  const response = await fetch(`${API_URL}/coins`, {
    headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
  });
  if (!response.ok) {
    throw new Error(`failed to list coins: ${response.status}`);
  }
  return activeCoinsResponseSchema.parse(await response.json()).coins;
}

// Header price ticker (fixed coin list, see HEADER_TICKER_COINS) — polled on an interval
// rather than pushed over the realtime WS channel, same REST-poll pattern as
// listActiveCoins above. A missing symbol just means the worker hasn't upserted it yet.
export async function listCoinPrices(token: string): Promise<CoinPrice[]> {
  const response = await fetch(`${API_URL}/prices`, {
    headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
  });
  if (!response.ok) {
    throw new Error(`failed to list coin prices: ${response.status}`);
  }
  return coinPricesResponseSchema.parse(await response.json()).prices;
}

// Recent events matching this user's watched wallets / trade / TWAP thresholds — seeds the
// feed panels on page load and on every realtime reconnect (see FeedPage) so they don't sit
// on an empty "Waiting for events…" until the next live-pushed match happens to arrive.
export async function listRecentEvents(token: string): Promise<RealtimeEvent[]> {
  const response = await fetch(`${API_URL}/events`, {
    headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
  });
  if (!response.ok) {
    throw new Error(`failed to load recent events: ${response.status}`);
  }
  return recentEventsResponseSchema.parse(await response.json()).events;
}

// amount and enabled are each optional but at least one must be set — picking a preset sends
// only { amount }, the "Off" toggle sends only { enabled: false } (see updateTradeThresholdBodySchema).
export async function updateTradeThreshold(
  token: string,
  { amount, enabled }: { amount?: string; enabled?: boolean },
): Promise<Settings> {
  const response = await fetch(`${API_URL}/settings/trade-threshold`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...NGROK_SKIP_WARNING_HEADERS,
    },
    body: JSON.stringify({
      ...(amount !== undefined && { minTradeAmount: amount }),
      ...(enabled !== undefined && { notifyTrades: enabled }),
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `failed to update trade threshold: ${response.status}`);
  }
  return (await response.json()) as Settings;
}

export async function updateTwapThreshold(
  token: string,
  { amount, enabled }: { amount?: string; enabled?: boolean },
): Promise<Settings> {
  const response = await fetch(`${API_URL}/settings/twap-threshold`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...NGROK_SKIP_WARNING_HEADERS,
    },
    body: JSON.stringify({
      ...(amount !== undefined && { minTwapAmount: amount }),
      ...(enabled !== undefined && { notifyTwaps: enabled }),
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `failed to update twap threshold: ${response.status}`);
  }
  return (await response.json()) as Settings;
}

// Shared across the Large trades and Likely TWAPs tables — see users.excludeBtc/excludeEth
// doc comment (packages/db) for why this is one setting, not two per-table toggles.
export async function updateCoinExclusions(
  token: string,
  { excludeBtc, excludeEth }: { excludeBtc?: boolean; excludeEth?: boolean },
): Promise<Settings> {
  const response = await fetch(`${API_URL}/settings/coin-exclusions`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...NGROK_SKIP_WARNING_HEADERS,
    },
    body: JSON.stringify({
      ...(excludeBtc !== undefined && { excludeBtc }),
      ...(excludeEth !== undefined && { excludeEth }),
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `failed to update coin exclusions: ${response.status}`);
  }
  return (await response.json()) as Settings;
}

export async function getSubscription(token: string): Promise<SubscriptionResponse> {
  const response = await fetch(`${API_URL}/subscription`, {
    headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
  });
  if (!response.ok) {
    throw new Error(`failed to load subscription: ${response.status}`);
  }
  return subscriptionResponseSchema.parse(await response.json());
}

// Thrown specifically for a 409 "trial already used" response — see WalletSlotLimitError
// above for the same pattern.
export class TrialAlreadyUsedError extends Error {}

export async function startTrial(token: string): Promise<SubscriptionResponse> {
  const response = await fetch(`${API_URL}/subscription/trial`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
  });
  if (!response.ok) {
    if (response.status === 409) {
      throw new TrialAlreadyUsedError("trial already used");
    }
    throw new Error(`failed to start trial: ${response.status}`);
  }
  return subscriptionResponseSchema.parse(await response.json());
}

export async function createSubscriptionInvoice(token: string): Promise<CreateInvoiceResponse> {
  const response = await fetch(`${API_URL}/subscription/invoice`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
  });
  if (!response.ok) {
    throw new Error(`failed to create invoice: ${response.status}`);
  }
  return createInvoiceResponseSchema.parse(await response.json());
}

export async function updateDepositThreshold(
  token: string,
  { amount, enabled }: { amount?: string; enabled?: boolean },
): Promise<Settings> {
  const response = await fetch(`${API_URL}/settings/deposit-threshold`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...NGROK_SKIP_WARNING_HEADERS,
    },
    body: JSON.stringify({
      ...(amount !== undefined && { minDepositAmount: amount }),
      ...(enabled !== undefined && { notifyDeposits: enabled }),
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `failed to update deposit threshold: ${response.status}`);
  }
  return (await response.json()) as Settings;
}
