import { createDb, payments, subscriptions } from "@hypertracker/db";
import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { createSubscriptionWatcherEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { getPaymentStatus } from "./nowpayments-client.js";

const WORKER_ID = "subscription-watcher";

const env = createSubscriptionWatcherEnv(9106);
const log = createLogger(env.NODE_ENV, env.LOG_LEVEL).child({ worker: WORKER_ID });
const db = createDb(env.DATABASE_URL);

const state: HeartbeatState = {
  workerId: WORKER_ID,
  lastEventAt: Date.now(),
  isHealthy: false,
};
// This is a periodic job, not a continuous stream — staleAfterMs must comfortably exceed
// SUBSCRIPTION_POLL_INTERVAL_MS or the heartbeat would flap unhealthy between ticks.
startHeartbeatServer(state, env.HEARTBEAT_PORT, env.SUBSCRIPTION_POLL_INTERVAL_MS * 3);

// Payments this fresh are still likely to update via the real IPN webhook shortly — polling
// them immediately would just be redundant NowPayments API calls. This is a reconciliation
// fallback for callbacks that were missed, not the primary path.
const RECONCILE_AFTER_MS = 10 * 60_000;
const IN_FLIGHT_STATUSES: ("waiting" | "confirming" | "confirmed" | "sending")[] = [
  "waiting",
  "confirming",
  "confirmed",
  "sending",
];

function daysFromNow(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

// Same extension rule as apps/api's POST /webhooks/nowpayments handler — keep the two in
// sync if this logic ever changes. Duplicated rather than factored into a shared package
// because it's the only piece of business logic apps/api and apps/worker would need to
// share, and each already reaches this point from a differently-shaped response (IPN
// payload vs GET /v1/payment/{id} response).
async function creditFinishedPayment(telegramId: number, periodDays: number): Promise<void> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.telegramId, telegramId))
    .limit(1);

  const extendFrom =
    sub?.currentPeriodEnd && sub.currentPeriodEnd.getTime() > Date.now()
      ? sub.currentPeriodEnd
      : new Date();
  const currentPeriodEnd = daysFromNow(periodDays, extendFrom);

  await db
    .insert(subscriptions)
    .values({ telegramId, status: "active", currentPeriodEnd })
    .onConflictDoUpdate({
      target: subscriptions.telegramId,
      set: { status: "active", currentPeriodEnd, updatedAt: new Date() },
    });
}

async function reconcileStuckPayments(): Promise<void> {
  const cutoff = new Date(Date.now() - RECONCILE_AFTER_MS);
  const stuck = await db
    .select()
    .from(payments)
    .where(
      and(
        inArray(payments.status, IN_FLIGHT_STATUSES),
        isNotNull(payments.nowpaymentsPaymentId),
        lt(payments.createdAt, cutoff),
      ),
    );

  for (const payment of stuck) {
    // Guaranteed by the isNotNull filter above — narrows the column's nullable type.
    const paymentId = payment.nowpaymentsPaymentId;
    if (!paymentId) continue;

    try {
      const remote = await getPaymentStatus(
        env.NOWPAYMENTS_BASE_URL,
        env.NOWPAYMENTS_API_KEY,
        paymentId,
      );
      if (remote.payment_status === payment.status) continue;

      const wasAlreadyFinished = payment.status === "finished";
      await db
        .update(payments)
        .set({ status: remote.payment_status, updatedAt: new Date() })
        .where(eq(payments.orderId, payment.orderId));

      if (remote.payment_status === "finished" && !wasAlreadyFinished) {
        await creditFinishedPayment(payment.telegramId, payment.periodDays);
        log.info(
          { orderId: payment.orderId, telegramId: payment.telegramId },
          "reconciled missed payment",
        );
      }
    } catch (err) {
      log.error({ err, orderId: payment.orderId }, "failed to reconcile payment status");
    }
  }
}

async function expireLapsedSubscriptions(): Promise<void> {
  const now = new Date();
  await db
    .update(subscriptions)
    .set({ status: "expired", updatedAt: now })
    .where(
      or(
        and(eq(subscriptions.status, "trial"), lt(subscriptions.trialEndsAt, now)),
        and(eq(subscriptions.status, "active"), lt(subscriptions.currentPeriodEnd, now)),
      ),
    );
}

async function tick(): Promise<void> {
  await reconcileStuckPayments();
  await expireLapsedSubscriptions();
  state.isHealthy = true;
  state.lastEventAt = Date.now();
}

function run(): void {
  log.info({ pollIntervalMs: env.SUBSCRIPTION_POLL_INTERVAL_MS }, "subscription-watcher starting");

  const loop = (): void => {
    void tick().catch((err: unknown) => {
      log.error({ err }, "subscription-watcher tick failed");
    });
  };

  loop();
  setInterval(loop, env.SUBSCRIPTION_POLL_INTERVAL_MS);
}

run();
