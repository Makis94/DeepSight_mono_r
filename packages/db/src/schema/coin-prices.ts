import { numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Fed by apps/worker's market-watcher off Hyperliquid's `allMids` WS subscription (one
// shared subscription for every coin, throttled to ~one upsert per coin every few seconds —
// not one write per tick). Only the header ticker's fixed coin list gets rows here, not the
// full top-250 coin_registry — this is a small, low-write-volume table by design.
export const coinPrices = pgTable("coin_prices", {
  symbol: text("symbol").primaryKey(),
  midPrice: numeric("mid_price").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CoinPrice = typeof coinPrices.$inferSelect;
export type NewCoinPrice = typeof coinPrices.$inferInsert;
