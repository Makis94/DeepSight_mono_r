import {
  bigint,
  bigserial,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// "precise" = per-wallet Hyperliquid user-specific WS subscriptions (userFills, userEvents,
// userTwapHistory, userNonFundingLedgerUpdates — full fidelity, incl. dir classification and
// TWAP), capped at 10 concurrently across the whole platform per precise_slots. "common" =
// the address is matched against the public per-coin `trades` feed instead (unlimited
// wallets, but direction/open-close is derived from wallet_position_state diffing rather than
// Hyperliquid's own dir field, and TWAP isn't detected). See precise-tracking.ts.
export const trackingModeEnum = pgEnum("tracking_mode", ["common", "precise"]);

export const watchedWallets = pgTable(
  "watched_wallets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.telegramId, { onDelete: "cascade" }),
    // Always stored lowercased — wallet-watcher, events.walletAddress and every downstream
    // reverse-lookup compare addresses case-insensitively by relying on this convention
    // rather than doing a case-insensitive query at every call site. Any code inserting
    // into this table (bot's "add wallet" flow, admin tooling, ...) must lowercase first.
    address: text("address").notNull(),
    label: text("label"),
    trackingMode: trackingModeEnum("tracking_mode").notNull().default("common"),
    // Hyperliquid caps user-specific WS subscriptions at 10 unique addresses per IP
    // (source: hyperliquid-docs MCP, verified: 2026-07-27). shardId groups precise-mode
    // wallets onto the wallet-watcher instance/egress IP that holds their subscription; null
    // until multi-IP sharding is implemented (today: 1 shard = the 10 rows in precise_slots).
    shardId: integer("shard_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Up to MAX_WATCHED_WALLETS (packages/shared) per user, enforced by application-level
    // count checks in apps/api — this constraint only stops the same address being tracked
    // twice by the same user (double-submit), not the count itself. Not just checked in the
    // API layer, so a duplicate insert can't be bypassed by a second write path (bot, admin
    // tooling) forgetting the rule.
    userAddressUnique: unique().on(table.userId, table.address),
    // reverse lookup: "which users watch this address" — the hot path for wallet-watcher
    // fan-out and for the bot/realtime gateway matching incoming events to subscribers.
    addressIdx: index("watched_wallets_address_idx").on(table.address),
  }),
);

export type WatchedWallet = typeof watchedWallets.$inferSelect;
export type NewWatchedWallet = typeof watchedWallets.$inferInsert;
