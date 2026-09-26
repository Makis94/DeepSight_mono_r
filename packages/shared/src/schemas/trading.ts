import { z } from "zod";
import { decimalString, tradeSide } from "./events.js";
import { walletAddressSchema } from "./watched-wallet.js";
import {
  AUTO_TRADE_STATUSES,
  TRADING_LINK_STATUSES,
  TRADING_MODES,
  TWAP_TIERS,
} from "../constants.js";

export const tradingLinkStatusSchema = z.enum(TRADING_LINK_STATUSES);
export const tradingModeSchema = z.enum(TRADING_MODES);
export const twapTierSchema = z.enum(TWAP_TIERS);
export const autoTradeStatusSchema = z.enum(AUTO_TRADE_STATUSES);

// A decimal string that must represent a positive amount — the format check is
// decimalString's own regex; the positivity check parses to Number only to VALIDATE, never
// to produce the value that gets stored (the original string passes through unchanged).
// code-review (2026-09-23): updateRiskLimitsBodySchema used to be z.coerce.number(), which
// parsed the client's input to a JS float and .toString()'d that float before it reached
// Postgres — a float round-trip on money CLAUDE.md's TypeScript rules explicitly forbid.
const positiveDecimalString = decimalString.refine((value) => Number(value) > 0, {
  message: "expected a positive amount",
});

// POST /trading/link/start — the frontend already knows its own connected wallet address
// (from its own wallet-connect flow, e.g. viem/wagmi) before any signature is requested.
export const startLinkBodySchema = z.object({
  walletAddress: walletAddressSchema,
});
export type StartLinkBody = z.infer<typeof startLinkBodySchema>;

// The exact shape a viem-style `walletClient.signTypedData(...)` call expects — mirrors
// packages/hyperliquid-sdk signing.ts's Eip712TypedData one to one (kept as a separate Zod
// schema here since packages/hyperliquid-sdk itself has no reason to depend on
// packages/shared, and apps/web needs a validated response shape either way).
export const eip712TypedDataResponseSchema = z.object({
  domain: z.object({
    name: z.string(),
    version: z.string(),
    chainId: z.number(),
    verifyingContract: z.string(),
  }),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});
export type Eip712TypedDataResponse = z.infer<typeof eip712TypedDataResponseSchema>;

export const startLinkResponseSchema = z.object({
  agentAddress: z.string(),
  nonce: z.number().int().positive(),
  typedData: eip712TypedDataResponseSchema,
});
export type StartLinkResponse = z.infer<typeof startLinkResponseSchema>;

// The {r, s, v} a wallet's signTypedData call returns.
export const eip712SignatureBodySchema = z.object({
  r: z.string(),
  s: z.string(),
  v: z.number().int(),
});

export const confirmLinkBodySchema = z.object({
  signature: eip712SignatureBodySchema,
});
export type ConfirmLinkBody = z.infer<typeof confirmLinkBodySchema>;

export const tradingAccountResponseSchema = z.object({
  linked: z.boolean(),
  linkStatus: tradingLinkStatusSchema.optional(),
  walletAddress: z.string().nullable().optional(),
  agentExpiresAt: z.string().nullable().optional(),
  tradingEnabled: z.boolean().optional(),
  mode: tradingModeSchema.optional(),
});
export type TradingAccountResponse = z.infer<typeof tradingAccountResponseSchema>;

// PATCH /trading/account/status — the single checkbox described in CLAUDE.md's unified
// apps/web page decision (2026-09-22): checked = tradingEnabled true, unchecked = soft stop.
export const updateTradingStatusBodySchema = z.object({
  tradingEnabled: z.boolean(),
});
export type UpdateTradingStatusBody = z.infer<typeof updateTradingStatusBodySchema>;

// A Hyperliquid coin symbol as the API/auto-trader use it — case-sensitive on purpose ("kPEPE"
// is not "KPEPE"), optionally dex-prefixed for HIP-3 assets ("xyz:NVDA"). Format-checked only,
// not membership-checked against any list: the auto-trader can trade coins outside the
// top-250 registry, and a stale list must never make a saved ignore un-saveable.
export const coinSymbolSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{1,20}(:[A-Za-z0-9]{1,20})?$/, "invalid coin symbol");
export const MAX_IGNORED_COINS = 100;
const ignoredCoinsSchema = z
  .array(coinSymbolSchema)
  .max(MAX_IGNORED_COINS)
  .transform((coins) => [...new Set(coins)]);

export const riskLimitsResponseSchema = z.object({
  baseSizeUsd: decimalString,
  maxPositionUsd: decimalString,
  maxDailyLossUsd: decimalString,
  // .default([]) so a web build that lands a few minutes before the api that started sending
  // this field (Vercel deploys far faster than scripts/deploy.sh) still parses old responses.
  ignoredCoins: z.array(z.string()).default([]),
});
export type RiskLimitsResponse = z.infer<typeof riskLimitsResponseSchema>;

// All optional — a PATCH only updates the fields the user actually changed, per the usual
// partial-update convention. At least one of the three should be present; enforced at the
// route, not the schema, so the error message can be specific.
export const updateRiskLimitsBodySchema = z.object({
  baseSizeUsd: positiveDecimalString.optional(),
  maxPositionUsd: positiveDecimalString.optional(),
  maxDailyLossUsd: positiveDecimalString.optional(),
  // Full replacement list, not add/remove deltas — the form always sends the whole tag set.
  ignoredCoins: ignoredCoinsSchema.optional(),
});
export type UpdateRiskLimitsBody = z.infer<typeof updateRiskLimitsBodySchema>;

// GET /trading/coins — the options for the "ignored coins" tag picker.
export const tradingCoinsResponseSchema = z.object({ coins: z.array(z.string()) });
export type TradingCoinsResponse = z.infer<typeof tradingCoinsResponseSchema>;

// GET /trading/leaderboard row — one EXTERNAL wallet's Trust Score, not one of our own
// users (see packages/db trust-scores.ts's own doc comment on this distinction).
export const leaderboardEntrySchema = z.object({
  walletAddress: z.string(),
  // Raw computeTrustScore() output — kept for transparency. Ranking/display should prefer
  // effectiveScore below, the confidence-adjusted number sizing decisions actually use (see
  // packages/trading-core evaluateWalletTrust, added 2026-09-22).
  score: decimalString,
  confidence: decimalString,
  effectiveScore: decimalString,
  blocked: z.boolean(),
  totalSignals: z.number().int().nonnegative(),
  fullyExecutedCount: z.number().int().nonnegative(),
  cancelledCount: z.number().int().nonnegative(),
  lastEventAt: z.string().nullable(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardResponseSchema = z.object({
  entries: z.array(leaderboardEntrySchema),
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

// GET /trading/trades row — one auto_trades row (paper or, later, live), for the activity
// feed the unified apps/web trading page shows.
export const autoTradeResponseSchema = z.object({
  id: z.number().int().positive(),
  coin: z.string(),
  side: tradeSide,
  sizeUsd: decimalString,
  entryPx: decimalString.nullable(),
  stopLossPx: decimalString,
  takeProfitPx: decimalString,
  status: autoTradeStatusSchema,
  realizedPnlUsd: decimalString.nullable(),
  mode: tradingModeSchema,
  openedAt: z.string(),
  closedAt: z.string().nullable(),
});
export type AutoTradeResponse = z.infer<typeof autoTradeResponseSchema>;

export const autoTradesResponseSchema = z.object({
  trades: z.array(autoTradeResponseSchema),
});
export type AutoTradesResponse = z.infer<typeof autoTradesResponseSchema>;
