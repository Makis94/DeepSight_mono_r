import { z } from "zod";
import type { Eip712Signature } from "./signing.js";
import {
  clearinghouseStateSchema,
  userTwapSliceFillsResponseSchema,
  type ClearinghouseState,
  type WsTwapSliceFill,
} from "./types.js";

// source: hyperliquid-docs MCP (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals), verified: 2026-07-27
const metaUniverseEntrySchema = z.object({
  name: z.string(),
  szDecimals: z.number(),
  maxLeverage: z.number(),
  onlyIsolated: z.boolean().optional(),
  isDelisted: z.boolean().optional(),
});

const metaResponseSchema = z.object({
  universe: z.array(metaUniverseEntrySchema),
});

export type MetaUniverseEntry = z.infer<typeof metaUniverseEntrySchema>;

/**
 * POST {baseUrl}/info { "type": "meta" } — returns the list of perpetuals Hyperliquid
 * currently supports (coin name, size decimals, max leverage). Delisted coins are
 * included with `isDelisted: true` — filter them out for "currently tradable" use cases.
 */
export async function getMeta(baseUrl: string): Promise<MetaUniverseEntry[]> {
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "meta" }),
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid meta request failed: ${response.status} ${response.statusText}`);
  }

  const json: unknown = await response.json();
  return metaResponseSchema.parse(json).universe;
}

/**
 * POST {baseUrl}/info { "type": "clearinghouseState", "user": address, dex? } — current
 * open perp positions for an address, including per-position leverage and margin used.
 * Info request weight 2 (source: hyperliquid-docs MCP, rate-limits-and-user-limits page,
 * verified: 2026-07-28) — cheap enough to call once per published wallet-fill event.
 *
 * `dex` (source: hyperliquid-docs MCP, info-endpoint/perpetuals page, verified: 2026-07-28)
 * defaults server-side to the first/default perp dex if omitted — for a HIP-3
 * builder-deployed perp (fill.coin formatted as "{dex}:{coin}", e.g. "xyz:XYZ100"), the
 * matching position only exists in that dex's own clearinghouseState, never the default
 * one, so callers must pass the dex name parsed from such a coin string.
 */
export async function getClearinghouseState(
  baseUrl: string,
  user: string,
  dex?: string,
): Promise<ClearinghouseState> {
  const body: Record<string, string> =
    dex !== undefined
      ? { type: "clearinghouseState", user, dex }
      : { type: "clearinghouseState", user };
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Hyperliquid clearinghouseState request failed: ${response.status} ${response.statusText}`,
    );
  }

  const json: unknown = await response.json();
  return clearinghouseStateSchema.parse(json);
}

/**
 * POST {baseUrl}/info { "type": "userTwapSliceFills", "user": address } — up to the 2000
 * most recent real TWAP suborder fills for an address, each tagged with its `twapId`.
 * Info request weight 20 plus additional weight per 20 items returned (source:
 * hyperliquid-docs MCP, rate-limits-and-user-limits page, verified: 2026-08-22) — meant to
 * be called on demand for a specific address, not polled on an interval. Used by
 * apps/api's GET /market-twaps/:twapId/slice-fills, called only when a user expands a
 * market_twap row in the web table, keeping call volume low.
 *
 * Unlike the `userTwapHistory`/`userTwapSliceFills` WS subscriptions, this is a one-off
 * REST call — it does not count against Hyperliquid's 10-unique-user cap on user-specific
 * WS subscriptions, so it can be used for arbitrary (not pre-watched) addresses.
 */
export async function getUserTwapSliceFills(
  baseUrl: string,
  user: string,
): Promise<WsTwapSliceFill[]> {
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "userTwapSliceFills", user }),
  });

  if (!response.ok) {
    throw new Error(
      `Hyperliquid userTwapSliceFills request failed: ${response.status} ${response.statusText}`,
    );
  }

  const json: unknown = await response.json();
  return userTwapSliceFillsResponseSchema.parse(json);
}

// Flat { coin: midPriceDecimalString } map — note this REST response is NOT wrapped in
// { mids: ... } the way the `allMids` WS channel's payload is. source: hyperliquid-docs MCP
// (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint,
// "Retrieve mids for all coins"), verified: 2026-08-30.
const allMidsResponseSchema = z.record(z.string(), z.string());
export type AllMidsResponse = z.infer<typeof allMidsResponseSchema>;

/**
 * POST {baseUrl}/info { "type": "allMids", dex? } — current mid price (decimal string) for
 * every coin on one perp dex. `dex` defaults to the empty string = the first/main perp dex;
 * pass a builder-deployed dex name (e.g. "xyz") to get that HIP-3 dex's mids, which the
 * main-dex response does NOT include. Spot mids are only present on the main dex.
 *
 * Info request weight 2 (source: hyperliquid-docs MCP, rate-limits-and-user-limits page,
 * verified: 2026-08-30) — cheap enough to poll on a short interval. Used by twap-watcher
 * instead of a second `allMids` WS connection: a duplicate `allMids` subscription opened
 * from the same IP as market-watcher's was observed in prod to get dropped repeatedly
 * within seconds (not documented behaviour), which starved twap-watcher of prices.
 *
 * The key format for a dex-scoped response ("SHEIN" vs "xyz:SHEIN") is not pinned down by
 * the docs, so callers looking up a `{dex}:{coin}` name should try both forms.
 */
export async function getAllMids(baseUrl: string, dex?: string): Promise<AllMidsResponse> {
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dex ? { type: "allMids", dex } : { type: "allMids" }),
  });

  if (!response.ok) {
    throw new Error(
      `Hyperliquid allMids request failed: ${response.status} ${response.statusText}`,
    );
  }

  const json: unknown = await response.json();
  return allMidsResponseSchema.parse(json);
}

// source: hyperliquid-docs MCP
// (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot,
// "Retrieve spot metadata"), verified: 2026-08-31. Only the fields we need are modelled;
// `.passthrough()` keeps the rest (weiDecimals, tokenId, evmContract, …) from failing parse
// as Hyperliquid adds token attributes over time.
const spotTokenSchema = z
  .object({ name: z.string(), index: z.number(), szDecimals: z.number() })
  .passthrough();
const spotPairSchema = z
  .object({
    name: z.string(),
    // [baseTokenIndex, quoteTokenIndex] into `tokens`.
    tokens: z.tuple([z.number(), z.number()]),
    index: z.number(),
  })
  .passthrough();
const spotMetaResponseSchema = z.object({
  tokens: z.array(spotTokenSchema),
  universe: z.array(spotPairSchema),
});
export type SpotMetaResponse = z.infer<typeof spotMetaResponseSchema>;

/**
 * POST {baseUrl}/info { "type": "spotMeta" } — the spot universe: every spot pair
 * (`universe[]`, each with `tokens: [baseIdx, quoteIdx]` into `tokens[]`) and every spot
 * token (`tokens[]`, name + index). Used to turn a spot TWAP's `coin` ("@107") into a
 * readable pair ("HYPE/USDC"). `universe[].name` is already readable for canonical pairs
 * (e.g. "PURR/USDC") and just "@{index}" otherwise.
 *
 * Info request weight 20 (source: hyperliquid-docs MCP, rate-limits-and-user-limits page —
 * "All other documented info requests have weight 20", verified: 2026-08-31) — refresh on a
 * multi-minute interval, never per-event.
 */
export async function getSpotMeta(baseUrl: string): Promise<SpotMetaResponse> {
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "spotMeta" }),
  });

  if (!response.ok) {
    throw new Error(
      `Hyperliquid spotMeta request failed: ${response.status} ${response.statusText}`,
    );
  }

  const json: unknown = await response.json();
  return spotMetaResponseSchema.parse(json);
}

export interface PositionLeverageAndMargin {
  leverageType: "cross" | "isolated";
  leverageValue: number;
  marginUsedUsd: string;
}

/**
 * Looks up the open position for `coin` in a clearinghouseState snapshot — returns
 * undefined if the position no longer exists (e.g. it was just fully closed).
 *
 * `coin` is matched verbatim, including the "{dex}:{coin}" prefix HIP-3 builder-deployed
 * perps use elsewhere in the API (funding history, activeAssetData) — hyperliquid-docs MCP
 * had no direct example of a dex-scoped clearinghouseState response to confirm whether
 * `position.coin` keeps that prefix or returns the bare coin name; verify against a live
 * testnet HIP-3 dex before relying on this for such assets.
 */
export function findPositionLeverageAndMargin(
  state: ClearinghouseState,
  coin: string,
): PositionLeverageAndMargin | undefined {
  const entry = state.assetPositions.find((ap) => ap.position.coin === coin);
  if (!entry) return undefined;
  return {
    leverageType: entry.position.leverage.type,
    leverageValue: entry.position.leverage.value,
    marginUsedUsd: entry.position.marginUsed,
  };
}

// source: hyperliquid-docs MCP (for-developers/api/info-endpoint page's l2Book example,
// and for-developers/api/websocket/post-requests page's l2Book post-request example),
// verified: 2026-09-22. levels is a fixed 2-tuple: [bids, asks] — the doc's own BTC example
// has levels[0]'s prices below levels[1]'s (113377/113376 vs 113397), i.e. bids first
// (highest-to-lowest), asks second (lowest-to-highest), matching every order book
// convention elsewhere in this codebase.
const l2BookLevelSchema = z.object({
  px: z.string(),
  sz: z.string(),
  n: z.number(),
});
const l2BookResponseSchema = z.object({
  coin: z.string(),
  time: z.number(),
  levels: z.tuple([z.array(l2BookLevelSchema), z.array(l2BookLevelSchema)]),
});
export type L2BookResponse = z.infer<typeof l2BookResponseSchema>;
export type L2BookLevel = z.infer<typeof l2BookLevelSchema>;

/**
 * POST {baseUrl}/info { "type": "l2Book", "coin", nSigFigs?, mantissa? } — up to 20 price
 * levels per side (Hyperliquid's own cap, not configurable here). Used on-demand at TWAP
 * trigger time by packages/trading-core's estimatePriceImpact (apps/worker/src/auto-trader),
 * not polled continuously.
 *
 * Info request weight 2 (source: hyperliquid-docs MCP, rate-limits-and-user-limits page,
 * verified: 2026-09-20).
 */
export async function getL2Book(
  baseUrl: string,
  coin: string,
  options?: { nSigFigs?: 2 | 3 | 4 | 5; mantissa?: 1 | 2 | 5 },
): Promise<L2BookResponse> {
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "l2Book", coin, ...options }),
    // apps/worker's trigger-pipeline.ts calls this synchronously mid-trigger-evaluation, past
    // every cheaper gate — an unbounded hang here means that signal's trigger_evaluations row
    // (documented as "exactly one row per signal") never gets written at all (code-review,
    // 2026-09-23). No documented Hyperliquid SLA for /info latency; 5s is a generous bound for
    // an interactive, already-past-the-cheap-gates call, not a tuned value.
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid l2Book request failed: ${response.status} ${response.statusText}`);
  }

  const json: unknown = await response.json();
  return l2BookResponseSchema.parse(json);
}

// source: hyperliquid-docs MCP (for-developers/api/info-endpoint/perpetuals page, "Retrieve
// concise perp annotations", type: "metaAndAssetCtxs"), verified: 2026-09-22. Response is a
// 2-tuple [meta, assetCtxs] — assetCtxs[i] corresponds to meta.universe[i] by index (both
// docs' own example and the WS SharedAssetCtx/PerpsAssetCtx shapes agree on the field set;
// this REST response has them as decimal STRINGS, unlike the WS variant's `number`s).
const perpAssetCtxSchema = z.object({
  dayNtlVlm: z.string(),
  funding: z.string(),
  // .nullable() is required, not just .optional() — hyperliquid-api-reviewer caught this
  // against the docs' own HIP-3 dex metaAndAssetCtxs example (info-endpoint/perpetuals
  // page), which shows literal `"impactPxs":null` for thin-liquidity assets, verified
  // 2026-09-22. Without it, getMetaAndAssetCtxs() threw a ZodError for any such coin.
  impactPxs: z.tuple([z.string(), z.string()]).nullable().optional(),
  markPx: z.string(),
  midPx: z.string().nullable().optional(),
  openInterest: z.string(),
  oraclePx: z.string(),
  premium: z.string().nullable().optional(),
  prevDayPx: z.string(),
});
const metaAndAssetCtxsResponseSchema = z.tuple([metaResponseSchema, z.array(perpAssetCtxSchema)]);
export type PerpAssetCtx = z.infer<typeof perpAssetCtxSchema>;
export type MetaAndAssetCtxsResponse = z.infer<typeof metaAndAssetCtxsResponseSchema>;

/**
 * POST {baseUrl}/info { "type": "metaAndAssetCtxs" } — every perp's static meta paired with
 * its live market context (dayNtlVlm, markPx, openInterest, ...). Used by
 * packages/trading-core's tier-thresholds.ts (via the caller, apps/worker/src/auto-trader)
 * to normalize a tier's base USD threshold by each coin's 24h notional volume — refresh on
 * a multi-minute interval, never per-signal (info request weight 20, source:
 * hyperliquid-docs MCP rate-limits-and-user-limits page, verified 2026-09-20).
 */
export async function getMetaAndAssetCtxs(baseUrl: string): Promise<MetaAndAssetCtxsResponse> {
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });

  if (!response.ok) {
    throw new Error(
      `Hyperliquid metaAndAssetCtxs request failed: ${response.status} ${response.statusText}`,
    );
  }

  const json: unknown = await response.json();
  return metaAndAssetCtxsResponseSchema.parse(json);
}

/**
 * Looks up a single coin's 24h notional volume out of a getMetaAndAssetCtxs() response, as
 * the decimal string the response already carries it as — never cast to Number (CLAUDE.md:
 * money is decimal-string/fixed-point only, never number/float; code-review 2026-09-23 found
 * this was the one place in the money pipeline that still introduced a float this early).
 */
export function findDayNtlVlm(
  response: MetaAndAssetCtxsResponse,
  coin: string,
): string | undefined {
  const [meta, assetCtxs] = response;
  const index = meta.universe.findIndex((entry) => entry.name === coin);
  if (index === -1) return undefined;
  const ctx = assetCtxs[index];
  return ctx?.dayNtlVlm;
}

// source: hyperliquid-docs MCP (for-developers/api/exchange-endpoint page — every signed
// action shares this request/response envelope; the "Claim rewards" and TWAP examples both
// show the same {"status":"ok","response":{"type":...}} / {"status":"err",...} shape),
// verified: 2026-09-22.
const exchangeSuccessResponseSchema = z.object({
  status: z.literal("ok"),
  response: z.object({ type: z.string() }).passthrough(),
});
const exchangeErrorResponseSchema = z.object({
  status: z.literal("err"),
  response: z.string(),
});
const exchangeResponseSchema = z.union([
  exchangeSuccessResponseSchema,
  exchangeErrorResponseSchema,
]);

export class HyperliquidExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HyperliquidExchangeError";
  }
}

/**
 * POST {baseUrl}/exchange { action, nonce, signature } — submits an ALREADY-SIGNED action.
 * This function never signs anything itself; see signing.ts for why (the user's own wallet
 * produces user-signed-action signatures client-side in apps/web, and Phase B's agent-signed
 * order actions are not implemented yet — CLAUDE.md, 2026-09-22).
 *
 * Throws HyperliquidExchangeError on a top-level `{"status":"err",...}` response. For
 * approveAgent (this function's only caller today) a top-level "ok" IS full confirmation —
 * the exchange endpoint docs' "Approve an API Wallet" section documents only the flat
 * `{'status':'ok','response':{'type':'default'}}` shape, with no nested error case
 * (confirmed by hyperliquid-api-reviewer against the live docs, 2026-09-22).
 *
 * DO NOT reuse this function unmodified for order/cancel/twapCancel actions in Phase B —
 * hyperliquid-api-reviewer flagged (2026-09-22) that those actions can return a per-item
 * error NESTED INSIDE a top-level "ok" envelope, e.g.
 * `{"status":"ok","response":{"type":"twapCancel","data":{"status":{"error":"..."}}}}` (see
 * exchange-endpoint page's order/cancel "Error Response" tab and twapCancel example) — this
 * function's current "ok" == success logic would silently swallow that. A Phase B caller
 * must inspect `response.data` itself for that per-action-type error shape.
 */
export async function submitSignedAction(
  baseUrl: string,
  action: Record<string, unknown>,
  nonce: number,
  signature: Eip712Signature,
): Promise<unknown> {
  const response = await fetch(`${baseUrl}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, nonce, signature }),
  });

  // A transport-level failure (429 rate limit, 5xx, malformed request) also throws
  // HyperliquidExchangeError now, not a plain Error — code-review (2026-09-23) caught that
  // apps/api's /trading/link/confirm only special-cases HyperliquidExchangeError for
  // friendly 502 handling; a plain Error here fell through to an unhandled 500 while the
  // account was left in an ambiguous "may or may not have actually reached Hyperliquid"
  // pending state.
  if (!response.ok) {
    throw new HyperliquidExchangeError(
      `Hyperliquid exchange request failed: ${response.status} ${response.statusText}`,
    );
  }

  const json: unknown = await response.json();
  const parsed = exchangeResponseSchema.parse(json);
  if (parsed.status === "err") {
    throw new HyperliquidExchangeError(parsed.response);
  }
  return parsed.response;
}
