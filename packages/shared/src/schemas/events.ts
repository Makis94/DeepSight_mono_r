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

// Hyperliquid's own TWAP data (userTwapHistory, userTwapSliceFills) is per-address only,
// there is no market-wide TWAP feed — so this module first PATTERN-MATCHES over the public
// `trades` feed (same address repeatedly trading the same coin on the same side, in similar
// sizes, within a bounded time gap — see market-watcher's twap-heuristic.ts) to decide which
// addresses are worth checking, then does a one-off REST lookup (getUserTwapSliceFills, see
// twap-confirm.ts) against that specific address for matching real TWAP slice fills.
//
// The pattern-match alone is NOT a sufficient reason to show anything to a user — testing
// showed it mostly flags addresses that aren't running a TWAP at all (an active trader or
// market-maker repeating similar-sized trades looks identical to a TWAP on the public trades
// tape alone). So every event of this type is only ever published once the REST lookup found
// a real matching twapId for it — occurrences/avgPrice/notionalUsd/twapId here are always
// aggregated from actual Hyperliquid TWAP fills, never estimated. A candidate the lookup
// doesn't (yet) confirm is simply never published (see twap-confirm.ts) — there is no
// unconfirmed/"likely" variant of this event.
export const marketTwapSuspectedPayloadSchema = z.object({
  type: z.literal("market_twap_suspected"),
  coin: z.string(),
  side: tradeSide,
  address: walletAddressSchema,
  notionalUsd: decimalString,
  avgPrice: decimalString,
  occurrences: z.number().int().positive(),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  // The real Hyperliquid TWAP id the matching slice fills were grouped under.
  twapId: z.number(),
});
export type MarketTwapSuspectedPayload = z.infer<typeof marketTwapSuspectedPayloadSchema>;

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
  marketTwapSuspectedPayloadSchema,
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
