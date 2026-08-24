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
import { notifySessionExpired } from "./session-events.js";

const API_URL = import.meta.env.VITE_API_URL;

// Harmless in production (a real API host just ignores an unknown header) — needed only
// when VITE_API_URL points at an ngrok free-tier tunnel, which otherwise serves an HTML
// interstitial instead of JSON to any origin that hasn't clicked through it first.
const NGROK_SKIP_WARNING_HEADERS = { "ngrok-skip-browser-warning": "true" };

interface AuthResponse {
  token: string;
}

// Thrown by authFetch on a 401 — distinct from a plain Error so callers (and App.tsx via
// notifySessionExpired) can tell "your session expired" apart from a network failure or any
// other status. See session-events.ts for how App.tsx uses this to bounce back to sign-in
// instead of getting stuck showing a generic error forever.
export class UnauthorizedError extends Error {}

// Every authenticated endpoint below goes through this instead of a raw fetch, so a 401 is
// detected and reported (via notifySessionExpired) in exactly one place rather than in each
// of the ~15 call sites. Non-401 non-ok responses are returned as-is — callers still do their
// own status/body handling for those (409 slot-limit, 409 trial-already-used, etc.).
async function authFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      ...NGROK_SKIP_WARNING_HEADERS,
    },
  });
  if (response.status === 401) {
    notifySessionExpired();
    throw new UnauthorizedError("session expired");
  }
  return response;
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

// Revokes the session server-side (see apps/api's sessions table) instead of only clearing
// it from this browser's localStorage — without this, "sign out" was purely cosmetic and the
// token kept working elsewhere for up to SESSION_TTL. Deliberately swallows any failure: the
// user is signing out either way, and a network hiccup here shouldn't block that locally.
export async function logout(token: string): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...NGROK_SKIP_WARNING_HEADERS },
    });
  } catch (err) {
    console.error("failed to revoke session server-side", err);
  }
}

export type WatchedWallet = z.infer<typeof watchedWalletResponseSchema>;

const listWatchedWalletsResponseSchema = z.object({
  wallets: z.array(watchedWalletResponseSchema),
});

export async function listWatchedWallets(token: string): Promise<WatchedWallet[]> {
  const response = await authFetch(`${API_URL}/watched-wallets`, token);
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
  const response = await authFetch(`${API_URL}/watched-wallets/${walletId}/precise`, token, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`failed to request precise tracking: ${response.status}`);
  }
  return precisePromoteResponseSchema.parse(await response.json());
}

export async function demoteToCommon(token: string, walletId: number): Promise<void> {
  const response = await authFetch(`${API_URL}/watched-wallets/${walletId}/precise`, token, {
    method: "DELETE",
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
  const response = await authFetch(`${API_URL}/watched-wallets`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const response = await authFetch(
    `${API_URL}/watched-wallets?address=${encodeURIComponent(address)}`,
    token,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`failed to untrack wallet: ${response.status}`);
  }
}

// Reuses the shared response schema's inferred type directly rather than hand-rolling a
// duplicate interface next to it — see CLAUDE.md's Zod rule on schema/type drift.
export type Settings = SettingsResponse;

export async function getSettings(token: string): Promise<Settings> {
  const response = await authFetch(`${API_URL}/settings`, token);
  if (!response.ok) {
    throw new Error(`failed to load settings: ${response.status}`);
  }
  return (await response.json()) as Settings;
}

// The top-250-CMC ∩ Hyperliquid-listed coin list (coin_registry, isActive=true) — populates
// the coin filter dropdown on the large-trades feed.
export async function listActiveCoins(token: string): Promise<string[]> {
  const response = await authFetch(`${API_URL}/coins`, token);
  if (!response.ok) {
    throw new Error(`failed to list coins: ${response.status}`);
  }
  return activeCoinsResponseSchema.parse(await response.json()).coins;
}

// Header price ticker (fixed coin list, see HEADER_TICKER_COINS) — polled on an interval
// rather than pushed over the realtime WS channel, same REST-poll pattern as
// listActiveCoins above. A missing symbol just means the worker hasn't upserted it yet.
export async function listCoinPrices(token: string): Promise<CoinPrice[]> {
  const response = await authFetch(`${API_URL}/prices`, token);
  if (!response.ok) {
    throw new Error(`failed to list coin prices: ${response.status}`);
  }
  return coinPricesResponseSchema.parse(await response.json()).prices;
}

// Recent events matching this user's watched wallets / trade / TWAP thresholds — seeds the
// feed panels on page load and on every realtime reconnect (see FeedPage) so they don't sit
// on an empty "Waiting for events…" until the next live-pushed match happens to arrive.
export async function listRecentEvents(token: string): Promise<RealtimeEvent[]> {
  const response = await authFetch(`${API_URL}/events`, token);
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
  const response = await authFetch(`${API_URL}/settings/trade-threshold`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
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
  const response = await authFetch(`${API_URL}/settings/twap-threshold`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
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
  const response = await authFetch(`${API_URL}/settings/coin-exclusions`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
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
  const response = await authFetch(`${API_URL}/subscription`, token);
  if (!response.ok) {
    throw new Error(`failed to load subscription: ${response.status}`);
  }
  return subscriptionResponseSchema.parse(await response.json());
}

// Thrown specifically for a 409 "trial already used" response — see WalletSlotLimitError
// above for the same pattern.
export class TrialAlreadyUsedError extends Error {}

export async function startTrial(token: string): Promise<SubscriptionResponse> {
  const response = await authFetch(`${API_URL}/subscription/trial`, token, {
    method: "POST",
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
  const response = await authFetch(`${API_URL}/subscription/invoice`, token, {
    method: "POST",
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
  const response = await authFetch(`${API_URL}/settings/deposit-threshold`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
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
