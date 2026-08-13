import { z } from "zod";

// Per-user cap on watched wallets. Independent from HYPERLIQUID_WS_LIMITS.
// maxUniqueUsersForUserSubscriptions (packages/hyperliquid-sdk) even though both are 10
// today — that one is Hyperliquid's own per-IP cap across ALL users combined; this one is
// our product's per-user slot count. Don't derive one from the other.
export const MAX_WATCHED_WALLETS = 10;

// Arbitrum/EVM address format Hyperliquid accounts use. Lowercased on parse — every
// downstream table/lookup (watched_wallets.address, events.walletAddress) relies on the
// lowercase convention rather than case-insensitive comparisons at each call site.
export const walletAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "expected a 0x-prefixed 40-hex-character address")
  .transform((address) => address.toLowerCase());

export const addWatchedWalletBodySchema = z.object({
  address: walletAddressSchema,
});
export type AddWatchedWalletBody = z.infer<typeof addWatchedWalletBodySchema>;

// "precise" = holds one of the platform's 10 precise_slots (full-fidelity Hyperliquid
// per-user WS subscriptions). "common" = matched against the public trades feed instead
// (unlimited, lower fidelity) — see packages/db precise-tracking.ts and
// apps/worker/src/common-wallet-tracker. queuePosition is only present while
// trackingMode === "common" AND the wallet has an outstanding precise-slot request
// (1-indexed; 1 = next in line for the next freed slot).
export const trackingModeSchema = z.enum(["common", "precise"]);
export type TrackingMode = z.infer<typeof trackingModeSchema>;

export const watchedWalletResponseSchema = z.object({
  id: z.number().int().positive(),
  address: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
  trackingMode: trackingModeSchema,
  queuePosition: z.number().int().positive().optional(),
});
export type WatchedWalletResponse = z.infer<typeof watchedWalletResponseSchema>;
