import { AUTO_TRADE_STATUSES } from "@hypertracker/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tradingAccounts } from "./trading-accounts.js";

export const autoTradeStatusEnum = pgEnum("auto_trade_status", AUTO_TRADE_STATUSES);

// One row per position the auto-trader pipeline opened (paper or live — see
// trading_accounts.mode) off a triggering TWAP signal, for one linked account. Reverse trades
// (spec §6) are explicitly descoped (CLAUDE.md, 2026-09-22) — every row here is a
// main-direction trade only, same side as the TWAP that triggered it.
export const autoTrades = pgTable(
  "auto_trades",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tradingAccountId: bigint("trading_account_id", { mode: "number" })
      .notNull()
      .references(() => tradingAccounts.id),
    // Nullable: the trigger_evaluations row this trade came from, for traceability back to
    // the exact numbers that produced it. Not a hard FK requirement for the trade to exist —
    // a manually-opened or backfilled row could lack one.
    triggerEvaluationId: bigint("trigger_evaluation_id", { mode: "number" }),
    exchange: text("exchange").notNull().default("hyperliquid"),
    externalTwapId: text("external_twap_id").notNull(),
    triggerWalletAddress: text("trigger_wallet_address").notNull(),
    coin: text("coin").notNull(),
    side: text("side").notNull(),
    sizeUsd: numeric("size_usd").notNull(),
    trustScoreAtEntry: numeric("trust_score_at_entry").notNull(),
    entryPx: numeric("entry_px"),
    stopLossPx: numeric("stop_loss_px").notNull(),
    takeProfitPx: numeric("take_profit_px").notNull(),
    // Adapter-assigned identifiers (packages/trading-core's ExecutionAdapter result) — null
    // for paper trades, since the paper adapter never talks to a real exchange.
    externalOrderId: text("external_order_id"),
    externalStopLossOrderId: text("external_stop_loss_order_id"),
    externalTakeProfitOrderId: text("external_take_profit_order_id"),
    status: autoTradeStatusEnum("status").notNull().default("open"),
    realizedPnlUsd: numeric("realized_pnl_usd"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => ({
    accountIdx: index("auto_trades_account_idx").on(table.tradingAccountId),
    // Hot path: apps/worker's auto-trader polls "every open trade" every cycle to check for
    // TP/SL fills (per-user WS is capped at 10 unique users — see CLAUDE.md — so this is a
    // poll loop, not a push subscription).
    statusIdx: index("auto_trades_status_idx").on(table.status),
    // Enforces PaperExecutionAdapter's documented "at most one open position per (account,
    // coin)" invariant AT THE DATABASE LEVEL — added after code-review (2026-09-23) found a
    // TOCTOU race: trigger-pipeline.ts's hasOpenPosition() check and this table's insert
    // aren't atomic, so two "activated" signals on the same coin processed close together
    // could both pass the check and both insert. A partial unique index makes the second
    // insert fail (trigger-pipeline.ts catches this via onConflictDoNothing) instead of
    // silently doubling real exposure. Partial (WHERE status='open') because a coin can
    // legitimately have many CLOSED rows for the same account over time — only one OPEN one.
    oneOpenPositionPerAccountCoin: uniqueIndex("auto_trades_open_account_coin_unique")
      .on(table.tradingAccountId, table.coin)
      .where(sql`${table.status} = 'open'`),
  }),
);

export type AutoTrade = typeof autoTrades.$inferSelect;
export type NewAutoTrade = typeof autoTrades.$inferInsert;
