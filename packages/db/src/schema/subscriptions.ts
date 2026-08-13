import { PAYMENT_STATUSES, SUBSCRIPTION_STATUSES } from "@hypertracker/shared";
import { and, eq, gt, or, type SQL } from "drizzle-orm";
import {
  bigint,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const subscriptionStatusEnum = pgEnum("subscription_status", SUBSCRIPTION_STATUSES);

export const subscriptions = pgTable("subscriptions", {
  telegramId: bigint("telegram_id", { mode: "number" })
    .primaryKey()
    .references(() => users.telegramId),
  status: subscriptionStatusEnum("status").notNull().default("expired"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

// Single source of truth for "is this row's subscription usable right now" — combine with
// eq(subscriptions.telegramId, ...) in a WHERE clause. Deliberately re-checks the actual
// date, not just the cached `status` column: subscription-watcher only sweeps expired rows
// on a poll interval (see apps/worker), so `status` can lag reality by up to that interval.
// Both apps/api's dashboard guard and apps/bot's notifiers must use this exact function —
// reimplementing the date comparison in two places is how the two would eventually drift
// and open a bypass.
export function activeSubscriptionCondition(now: Date = new Date()): SQL {
  const condition = or(
    and(eq(subscriptions.status, "trial"), gt(subscriptions.trialEndsAt, now)),
    and(eq(subscriptions.status, "active"), gt(subscriptions.currentPeriodEnd, now)),
  );
  if (!condition) {
    throw new Error("unreachable: activeSubscriptionCondition built from two fixed clauses");
  }
  return condition;
}

// Insert-only, immutable proof that a telegram_id has ever claimed a trial. Application code
// must never update or delete rows here — that's what makes it durable against "reset my
// subscription row and re-claim the trial" abuse for a single Telegram account. See
// deposit-monitoring-architecture-style rationale in CLAUDE.md's unified Telegram identity
// section: telegram_id is the one identity we can actually key abuse prevention off of.
export const trialClaims = pgTable("trial_claims", {
  telegramId: bigint("telegram_id", { mode: "number" })
    .primaryKey()
    .references(() => users.telegramId),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TrialClaim = typeof trialClaims.$inferSelect;
export type NewTrialClaim = typeof trialClaims.$inferInsert;

export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUSES);

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  // Our own id, generated at invoice-creation time and passed as NowPayments' `order_id` —
  // this is what correlates an incoming IPN callback back to this row, since the underlying
  // `nowpaymentsPaymentId` doesn't exist yet until the customer picks a currency on the
  // hosted invoice page and a payment is actually created on NowPayments' side.
  orderId: text("order_id").notNull().unique(),
  nowpaymentsInvoiceId: text("nowpayments_invoice_id"),
  nowpaymentsPaymentId: text("nowpayments_payment_id").unique(),
  telegramId: bigint("telegram_id", { mode: "number" })
    .notNull()
    .references(() => users.telegramId),
  status: paymentStatusEnum("status").notNull().default("waiting"),
  priceAmount: numeric("price_amount").notNull(),
  priceCurrency: text("price_currency").notNull(),
  payCurrency: text("pay_currency"),
  periodDays: integer("period_days").notNull(),
  // Last IPN body received for this payment, kept verbatim for audit/dispute resolution.
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
