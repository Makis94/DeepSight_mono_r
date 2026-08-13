import type { EventPayload } from "@hypertracker/shared";
import { EVENT_TYPES } from "@hypertracker/shared";
import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const eventTypeEnum = pgEnum("event_type", EVENT_TYPES);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: eventTypeEnum("type").notNull(),
    walletAddress: text("wallet_address"),
    coin: text("coin"),
    side: text("side"),
    amountUsd: numeric("amount_usd"),
    payload: jsonb("payload").notNull().$type<EventPayload>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Producer-supplied natural key (e.g. "fill:<address>:<tid>", "twap:<address>:<coin>:
    // <timestamp>:<status>") used to make publishing idempotent across process restarts —
    // Hyperliquid resends a snapshot backlog on every (re)subscribe, and an in-memory-only
    // dedup (see apps/worker RecentIdDedup) can't survive that since it resets on restart.
    // Left null for producers that don't need it (nothing enforces uniqueness among nulls).
    externalId: text("external_id"),
  },
  (table) => ({
    walletAddressIdx: index("events_wallet_address_idx").on(table.walletAddress),
    occurredAtIdx: index("events_occurred_at_idx").on(table.occurredAt),
    externalIdUnique: uniqueIndex("events_external_id_unique")
      .on(table.externalId)
      .where(sql`${table.externalId} is not null`),
  }),
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
