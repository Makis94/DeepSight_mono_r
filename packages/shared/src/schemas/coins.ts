import { z } from "zod";

export const activeCoinsResponseSchema = z.object({
  coins: z.array(z.string()),
});
export type ActiveCoinsResponse = z.infer<typeof activeCoinsResponseSchema>;

// Header price ticker (a fixed, small coin list — see HEADER_TICKER_COINS) — midPrice stays
// a decimal string end to end (Postgres `numeric` -> here), never a float, per CLAUDE.md's
// monetary-amount rule; only cast to Number at the final render step.
export const coinPriceSchema = z.object({
  symbol: z.string(),
  midPrice: z.string(),
});
export type CoinPrice = z.infer<typeof coinPriceSchema>;

export const coinPricesResponseSchema = z.object({
  prices: z.array(coinPriceSchema),
});
export type CoinPricesResponse = z.infer<typeof coinPricesResponseSchema>;

// The header ticker's fixed coin list — a small curated set, not the full top-250
// coin_registry (that's for the Large Trades coin filter, a different feature/scope). Shared
// between apps/worker (which coins to keep upserted into coin_prices) and apps/api (which
// rows GET /prices returns) so the two can't drift out of sync.
export const HEADER_TICKER_COINS = ["BTC", "ETH", "SOL", "HYPE"] as const;
