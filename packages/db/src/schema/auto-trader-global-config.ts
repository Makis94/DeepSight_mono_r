import { boolean, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

// Single-row table (id is always 1 — enforced by application code never inserting a second
// row, there being nothing else to key a genuinely platform-wide flag on). A platform-wide
// emergency stop, independent of any individual trading_accounts.tradingEnabled (the
// user-facing soft pause). apps/worker's auto-trader checks killSwitchActive here before
// evaluating ANY trigger, for ANY account, paper or live — the fastest lever if a formula
// misbehaves in production. Not exposed to end users; flipped only via admin tooling
// (mirrors the "operator can act faster than a redeploy" rationale behind
// health-watchdog's ADMIN_TELEGRAM_ID alerts elsewhere in this project).
export const autoTraderGlobalConfig = pgTable("auto_trader_global_config", {
  id: integer("id").primaryKey().default(1),
  killSwitchActive: boolean("kill_switch_active").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AutoTraderGlobalConfig = typeof autoTraderGlobalConfig.$inferSelect;
