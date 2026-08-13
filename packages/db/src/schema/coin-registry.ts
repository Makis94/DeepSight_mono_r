import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const coinRegistry = pgTable("coin_registry", {
  symbol: text("symbol").primaryKey(),
  hyperliquidName: text("hyperliquid_name"),
  cmcRank: integer("cmc_rank"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CoinRegistryEntry = typeof coinRegistry.$inferSelect;
export type NewCoinRegistryEntry = typeof coinRegistry.$inferInsert;
