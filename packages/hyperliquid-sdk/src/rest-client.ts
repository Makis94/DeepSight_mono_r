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
 * be called on demand for a specific candidate address, not polled per-address on an
 * interval; market-watcher's twap-confirm.ts only calls this after its own heuristic has
 * already flagged a candidate, keeping call volume low.
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
