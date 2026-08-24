import { payments, subscriptions, trialClaims, type Database } from "@hypertracker/db";
import {
  nowPaymentsIpnPayloadSchema,
  verifyNowPaymentsIpnSignature,
  NowPaymentsIpnVerificationError,
  SUBSCRIPTION_PERIOD_DAYS,
  SUBSCRIPTION_PRICE_USD,
  TRIAL_DURATION_DAYS,
  type SubscriptionResponse,
} from "@hypertracker/shared";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { env } from "../../env.js";
import { requireSession } from "../auth/guard.js";
import { NowPaymentsClient } from "./nowpayments-client.js";

const nowPayments = new NowPaymentsClient({
  baseUrl: env.NOWPAYMENTS_BASE_URL,
  apiKey: env.NOWPAYMENTS_API_KEY,
});

function daysFromNow(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Duplicated in apps/worker/src/subscription-watcher/index.ts (its reconciliation loop
// credits the fallback path, this is the primary webhook path) rather than shared — same
// rationale as the daysFromNow duplication above, and it's a plain unauthenticated fetch to
// Telegram's stable Bot API, not something that benefits from an SDK wrapper here.
async function notifySubscriptionActive(
  telegramId: number,
  currentPeriodEnd: Date,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramId,
        text: `✅ Subscription active until ${formatDate(currentPeriodEnd)}.`,
      }),
    });
    if (!response.ok) {
      log.warn(
        { telegramId, status: response.status },
        "failed to send subscription-active notification",
      );
    }
  } catch (err) {
    log.error({ err, telegramId }, "failed to send subscription-active notification");
  }
}

async function toSubscriptionResponse(
  db: Database,
  telegramId: number,
): Promise<SubscriptionResponse> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.telegramId, telegramId))
    .limit(1);
  const [claim] = await db
    .select({ telegramId: trialClaims.telegramId })
    .from(trialClaims)
    .where(eq(trialClaims.telegramId, telegramId))
    .limit(1);

  return {
    status: sub?.status ?? "expired",
    trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    trialAvailable: !claim,
  };
}

export function subscriptionRoutes(app: FastifyInstance, db: Database): void {
  app.get("/subscription", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    return toSubscriptionResponse(db, session.telegramId);
  });

  app.post("/subscription/trial", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    // Insert-only trial_claims row is the actual guard — onConflictDoNothing means a repeat
    // call (or a race between two concurrent calls) never claims twice. If nothing was
    // inserted, the trial was already used at some point, even if the subscriptions row was
    // since reset.
    const [claimed] = await db
      .insert(trialClaims)
      .values({ telegramId: session.telegramId })
      .onConflictDoNothing({ target: trialClaims.telegramId })
      .returning({ telegramId: trialClaims.telegramId });

    if (!claimed) {
      await reply.status(409).send({ error: "trial already used" });
      return;
    }

    const trialEndsAt = daysFromNow(TRIAL_DURATION_DAYS);
    await db
      .insert(subscriptions)
      .values({ telegramId: session.telegramId, status: "trial", trialEndsAt })
      .onConflictDoUpdate({
        target: subscriptions.telegramId,
        set: { status: "trial", trialEndsAt, updatedAt: new Date() },
      });

    return toSubscriptionResponse(db, session.telegramId);
  });

  app.post("/subscription/invoice", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    const orderId = `sub-${session.telegramId}-${Date.now()}`;

    // Insert the pending payment row before calling out to NowPayments — if the network
    // call fails we're left with an orphaned "waiting" row (harmless, never gets an IPN), but
    // we can never end up with an invoice that has no local record of who it belongs to.
    await db.insert(payments).values({
      orderId,
      telegramId: session.telegramId,
      status: "waiting",
      priceAmount: SUBSCRIPTION_PRICE_USD,
      priceCurrency: "usd",
      periodDays: SUBSCRIPTION_PERIOD_DAYS,
    });

    try {
      const invoice = await nowPayments.createInvoice({
        priceAmountUsd: SUBSCRIPTION_PRICE_USD,
        orderId,
        orderDescription: `HyperTracker subscription (${SUBSCRIPTION_PERIOD_DAYS} days)`,
        ipnCallbackUrl: `${env.PUBLIC_API_URL}/webhooks/nowpayments`,
        successUrl: env.PUBLIC_WEB_URL,
        cancelUrl: env.PUBLIC_WEB_URL,
      });

      await db
        .update(payments)
        .set({ nowpaymentsInvoiceId: invoice.invoiceId, updatedAt: new Date() })
        .where(eq(payments.orderId, orderId));

      return { invoiceUrl: invoice.invoiceUrl, orderId };
    } catch (err) {
      request.log.error({ err, orderId }, "failed to create NowPayments invoice");
      await reply.status(502).send({ error: "failed to create invoice" });
      return;
    }
  });

  // Public endpoint — NowPayments calls this directly, so it's authenticated by HMAC
  // signature (see verifyNowPaymentsIpnSignature), never by session. Must stay outside
  // requireSession.
  app.post("/webhooks/nowpayments", async (request, reply) => {
    try {
      verifyNowPaymentsIpnSignature(
        request.body,
        request.headers["x-nowpayments-sig"] as string | undefined,
        env.NOWPAYMENTS_IPN_SECRET,
      );
    } catch (err) {
      if (err instanceof NowPaymentsIpnVerificationError) {
        request.log.warn({ err: err.message }, "rejected unverified NowPayments IPN callback");
        await reply.status(401).send({ error: "invalid signature" });
        return;
      }
      throw err;
    }

    const parsed = nowPaymentsIpnPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.status(400).send({ error: "malformed IPN payload" });
      return;
    }
    const ipn = parsed.data;

    const [existing] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, ipn.order_id))
      .limit(1);
    if (!existing) {
      // Signature was valid but we have no record of this order — log and 200 anyway so
      // NowPayments doesn't retry forever on something we'll never recognize.
      request.log.error({ orderId: ipn.order_id }, "IPN for unknown order_id");
      return reply.status(200).send({ ok: true });
    }

    // Idempotent: a payment that already reached "finished" never extends the subscription
    // again, no matter how many times NowPayments retries the callback.
    const wasAlreadyFinished = existing.status === "finished";

    await db
      .update(payments)
      .set({
        status: ipn.payment_status,
        nowpaymentsPaymentId: ipn.payment_id,
        ...(ipn.pay_currency !== undefined ? { payCurrency: ipn.pay_currency } : {}),
        rawPayload: request.body,
        updatedAt: new Date(),
      })
      .where(eq(payments.orderId, ipn.order_id));

    if (ipn.payment_status === "finished" && !wasAlreadyFinished) {
      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.telegramId, existing.telegramId))
        .limit(1);

      // Renewing before expiry extends from the current period end; renewing after expiry
      // (or from trial, or with no prior subscription row) starts the new period from now.
      const extendFrom =
        sub?.currentPeriodEnd && sub.currentPeriodEnd.getTime() > Date.now()
          ? sub.currentPeriodEnd
          : new Date();
      const currentPeriodEnd = daysFromNow(existing.periodDays, extendFrom);

      await db
        .insert(subscriptions)
        .values({ telegramId: existing.telegramId, status: "active", currentPeriodEnd })
        .onConflictDoUpdate({
          target: subscriptions.telegramId,
          set: { status: "active", currentPeriodEnd, updatedAt: new Date() },
        });

      await notifySubscriptionActive(existing.telegramId, currentPeriodEnd, request.log);
    }

    return reply.status(200).send({ ok: true });
  });
}
