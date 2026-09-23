export const EVENT_TYPES = [
  "wallet_open_long",
  "wallet_open_short",
  "wallet_close_position",
  "wallet_twap",
  "wallet_twap_slice_fill",
  "wallet_large_position_change",
  "wallet_deposit",
  "wallet_withdrawal",
  "wallet_funding",
  "market_trade",
  "market_twap",
  "global_deposit",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const NOTIFICATION_CHANNEL = "hypertracker_events";

export const SUBSCRIPTION_STATUSES = ["trial", "active", "expired", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// source: NowPayments HelpCenter "Payment statuses" article, verified 2026-08-12. Only
// "finished" means funds have actually arrived — "confirmed"/"sending" are still in-flight,
// and "partially_paid" means the customer sent less than the settled price, so none of those
// three should ever trigger a subscription period extension.
export const PAYMENT_STATUSES = [
  "waiting",
  "confirming",
  "confirmed",
  "sending",
  "partially_paid",
  "finished",
  "failed",
  "refunded",
  "expired",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TRIAL_DURATION_DAYS = 3;

// Single tier for now — no premium/plan-tier concept exists elsewhere in the project either.
export const SUBSCRIPTION_PERIOD_DAYS = 30;
// PLACEHOLDER — no price was specified by the business; change before going live.
export const SUBSCRIPTION_PRICE_USD = "100.00";

// --- TWAP auto-trading (CLAUDE.md "Post-MVP: TWAP auto-trading", spec received 2026-09-20) ---
// Single source of truth for every enum shared between packages/db's pgEnum columns,
// packages/trading-core's pure logic, and later apps/api/apps/web's Zod schemas — same
// rationale as SUBSCRIPTION_STATUSES/PAYMENT_STATUSES above.

// Two tiers by asset capitalization/liquidity (spec §2): "A" = large (ZEC, HYPE, ...),
// "B" = less liquid (ARB, UNI, ...).
export const TWAP_TIERS = ["A", "B"] as const;
export type TwapTier = (typeof TWAP_TIERS)[number];

// A linked exchange trading account (packages/db trading-accounts). "pending" = agent
// keypair generated, waiting on the user's own approveAgent signature. "revoked" = the user
// (or an expired 180-day agent) ended the link; never trades again under this row.
export const TRADING_LINK_STATUSES = ["pending", "linked", "revoked"] as const;
export type TradingLinkStatus = (typeof TRADING_LINK_STATUSES)[number];

// Phase A ships "paper" only (see CLAUDE.md decision, 2026-09-22: paper first, live is a
// separate plan+confirmation later). Every trading_accounts row starts here.
export const TRADING_MODES = ["paper", "live"] as const;
export type TradingMode = (typeof TRADING_MODES)[number];

// Spec §3's Trust Score inputs. Reverse-trade cancellation nuance (spec §6) is moot — item 6
// is descoped (CLAUDE.md, 2026-09-22).
export const TRUST_SCORE_EVENT_TYPES = [
  "fully_executed",
  "cancelled_before_execution",
  "cancelled_mid_execution",
] as const;
export type TrustScoreEventType = (typeof TRUST_SCORE_EVENT_TYPES)[number];

export const AUTO_TRADE_STATUSES = [
  "open",
  "closed_tp",
  "closed_sl",
  "closed_manual",
  "error",
] as const;
export type AutoTradeStatus = (typeof AUTO_TRADE_STATUSES)[number];

// What the trigger pipeline did with a threshold-passing signal — "skipped"/"reduced" rows
// are logged deliberately (packages/db trigger-evaluations), not just "opened" ones, since
// every sizing/threshold formula in the spec is an open calibration question that needs the
// full decision history to backtest against, not just the trades that were actually taken.
export const TRIGGER_DECISIONS = ["opened", "skipped", "reduced"] as const;
export type TriggerDecision = (typeof TRIGGER_DECISIONS)[number];
