import { coinPrices, coinRegistry, type Database } from "@hypertracker/db";
import { HEADER_TICKER_COINS } from "@hypertracker/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireActiveSubscription } from "../subscription/guard.js";

export function coinsRoutes(app: FastifyInstance, db: Database): void {
  // The top-250-CMC ∩ Hyperliquid-listed intersection (see coin-registry-sync worker) —
  // this is exactly the coin list the "Large trades" feed can produce, so it's also the
  // right set to offer in the coin filter dropdown.
  app.get("/coins", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const rows = await db
      .select({ symbol: coinRegistry.symbol })
      .from(coinRegistry)
      .where(eq(coinRegistry.isActive, true))
      .orderBy(asc(coinRegistry.symbol));

    return { coins: rows.map((row) => row.symbol) };
  });

  // Header price ticker — the fixed HEADER_TICKER_COINS list (not the full coin_registry),
  // fed by apps/worker's market-watcher off Hyperliquid's allMids subscription. A coin
  // missing from the response just means the worker hasn't upserted its first tick yet
  // (e.g. right after a fresh deploy) — the client treats that row as absent, not an error.
  app.get("/prices", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const rows = await db
      .select({ symbol: coinPrices.symbol, midPrice: coinPrices.midPrice })
      .from(coinPrices)
      .where(inArray(coinPrices.symbol, [...HEADER_TICKER_COINS]));

    const bySymbol = new Map(rows.map((row) => [row.symbol, row.midPrice]));
    const prices = HEADER_TICKER_COINS.flatMap((symbol) => {
      const midPrice = bySymbol.get(symbol);
      return midPrice === undefined ? [] : [{ symbol, midPrice }];
    });

    return { prices };
  });
}
