import { payments, subscriptions, trialClaims, type Database } from "@hypertracker/db";
import {
  SUBSCRIPTION_PERIOD_DAYS,
  SUBSCRIPTION_PRICE_USD,
  TRIAL_DURATION_DAYS,
} from "@hypertracker/shared";
import { eq } from "drizzle-orm";
import type { Bot } from "grammy";
import type { Logger } from "pino";
import { env } from "../../env.js";
import { createInvoice } from "./nowpayments-client.js";

function daysFromNow(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function registerSubscriptionCommands(bot: Bot, db: Database, logger: Logger): void {
  bot.command("trial", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const [claimed] = await db
      .insert(trialClaims)
      .values({ telegramId })
      .onConflictDoNothing({ target: trialClaims.telegramId })
      .returning({ telegramId: trialClaims.telegramId });

    if (!claimed) {
      await ctx.reply(
        "You've already used your free trial — it can only be claimed once per account.",
      );
      return;
    }

    const trialEndsAt = daysFromNow(TRIAL_DURATION_DAYS);
    await db
      .insert(subscriptions)
      .values({ telegramId, status: "trial", trialEndsAt })
      .onConflictDoUpdate({
        target: subscriptions.telegramId,
        set: { status: "trial", trialEndsAt, updatedAt: new Date() },
      });

    await ctx.reply(
      `🎉 Your ${TRIAL_DURATION_DAYS}-day trial has started — active until ${formatDate(trialEndsAt)}.`,
    );
  });

  bot.command("subscribe", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const orderId = `sub-${telegramId}-${Date.now()}`;
    await db.insert(payments).values({
      orderId,
      telegramId,
      status: "waiting",
      priceAmount: SUBSCRIPTION_PRICE_USD,
      priceCurrency: "usd",
      periodDays: SUBSCRIPTION_PERIOD_DAYS,
    });

    try {
      const invoice = await createInvoice({
        baseUrl: env.NOWPAYMENTS_BASE_URL,
        apiKey: env.NOWPAYMENTS_API_KEY,
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

      await ctx.reply(
        `💳 Pay $${SUBSCRIPTION_PRICE_USD} for ${SUBSCRIPTION_PERIOD_DAYS} days:\n${invoice.invoiceUrl}\n\nYour subscription activates automatically once payment is confirmed.`,
      );
    } catch (err) {
      logger.error({ err, orderId, telegramId }, "failed to create NowPayments invoice");
      await ctx.reply(
        "Sorry, couldn't create a payment link right now — please try again shortly.",
      );
    }
  });

  bot.command("plan", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

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

    if (!sub || sub.status === "expired" || sub.status === "canceled") {
      const trialHint = claim ? "" : " Use /trial to start a free trial.";
      await ctx.reply(`No active subscription.${trialHint} Use /subscribe to pay.`);
      return;
    }

    if (sub.status === "trial" && sub.trialEndsAt) {
      await ctx.reply(`🎁 Trial active until ${formatDate(sub.trialEndsAt)}.`);
      return;
    }

    if (sub.status === "active" && sub.currentPeriodEnd) {
      await ctx.reply(`✅ Subscription active until ${formatDate(sub.currentPeriodEnd)}.`);
      return;
    }
  });
}
