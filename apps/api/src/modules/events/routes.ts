import { events, users, watchedWallets, type Database } from "@hypertracker/db";
import { recentEventsResponseSchema } from "@hypertracker/shared";
import { and, desc, inArray, notInArray, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireActiveSubscription } from "../subscription/guard.js";

// Global (not wallet-scoped) event types, fanned out to every opted-in/thresholded user
// rather than to watchers of a specific address — see RealtimeHub.handleNotify for the
// live-push version of this same split.
const GLOBAL_EVENT_TYPES: ("market_trade" | "market_twap_suspected" | "global_deposit")[] = [
  "market_trade",
  "market_twap_suspected",
  "global_deposit",
];

// Per-query cap on how much history GET /events backfills — this seeds the feed panels on
// page load/reconnect (see apps/web FeedPage), not a full audit log.
const BACKFILL_LIMIT = 100;

export function eventsRoutes(app: FastifyInstance, db: Database): void {
  // Seeds the feed panels with recent matching history — same filters the realtime WS hub
  // applies live (watched wallets, notifyTrades/minTradeAmount, notifyTwaps/minTwapAmount) —
  // so a page load or a WS reconnect doesn't show an empty "Waiting for events…" until the
  // next matching event happens to occur while connected.
  app.get("/events", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const [userRow] = await db
      .select({
        notifyTrades: users.notifyTrades,
        minTradeAmount: users.minTradeAmount,
        notifyTwaps: users.notifyTwaps,
        minTwapAmount: users.minTwapAmount,
        notifyDeposits: users.notifyDeposits,
        minDepositAmount: users.minDepositAmount,
      })
      .from(users)
      .where(eq(users.telegramId, session.telegramId))
      .limit(1);

    const walletRows = await db
      .select({ address: watchedWallets.address })
      .from(watchedWallets)
      .where(eq(watchedWallets.userId, session.telegramId));
    const watchedAddresses = walletRows.map((row) => row.address);

    const queries: Promise<(typeof events.$inferSelect)[]>[] = [];

    if (watchedAddresses.length > 0) {
      queries.push(
        db
          .select()
          .from(events)
          .where(
            and(
              inArray(events.walletAddress, watchedAddresses),
              notInArray(events.type, GLOBAL_EVENT_TYPES),
            ),
          )
          .orderBy(desc(events.occurredAt))
          .limit(BACKFILL_LIMIT),
      );
    }

    if (userRow?.notifyTrades ?? true) {
      const minTradeAmount = userRow?.minTradeAmount ?? "0";
      queries.push(
        db
          .select()
          .from(events)
          .where(
            and(
              eq(events.type, "market_trade"),
              sql`${events.amountUsd}::numeric >= ${minTradeAmount}::numeric`,
            ),
          )
          .orderBy(desc(events.occurredAt))
          .limit(BACKFILL_LIMIT),
      );
    }

    if (userRow?.notifyTwaps ?? true) {
      const minTwapAmount = userRow?.minTwapAmount ?? "0";
      queries.push(
        db
          .select()
          .from(events)
          .where(
            and(
              eq(events.type, "market_twap_suspected"),
              sql`${events.amountUsd}::numeric >= ${minTwapAmount}::numeric`,
            ),
          )
          .orderBy(desc(events.occurredAt))
          .limit(BACKFILL_LIMIT),
      );
    }

    if (userRow?.notifyDeposits ?? true) {
      const minDepositAmount = userRow?.minDepositAmount ?? "0";
      queries.push(
        db
          .select()
          .from(events)
          .where(
            and(
              eq(events.type, "global_deposit"),
              sql`${events.amountUsd}::numeric >= ${minDepositAmount}::numeric`,
            ),
          )
          .orderBy(desc(events.occurredAt))
          .limit(BACKFILL_LIMIT),
      );
    }

    const rows = (await Promise.all(queries)).flat();
    rows.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    return recentEventsResponseSchema.parse({
      events: rows.map((event) => ({
        id: event.id,
        type: event.type,
        coin: event.coin,
        side: event.side,
        amountUsd: event.amountUsd,
        walletAddress: event.walletAddress,
        payload: event.payload,
        occurredAt: event.occurredAt.toISOString(),
      })),
    });
  });
}
