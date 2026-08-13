import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { watchedWallets } from "./watched-wallets.js";

// Fixed pool of 10 rows (slot_id 1..10, seeded by migration 0005) — the literal, physical
// representation of Hyperliquid's 10-unique-user-per-IP cap (packages/hyperliquid-sdk
// HYPERLIQUID_WS_LIMITS.maxUniqueUsersForUserSubscriptions). Claiming a slot is an UPDATE of
// a row where watchedWalletId IS NULL inside a transaction — row-level locking gives mutual
// exclusion for free, no separate advisory lock needed. Do not add/remove rows outside a
// migration; the row count IS the capacity.
export const preciseSlots = pgTable(
  "precise_slots",
  {
    slotId: integer("slot_id").primaryKey(),
    watchedWalletId: bigint("watched_wallet_id", { mode: "number" }).references(
      () => watchedWallets.id,
      { onDelete: "set null" },
    ),
  },
  (table) => ({
    // A wallet can only occupy one slot at a time.
    watchedWalletIdUnique: uniqueIndex("precise_slots_watched_wallet_id_unique")
      .on(table.watchedWalletId)
      .where(sql`${table.watchedWalletId} is not null`),
  }),
);

// Shared FIFO queue across all users for when all 10 precise_slots rows are occupied.
// requestedAt ordering IS the queue position — no separate position column to keep in sync.
export const preciseSlotQueue = pgTable(
  "precise_slot_queue",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    watchedWalletId: bigint("watched_wallet_id", { mode: "number" })
      .notNull()
      .unique()
      .references(() => watchedWallets.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    requestedAtIdx: index("precise_slot_queue_requested_at_idx").on(table.requestedAt),
  }),
);

export type PreciseSlot = typeof preciseSlots.$inferSelect;
export type NewPreciseSlot = typeof preciseSlots.$inferInsert;
export type PreciseSlotQueueEntry = typeof preciseSlotQueue.$inferSelect;
export type NewPreciseSlotQueueEntry = typeof preciseSlotQueue.$inferInsert;
