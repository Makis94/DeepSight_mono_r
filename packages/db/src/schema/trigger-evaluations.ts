import { TRIGGER_DECISIONS } from "@hypertracker/shared";
import { bigserial, jsonb, numeric, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const triggerDecisionEnum = pgEnum("trigger_decision", TRIGGER_DECISIONS);

// One row per threshold-passing TWAP signal apps/worker's auto-trader evaluated, regardless
// of what it ultimately did — INCLUDING signals it decided not to act on ("skipped" by
// counter-flow, or "reduced" in size). Every formula in CLAUDE.md's TWAP auto-trading spec
// (threshold normalization, Trust Score scale, TP fraction, counter-flow formula) is an open
// calibration question as of 2026-09-22 — this table is the raw material a future backtest
// replays against. Without the skipped/reduced rows there would be no way to tell whether a
// formula is too aggressive or too conservative, only what it actually did.
export const triggerEvaluations = pgTable("trigger_evaluations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  exchange: text("exchange").notNull().default("hyperliquid"),
  externalTwapId: text("external_twap_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  coin: text("coin").notNull(),
  tier: text("tier").notNull(),
  side: text("side").notNull(),
  triggerNotionalUsd: numeric("trigger_notional_usd").notNull(),
  thresholdUsd: numeric("threshold_usd").notNull(),
  trustScoreAtEval: numeric("trust_score_at_eval").notNull(),
  counterFlowNetUsd: numeric("counter_flow_net_usd").notNull(),
  decision: triggerDecisionEnum("decision").notNull(),
  // Free-form snapshot of every intermediate number the pipeline computed (price-impact
  // estimate, size multipliers, derived SL/TP, which trading_account ids it fanned out to) —
  // deliberately schemaless (jsonb) since the exact shape will keep changing as the formulas
  // above get calibrated, and this table's entire purpose is to survive those changes without
  // a migration each time. Same jsonb-for-evolving-detail pattern as subscriptions.payments'
  // rawPayload column.
  detail: jsonb("detail").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TriggerEvaluation = typeof triggerEvaluations.$inferSelect;
export type NewTriggerEvaluation = typeof triggerEvaluations.$inferInsert;
