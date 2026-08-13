import { z } from "zod";
import { PAYMENT_STATUSES, SUBSCRIPTION_STATUSES } from "../constants.js";

export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);

export const subscriptionResponseSchema = z.object({
  status: subscriptionStatusSchema,
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  // Server-computed (trial_claims lookup) so bot/web never have to re-derive "has this
  // telegram_id already used its trial" themselves.
  trialAvailable: z.boolean(),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

export const createInvoiceResponseSchema = z.object({
  invoiceUrl: z.string(),
  orderId: z.string(),
});
export type CreateInvoiceResponse = z.infer<typeof createInvoiceResponseSchema>;

export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

// Fields we actually read off a NowPayments IPN callback body. Validated at the boundary
// per project TS rules — everything else NowPayments sends is ignored, not typed.
// source: NowPayments HelpCenter "IPN and how to setup" example payload, verified 2026-08-12.
export const nowPaymentsIpnPayloadSchema = z.object({
  payment_id: z.union([z.string(), z.number()]).transform(String),
  payment_status: paymentStatusSchema,
  order_id: z.string(),
  price_amount: z.union([z.string(), z.number()]).transform(String),
  price_currency: z.string(),
  pay_currency: z.string().optional(),
  actually_paid: z.union([z.string(), z.number()]).transform(String).optional(),
});
export type NowPaymentsIpnPayload = z.infer<typeof nowPaymentsIpnPayloadSchema>;
