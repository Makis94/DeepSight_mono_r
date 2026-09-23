import { TRADING_LINK_STATUSES, TRADING_MODES } from "@hypertracker/shared";
import {
  bigint,
  bigserial,
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const tradingLinkStatusEnum = pgEnum("trading_link_status", TRADING_LINK_STATUSES);
export const tradingModeEnum = pgEnum("trading_mode", TRADING_MODES);

// One linked exchange account per (telegram_id, exchange). Only "hyperliquid" rows exist
// today, but `exchange` is a real column from day one per CLAUDE.md's "Hyperliquid-only for
// v1, multi-exchange-ready architecture" decision (2026-09-22) — adding a second exchange
// later is a new row shape here, not a migration that touches this table's structure.
//
// agentAddress / agentPrivateKeyEncrypted are an API (agent) wallet WE generate server-side —
// never the user's own private key (Hyperliquid nonces-and-api-wallets docs, verified
// 2026-09-20: an agent wallet only signs, it is never itself the funded account). The user
// approves this agent address with their own wallet's signature (approveAgent, off-platform,
// in apps/web) before linkStatus can move to "linked"; we only ever hold the agent's own key.
export const tradingAccounts = pgTable(
  "trading_accounts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" })
      .notNull()
      .references(() => users.telegramId),
    exchange: text("exchange").notNull().default("hyperliquid"),
    walletAddress: text("wallet_address").notNull(),
    agentAddress: text("agent_address").notNull(),
    // Envelope-encrypted at rest; only apps/worker's auto-trader process ever decrypts it
    // (Phase B — live orders), and only at the point of signing. Never sent in an apps/api
    // response or to apps/web.
    agentPrivateKeyEncrypted: text("agent_private_key_encrypted").notNull(),
    linkStatus: tradingLinkStatusEnum("link_status").notNull().default("pending"),
    // Hyperliquid caps agent expiry at 180 days from approval (verified 2026-09-20); null
    // until the user has actually signed approveAgent and linkStatus moves to "linked".
    agentExpiresAt: timestamp("agent_expires_at", { withTimezone: true }),
    // The exact nonce embedded in the approveAgent action apps/api's /trading/link/start
    // built and handed to the frontend for signing — /trading/link/confirm must reconstruct
    // the BYTE-IDENTICAL action (packages/hyperliquid-sdk signing.ts) to submit alongside
    // the user's signature, and the action hash a wallet signed is only valid for the exact
    // nonce it was shown. Added 2026-09-22 alongside apps/api's trading routes (the original
    // 0017 migration shipped without it — another oversight caught while wiring the actual
    // link flow, same as risk_limits.baseSizeUsd in 0018). Cleared back to null once
    // linkStatus moves to "linked" or the pending link is abandoned/replaced.
    pendingNonce: bigint("pending_nonce", { mode: "number" }),
    // Soft pause (CLAUDE.md, 2026-09-22 decision): gates only new entries — any already-open
    // auto_trades row keeps running to its own TP/SL regardless of this flag. Defaults to
    // false: linking a wallet never silently starts trading, the user must explicitly turn
    // this on.
    tradingEnabled: boolean("trading_enabled").notNull().default(false),
    // Phase A ships paper-only; every account starts here. Promotion to "live" (Phase B,
    // separate plan) is a plain UPDATE of this column, not a schema change.
    mode: tradingModeEnum("mode").notNull().default("paper"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    telegramExchangeUnique: unique().on(table.telegramId, table.exchange),
  }),
);

export type TradingAccount = typeof tradingAccounts.$inferSelect;
export type NewTradingAccount = typeof tradingAccounts.$inferInsert;
