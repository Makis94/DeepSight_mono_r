import { z } from "zod";
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
