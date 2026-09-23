import { bigint, bigserial, numeric, pgTable, timestamp, unique } from "drizzle-orm/pg-core";
import { tradingAccounts } from "./trading-accounts.js";

// One row per trading_accounts row — kept separate from trading_accounts itself (rather than
// extra columns there) since these are user-editable settings apps/api writes directly on the
// user's own request, while trading_accounts' other columns (agent key, link status) are
// written only by the linking flow and by apps/worker's auto-trader.
//
// This is per-account risk control (CLAUDE.md, 2026-09-22 decision: "per-user max
// position/loss limits"). The separate PLATFORM-WIDE emergency stop lives in
// auto-trader-global-config.ts, not here — apps/worker's risk-guard must check both before
// opening any trade, not just this table.
export const riskLimits = pgTable(
  "risk_limits",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tradingAccountId: bigint("trading_account_id", { mode: "number" })
      .notNull()
      .references(() => tradingAccounts.id),
    // Spec §5/§6 "base size" input to packages/trading-core's position-sizing.ts — the
    // notional this account risks on a trigger BEFORE the trust-score/counter-flow
    // multipliers are applied. Added 2026-09-22 alongside apps/worker/src/auto-trader: the
    // original 0017 migration shipped without it (an oversight caught while wiring the
    // trigger pipeline to something an account actually configures) — added here rather
    // than reopening 0017, per the "schema changes are additive migrations, never edit a
    // shipped one" rule.
    baseSizeUsd: numeric("base_size_usd").notNull().default("50"),
    maxPositionUsd: numeric("max_position_usd").notNull(),
    maxDailyLossUsd: numeric("max_daily_loss_usd").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tradingAccountUnique: unique().on(table.tradingAccountId),
  }),
);

export type RiskLimits = typeof riskLimits.$inferSelect;
export type NewRiskLimits = typeof riskLimits.$inferInsert;
