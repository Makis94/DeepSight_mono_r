import { activeSubscriptionCondition, subscriptions, type Database } from "@hypertracker/db";
import type { Session } from "@hypertracker/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireSession } from "../auth/guard.js";

/**
 * Dashboard access guard — session AND an active subscription/trial, in that order. Every
 * data-returning route (coins, prices, events, settings, watched-wallets, realtime) must use
 * this instead of requireSession directly; only auth, subscription management, and the
 * NowPayments webhook stay reachable without an active subscription (a user with none still
 * needs to be able to log in and pay). Sends the 402 itself and returns undefined so callers
 * can `if (!session) return;` and stop, same calling convention as requireSession.
 */
export async function requireActiveSubscription(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
): Promise<Session | undefined> {
  const session = await requireSession(request, reply, db);
  if (!session) return undefined;

  const [sub] = await db
    .select({ telegramId: subscriptions.telegramId })
    .from(subscriptions)
    .where(and(eq(subscriptions.telegramId, session.telegramId), activeSubscriptionCondition()))
    .limit(1);

  if (!sub) {
    await reply.status(402).send({ error: "subscription required" });
    return undefined;
  }

  return session;
}
