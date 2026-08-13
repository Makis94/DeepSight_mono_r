import { numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// Common-tracker-only bookkeeping: the public per-coin `trades` feed (used for
// tracking_mode="common" wallets) has no equivalent of WsFill.dir/startPosition, so
// common-wallet-tracker derives open/close/increase/decrease itself by diffing the
// running signed size here against each new trade for the same (address, coin). Not used
// for tracking_mode="precise" wallets — those classify directly from WsFill.dir
// (apps/worker/src/wallet-watcher/classify.ts).
export const walletPositionState = pgTable(
  "wallet_position_state",
  {
    // Lowercased, same convention as watched_wallets.address.
    address: text("address").notNull(),
    coin: text("coin").notNull(),
    // Signed size in units of coin: positive = long, negative = short. Decimal string, never
    // float — this is a position size derived from monetary/quantity data.
    signedSize: numeric("signed_size").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.address, table.coin] }),
  }),
);

export type WalletPositionState = typeof walletPositionState.$inferSelect;
export type NewWalletPositionState = typeof walletPositionState.$inferInsert;
