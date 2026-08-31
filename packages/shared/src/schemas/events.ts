import { z } from "zod";
import { walletAddressSchema } from "./watched-wallet.js";

// Postgres `numeric` columns and Hyperliquid's own string-typed price/size fields both
// arrive as decimal strings — keep them that way end to end, never cast to number/float.
export const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "expected a decimal string");

export const tradeSide = z.enum(["buy", "sell"]);

// Shared shape for the 4 position-change categories. Two distinct producers write these:
// - source: "precise" — wallet-watcher, straight from a Hyperliquid WsFill. dir is
//   Hyperliquid's own human-readable direction ("Open Long", "Close Short", etc), kept
//   verbatim for audit/debugging even though `type` already encodes our classification of
//   it; closedPnl is Hyperliquid's own computed value.
// - source: "common" — common-wallet-tracker, derived from the public per-coin `trades`
//   feed (unlimited wallets, not subject to Hyperliquid's 10-unique-user WS cap) plus our
//   own wallet_position_state diffing. dir and closedPnl are Hyperliquid-native concepts
//   this path cannot produce — never fabricate them, leave absent. startPosition IS
//   available (it's our own tracked pre-trade position size). leverage/margin come from
//   the same public clearinghouseState REST lookup either way, so both sources can supply
//   them.
const walletPositionFillFields = {
  coin: z.string(),
  side: tradeSide,
  price: decimalString,
  size: decimalString,
  startPosition: decimalString,
  notionalUsd: decimalString,
  source: z.enum(["precise", "common"]).default("precise"),
  // Present only when source === "precise" — see comment above.
  closedPnl: decimalString.optional(),
  dir: z.string().optional(),
  // Leverage/margin of the position this fill belongs to, fetched separately from
  // Hyperliquid's clearinghouseState (a fill itself carries neither) — absent when the
  // position no longer exists by the time we looked it up (typically a full close) or the
  // lookup failed.
  leverageType: z.enum(["cross", "isolated"]).optional(),
  leverageValue: z.number().int().positive().optional(),
  marginUsedUsd: decimalString.optional(),
};

export const walletOpenLongPayloadSchema = z.object({
  type: z.literal("wallet_open_long"),
  ...walletPositionFillFields,
});
export type WalletOpenLongPayload = z.infer<typeof walletOpenLongPayloadSchema>;

export const walletOpenShortPayloadSchema = z.object({
  type: z.literal("wallet_open_short"),
  ...walletPositionFillFields,
});
export type WalletOpenShortPayload = z.infer<typeof walletOpenShortPayloadSchema>;

export const walletClosePositionPayloadSchema = z.object({
  type: z.literal("wallet_close_position"),
  ...walletPositionFillFields,
});
export type WalletClosePositionPayload = z.infer<typeof walletClosePositionPayloadSchema>;

// A fill that doesn't cleanly open or close a position (e.g. adding to or partially
// reducing an existing same-direction position) but whose notional exceeds the user's
// configured threshold.
export const walletLargePositionChangePayloadSchema = z.object({
  type: z.literal("wallet_large_position_change"),
  ...walletPositionFillFields,
});
export type WalletLargePositionChangePayload = z.infer<
  typeof walletLargePositionChangePayloadSchema
>;

export const walletTwapPayloadSchema = z.object({
  type: z.literal("wallet_twap"),
  coin: z.string(),
  side: tradeSide,
  size: decimalString,
  executedSize: decimalString,
  minutes: z.number().int().positive(),
  status: z.enum(["activated", "terminated", "finished", "error"]),
  // Same clearinghouseState lookup as wallet position-fill events — absent once the
  // underlying position no longer exists or the lookup failed.
  leverageType: z.enum(["cross", "isolated"]).optional(),
  leverageValue: z.number().int().positive().optional(),
  marginUsedUsd: decimalString.optional(),
});
export type WalletTwapPayload = z.infer<typeof walletTwapPayloadSchema>;

// One real suborder fill of a watched wallet's TWAP order, from Hyperliquid's own
// userTwapSliceFills (WS, for precise-mode wallets — see apps/worker/src/wallet-watcher/
// handlers/twap-slice-fills.ts). Distinct from wallet_twap: that event tracks the TWAP
// order's overall status transitions (activated/finished/...); this one is the individual
// executed suborder, real price/size/oid included, grouped by twapId.
export const walletTwapSlicePayloadSchema = z.object({
  type: z.literal("wallet_twap_slice_fill"),
  coin: z.string(),
  side: tradeSide,
  price: decimalString,
  size: decimalString,
  twapId: z.number(),
  oid: z.number(),
});
export type WalletTwapSlicePayload = z.infer<typeof walletTwapSlicePayloadSchema>;

export const walletDepositPayloadSchema = z.object({
  type: z.literal("wallet_deposit"),
  amountUsdc: decimalString,
});
export type WalletDepositPayload = z.infer<typeof walletDepositPayloadSchema>;

export const walletWithdrawalPayloadSchema = z.object({
  type: z.literal("wallet_withdrawal"),
  amountUsdc: decimalString,
  fee: decimalString,
});
export type WalletWithdrawalPayload = z.infer<typeof walletWithdrawalPayloadSchema>;

export const walletFundingPayloadSchema = z.object({
  type: z.literal("wallet_funding"),
  coin: z.string(),
  amountUsdc: decimalString,
  rate: decimalString,
});
export type WalletFundingPayload = z.infer<typeof walletFundingPayloadSchema>;

export const marketTradePayloadSchema = z.object({
  type: z.literal("market_trade"),
  coin: z.string(),
  side: tradeSide,
  price: decimalString,
  size: decimalString,
  // WsTrade.users is [buyer, seller] regardless of which side was the aggressor (see
  // `side`) — surfaced so a large trade can be turned directly into a watched wallet.
  buyerAddress: walletAddressSchema,
  sellerAddress: walletAddressSchema,
});
export type MarketTradePayload = z.infer<typeof marketTradePayloadSchema>;

// Global deposit monitoring (module 1) — detected on the Arbitrum Bridge2 contract via the
// DepositSource abstraction (see deposit-monitoring-architecture skill), not via any
// Hyperliquid API. Not tied to a watched wallet — depositorAddress can be ANY address, same
// "global, any-address" shape as marketTradePayloadSchema, fanned out by per-user
// minDepositAmount/notifyDeposits rather than a watchedWallets match (see RealtimeHub).
export const globalDepositPayloadSchema = z.object({
  type: z.literal("global_deposit"),
  depositorAddress: walletAddressSchema,
  amountUsdc: decimalString,
  txHash: z.string(),
  // Which on-chain path this deposit was detected on — see deposit-monitoring-architecture
  // skill. "arbitrum" = legacy Bridge2 contract, "hyperevm" = Circle's CCTP-forwarder path
  // (now the dominant one; the legacy bridge holds <10% of USDC supply on HyperCore).
  sourceChain: z.enum(["arbitrum", "hyperevm"]),
});
export type GlobalDepositPayload = z.infer<typeof globalDepositPayloadSchema>;

// Real, market-wide (ANY address, not just watched wallets) TWAP order lifecycle. Hyperliquid
// itself has no market-wide TWAP feed (userTwapHistory/userTwapSliceFills are per-address
// only) — same "no all-users endpoint" gap module 1 (deposits) has. This is sourced from
// QuickNode's HyperCore Data Streams "TWAP" dataset instead (see CLAUDE.md Post-MVP section,
// corrected 2026-08-27), which does stream every address's TWAP activity — no pattern-
// matching or REST-confirmation step needed, unlike the old heuristic this replaced
// (formerly marketTwapSuspectedPayloadSchema, apps/worker/src/market-watcher/twap-heuristic.ts
// + twap-confirm.ts, now removed).
export const marketTwapPayloadSchema = z.object({
  type: z.literal("market_twap"),
  // Hyperliquid's own TWAP order id — stable across this order's activated/finished/
  // terminated transitions, so a client can group the 2-3 events of one real order together.
  twapId: z.number(),
  // Raw Hyperliquid asset id, kept verbatim for the slice-fills drill-down: a plain ticker
  // ("BTC"), a HIP-3 "{dex}:{coin}" perp, or a spot id ("@107" / "PURR/USDC").
  coin: z.string(),
  // Whether `coin` is a perp or a spot market. Optional: rows written before spot TWAPs were
  // included have no value — treat a missing `market` as "perp" on read.
  market: z.enum(["perp", "spot"]).optional(),
  // Human-readable name for the UI/bot ("BTC", "xyz:NVDA", "HYPE/USDC"). Optional for the
  // same back-compat reason — fall back to `coin` when absent.
  displayCoin: z.string().optional(),
  side: tradeSide,
  address: walletAddressSchema,
  // Target order size, in base-asset units (e.g. ETH) — not USD. Same shape as wallet_twap's
  // `size`/`executedSize`.
  size: decimalString,
  executedSize: decimalString,
  // USD notional actually executed so far, straight from QuickNode's dataset — 0 (or absent)
  // at "activated" since nothing has filled yet, the real filled amount at "finished"/
  // "terminated".
  executedNotionalUsd: decimalString,
  // Only present at "activated": size × the Hyperliquid mid price twap-watcher had cached at
  // that moment, since executedNotionalUsd is still 0 and there is nothing else in this event
  // to size the order by. This is what the user's $-threshold is checked against at the
  // instant a TWAP opens; ignore it on later statuses and use executedNotionalUsd instead.
  estimatedNotionalUsd: decimalString.optional(),
  minutes: z.number().int().positive(),
  reduceOnly: z.boolean(),
  randomize: z.boolean(),
  status: z.enum(["activated", "finished", "terminated"]),
});
export type MarketTwapPayload = z.infer<typeof marketTwapPayloadSchema>;

export const eventPayloadSchema = z.discriminatedUnion("type", [
  walletOpenLongPayloadSchema,
  walletOpenShortPayloadSchema,
  walletClosePositionPayloadSchema,
  walletLargePositionChangePayloadSchema,
  walletTwapPayloadSchema,
  walletTwapSlicePayloadSchema,
  walletDepositPayloadSchema,
  walletWithdrawalPayloadSchema,
  walletFundingPayloadSchema,
  marketTradePayloadSchema,
  marketTwapPayloadSchema,
  globalDepositPayloadSchema,
]);

export type EventPayload = z.infer<typeof eventPayloadSchema>;

// The wire shape for a single event, shared by the realtime WS push (apps/api
// realtime/hub.ts) and the REST backfill endpoint (GET /events) — both serialize the same
// `events` row the same way, so this is their one shared source of truth rather than two
// hand-rolled shapes that could drift.
export const eventRecordSchema = z.object({
  id: z.number(),
  type: z.string(),
  coin: z.string().nullable(),
  side: z.string().nullable(),
  amountUsd: z.string().nullable(),
  walletAddress: z.string().nullable(),
  payload: eventPayloadSchema,
  occurredAt: z.string(),
});
export type EventRecord = z.infer<typeof eventRecordSchema>;

export const recentEventsResponseSchema = z.object({
  events: z.array(eventRecordSchema),
});
export type RecentEventsResponse = z.infer<typeof recentEventsResponseSchema>;
