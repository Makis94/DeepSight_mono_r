import { bigint, boolean, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
  username: text("username"),
  firstName: text("first_name"),
  minDepositAmount: numeric("min_deposit_amount").notNull().default("0"),
  minTradeAmount: numeric("min_trade_amount").notNull().default("0"),
  minTwapAmount: numeric("min_twap_amount").notNull().default("0"),
  notifyDeposits: boolean("notify_deposits").notNull().default(true),
  notifyWithdrawals: boolean("notify_withdrawals").notNull().default(true),
  notifyTrades: boolean("notify_trades").notNull().default(true),
  notifyTwaps: boolean("notify_twaps").notNull().default(true),
  notifyWalletFills: boolean("notify_wallet_fills").notNull().default(true),
  notifyWalletFunding: boolean("notify_wallet_funding").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
