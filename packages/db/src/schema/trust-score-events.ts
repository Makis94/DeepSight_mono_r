import { TRUST_SCORE_EVENT_TYPES } from "@hypertracker/shared";
import {
  bigserial,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const trustScoreEventTypeEnum = pgEnum("trust_score_event_type", TRUST_SCORE_EVENT_TYPES);

// Insert-only audit trail of every scoring-relevant TWAP outcome for a wallet — mirrors
// subscriptions.trialClaims' rationale: application code must never UPDATE or DELETE rows
// here. trust_scores.score is a cached projection over this table (packages/trading-core's
// computeTrustScore, recomputed by apps/worker's auto-trader whenever a new row lands here);
// this table is what a future recalibration (a different decay half-life, different deltas —
// every one of them is an open question per CLAUDE.md's spec) replays against, so it must
// stay complete even though the cached score gets recomputed with each new event.
export const trustScoreEvents = pgTable(
  "trust_score_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    exchange: text("exchange").notNull().default("hyperliquid"),
    walletAddress: text("wallet_address").notNull(),
    // The signal source's own TWAP identifier (QuickNode's twap_id today) — lets us trace an
    // event back to the exact TWAP that produced it.
    externalTwapId: text("external_twap_id").notNull(),
    eventType: trustScoreEventTypeEnum("event_type").notNull(),
    coin: text("coin").notNull(),
    notionalUsd: numeric("notional_usd").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    walletIdx: index("trust_score_events_wallet_idx").on(table.exchange, table.walletAddress),
    // One scoring event per (exchange, TWAP, event type) — a status transition that somehow
    // reaches the pipeline twice (reconnect replay, etc.) must not score the same outcome
    // twice.
    twapEventUnique: unique().on(table.exchange, table.externalTwapId, table.eventType),
  }),
);

export type TrustScoreEventRow = typeof trustScoreEvents.$inferSelect;
export type NewTrustScoreEventRow = typeof trustScoreEvents.$inferInsert;
