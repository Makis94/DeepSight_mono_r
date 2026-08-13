import { bigint, boolean, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
  username: text("username"),
  firstName: text("first_name"),
  // Default to each threshold's own highest preset (see DEPOSIT_THRESHOLD_PRESETS/
  // TRADE_THRESHOLD_PRESETS/TWAP_THRESHOLD_PRESETS in packages/shared/src/schemas/
  // settings.ts) rather than "0" — a brand-new user's tables/notifications start scoped to
  // only the biggest moves instead of every trade on every coin. Keep these literals in sync
  // with the last entry of each preset array if it ever changes.
  minDepositAmount: numeric("min_deposit_amount").notNull().default("2000000"),
  minTradeAmount: numeric("min_trade_amount").notNull().default("1000000"),
  minTwapAmount: numeric("min_twap_amount").notNull().default("1000000"),
  notifyDeposits: boolean("notify_deposits").notNull().default(true),
  notifyWithdrawals: boolean("notify_withdrawals").notNull().default(true),
  notifyTrades: boolean("notify_trades").notNull().default(true),
  notifyTwaps: boolean("notify_twaps").notNull().default(true),
  notifyWalletFills: boolean("notify_wallet_fills").notNull().default(true),
  notifyWalletFunding: boolean("notify_wallet_funding").notNull().default(false),
  // Applies only to the global market-wide modules (large trades / likely-TWAPs) — BTC and
  // ETH dominate those feeds' volume, so users focused on other coins can opt out of them
  // specifically. Does not affect watched-wallet activity (an explicitly-tracked address'
  // own BTC/ETH fills still show, since the user asked for that address by name).
  excludeBtc: boolean("exclude_btc").notNull().default(false),
  excludeEth: boolean("exclude_eth").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
