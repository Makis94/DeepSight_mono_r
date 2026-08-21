import { z } from "zod";
import { subscriptionStatusSchema } from "./subscription.js";

export const adminLoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type AdminLoginBody = z.infer<typeof adminLoginBodySchema>;

// Admin's own session shape — deliberately separate from `Session` (packages/shared/src/auth/
// session.ts): the admin isn't a telegram_id-identified user of the product, just the single
// operator, so it has no business carrying a telegramId field.
export const adminSessionSchema = z.object({
  role: z.literal("admin"),
  username: z.string(),
});
export type AdminSession = z.infer<typeof adminSessionSchema>;

// One row of the admin users table. subscriptionStatus/trialEndsAt/currentPeriodEnd are the
// same fields subscriptionResponseSchema exposes to the user themselves — a user with no
// subscriptions row yet (never started a trial) reports as "expired", not null, mirroring
// apps/api's toSubscriptionResponse.
export const adminUserRowSchema = z.object({
  telegramId: z.number().int().positive(),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  createdAt: z.string(),
  subscriptionStatus: subscriptionStatusSchema,
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
});
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserRowSchema),
});
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

// Manual grant has no request body: the standard subscription is a single fixed-length
// plan (SUBSCRIPTION_PERIOD_DAYS) — there's nothing for the admin to choose. Returns the
// updated row so the caller can refresh its table entry without a second round trip.
export const adminGrantSubscriptionResponseSchema = z.object({
  user: adminUserRowSchema,
});
export type AdminGrantSubscriptionResponse = z.infer<typeof adminGrantSubscriptionResponseSchema>;
