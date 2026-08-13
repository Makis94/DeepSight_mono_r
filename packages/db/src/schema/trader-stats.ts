import { integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const traderStats = pgTable("trader_stats", {
  walletAddress: text("wallet_address").primaryKey(),
  totalPnl: numeric("total_pnl").notNull().default("0"),
  winRate: numeric("win_rate").notNull().default("0"),
  volume: numeric("volume").notNull().default("0"),
  fillsCount: integer("fills_count").notNull().default(0),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TraderStats = typeof traderStats.$inferSelect;
export type NewTraderStats = typeof traderStats.$inferInsert;
