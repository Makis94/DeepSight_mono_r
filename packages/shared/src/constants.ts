export const EVENT_TYPES = [
  "wallet_open_long",
  "wallet_open_short",
  "wallet_close_position",
  "wallet_twap",
  "wallet_large_position_change",
  "wallet_deposit",
  "wallet_withdrawal",
  "wallet_funding",
  "market_trade",
  "market_twap_suspected",
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
// TEMP: dropped from "9.99" for a live NowPayments test — revert once the test payment is confirmed.
export const SUBSCRIPTION_PRICE_USD = "3.00";
