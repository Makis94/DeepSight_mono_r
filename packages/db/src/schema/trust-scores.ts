import {
  bigserial,
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Keyed on (exchange, wallet_address) — these are the EXTERNAL wallets whose TWAPs we watch
// and score (CLAUDE.md spec §3), not our own users/trading_accounts rows. A wallet can appear
// here having never linked a trading_accounts row at all; scoring is independent of whether
// that wallet is one of our own customers — that's the whole point of the leaderboard
// (apps/web, planned) showing the most reliable TWAP-initiating wallets on the market.
//
// `score` is a cached, recomputed-on-write projection of packages/trading-core's
// computeTrustScore() over this wallet's trust_score_events rows — that table is the actual
// source of truth (insert-only, same durability rationale as subscriptions.trialClaims); this
// column exists so sizing lookups and the leaderboard don't replay the whole event history on
// every read.
export const trustScores = pgTable(
  "trust_scores",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    exchange: text("exchange").notNull().default("hyperliquid"),
    walletAddress: text("wallet_address").notNull(),
    // Raw computeTrustScore() output — kept for transparency/debugging even though sizing
    // decisions use effectiveScore below, not this.
    score: numeric("score").notNull().default("0"),
    // Manipulation-defense fields (added 2026-09-22, packages/trading-core's
    // evaluateWalletTrust — see that function's doc comment for the full rationale): a
    // same-day burst of fake-looking good behavior no longer buys a boosted `score` alone,
    // because `confidence` (0-1, requires real tenure + event volume) dampens the upside.
    // `effectiveScore` = confidence-adjusted score, `blocked` = effectiveScore crossed the
    // full-block threshold. apps/worker's trigger-pipeline sizes off effectiveScore/blocked,
    // never off the raw `score` column.
    confidence: numeric("confidence").notNull().default("0"),
    effectiveScore: numeric("effective_score").notNull().default("0"),
    blocked: boolean("blocked").notNull().default(false),
    // Denormalized counters for the leaderboard page — avoids a COUNT(*) over
    // trust_score_events per row on every leaderboard load.
    totalSignals: integer("total_signals").notNull().default(0),
    fullyExecutedCount: integer("fully_executed_count").notNull().default(0),
    cancelledCount: integer("cancelled_count").notNull().default(0),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    exchangeWalletUnique: unique().on(table.exchange, table.walletAddress),
  }),
);

export type TrustScoreRow = typeof trustScores.$inferSelect;
export type NewTrustScoreRow = typeof trustScores.$inferInsert;
