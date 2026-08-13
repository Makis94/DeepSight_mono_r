import { z } from "zod";

const CMC_LISTINGS_URL = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest";

const cmcListingSchema = z.object({
  symbol: z.string(),
  cmc_rank: z.number(),
});

const cmcListingsResponseSchema = z.object({
  status: z.object({
    error_code: z.number(),
    error_message: z.string().nullable(),
  }),
  data: z.array(cmcListingSchema),
});

/**
 * Discriminates whether coin-registry-sync should hit the real CoinMarketCap API or fall
 * back to the static placeholder list — see `USE_REAL_CMC` in shared/env.ts. Modeled as a
 * union rather than an optional `apiKey` so a `useReal: true` value can never carry a
 * missing key.
 */
export type CmcSource = { useReal: false } | { useReal: true; apiKey: string };

/**
 * Turns the raw env fields into a `CmcSource`, throwing at startup (not mid-sync) if
 * `USE_REAL_CMC=true` was set without a key.
 */
export function resolveCmcSource(env: {
  USE_REAL_CMC: boolean;
  CMC_API_KEY?: string | undefined;
}): CmcSource {
  if (!env.USE_REAL_CMC) return { useReal: false };
  if (!env.CMC_API_KEY) {
    throw new Error("CMC_API_KEY is required when USE_REAL_CMC=true");
  }
  return { useReal: true, apiKey: env.CMC_API_KEY };
}

/**
 * GET /v1/cryptocurrency/listings/latest, ranked by market cap, capped at `limit`. This is
 * CoinMarketCap's API (not Hyperliquid's) — not subject to the hyperliquid-docs MCP
 * verification rule, which only covers Hyperliquid endpoints.
 */
export async function fetchCmcTopSymbols(apiKey: string, limit = 250): Promise<string[]> {
  const url = new URL(CMC_LISTINGS_URL);
  url.searchParams.set("start", "1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "market_cap");
  url.searchParams.set("convert", "USD");

  const response = await fetch(url, {
    headers: { "X-CMC_PRO_API_KEY": apiKey, Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `CMC listings/latest request failed: ${response.status} ${response.statusText}`,
    );
  }

  const json: unknown = await response.json();
  const parsed = cmcListingsResponseSchema.parse(json);

  if (parsed.status.error_code !== 0) {
    throw new Error(`CMC listings/latest error: ${parsed.status.error_message ?? "unknown"}`);
  }

  return parsed.data.map((entry) => entry.symbol);
}
