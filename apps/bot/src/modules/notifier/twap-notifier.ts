import {
  activeSubscriptionCondition,
  events,
  eventCursors,
  subscriptions,
  users,
  type Database,
  type ListenClient,
} from "@hypertracker/db";
import { NOTIFICATION_CHANNEL, type MarketTwapPayload } from "@hypertracker/shared";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Bot } from "grammy";
import type { Logger } from "pino";

// Own row in event_cursors, same reasoning as trade-notifier.ts's CONSUMER.
const CONSUMER = "bot-notifier-twaps";

type EventRow = typeof events.$inferSelect;

// null means this consumer has never run before — see trade-notifier.ts's getCursor doc
// comment for why a brand-new consumer must not replay the entire pre-existing market_twap
// history by defaulting to 0.
async function getCursor(db: Database): Promise<number | null> {
  const [row] = await db
    .select({ lastEventId: eventCursors.lastEventId })
    .from(eventCursors)
    .where(eq(eventCursors.consumer, CONSUMER))
    .limit(1);
  return row?.lastEventId ?? null;
}

async function setCursor(db: Database, lastEventId: number): Promise<void> {
  await db
    .insert(eventCursors)
    .values({ consumer: CONSUMER, lastEventId })
    .onConflictDoUpdate({
      target: eventCursors.consumer,
      set: { lastEventId, updatedAt: new Date() },
    });
}

// Resolves the starting cursor, seeding a brand-new consumer to the current head instead of
// leaving `cursor` typed number | null through the rest of startTwapNotifier.
async function resolveInitialCursor(db: Database): Promise<number> {
  const existing = await getCursor(db);
  if (existing !== null) return existing;

  const [head] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.type, "market_twap"))
    .orderBy(desc(events.id))
    .limit(1);
  const cursor = head?.id ?? 0;
  await setCursor(db, cursor);
  return cursor;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Every event of this type is sourced directly from QuickNode's HyperCore TWAP dataset (see
// marketTwapPayloadSchema) — real order-level data, not a heuristic guess. "activated" is the
// moment the TWAP opens (what the user primarily asked to be notified about); "finished"/
// "terminated" report the order's real accumulated total once it's done.
function formatTwapMessage(payload: MarketTwapPayload, amountUsd: string): string {
  const amount = Math.round(Number(amountUsd)).toLocaleString("en-US");
  const sideLabel = payload.side === "buy" ? "🟢 Buy" : "🔴 Sell";
  // `market`/`displayCoin` are optional on rows written before spot TWAPs were included —
  // fall back to "perp" and the raw coin id.
  const marketLabel = payload.market === "spot" ? "Spot" : "Perp";
  const coin = `${marketLabel} ${payload.displayCoin ?? payload.coin}`;

  if (payload.status === "activated") {
    return [
      `🆕 TWAP opened`,
      `${sideLabel} $${amount} (est.) ${coin}, target size ${payload.size}, over ${payload.minutes}min`,
      `Address: \`${shortAddress(payload.address)}\``,
    ].join("\n");
  }

  const verb = payload.status === "finished" ? "finished" : "terminated early";
  return [
    `✅ TWAP ${verb}`,
    `${sideLabel} $${amount} executed of ${coin}, ${payload.executedSize}/${payload.size}`,
    `Address: \`${shortAddress(payload.address)}\``,
  ].join("\n");
}

async function notifyTwap(bot: Bot, db: Database, logger: Logger, event: EventRow): Promise<void> {
  const amountUsd = event.amountUsd ?? "0";
  // Guaranteed by the producer (twap-watcher publishEvent, type "market_twap") — the caller
  // (processIfNew below) already filtered on event.type before reaching here.
  const payload = event.payload as MarketTwapPayload;

  // Only users with a currently-active subscription/trial ever get notified — see
  // activeSubscriptionCondition's doc comment (packages/db) for why this re-checks the date
  // rather than trusting the cached subscriptions.status column.
  const conditions = [
    eq(users.notifyTwaps, true),
    sql`${users.minTwapAmount}::numeric <= ${amountUsd}::numeric`,
    activeSubscriptionCondition(),
  ];
  // See users.excludeBtc/excludeEth doc comment (packages/db) — skips users who opted out of
  // this specific coin, so the push never goes out at all rather than being sent and ignored.
  if (payload.coin === "BTC") conditions.push(eq(users.excludeBtc, false));
  if (payload.coin === "ETH") conditions.push(eq(users.excludeEth, false));

  const recipients = await db
    .select({ telegramId: users.telegramId })
    .from(users)
    .innerJoin(subscriptions, eq(subscriptions.telegramId, users.telegramId))
    .where(and(...conditions));

  const text = formatTwapMessage(payload, amountUsd);
  for (const recipient of recipients) {
    try {
      await bot.api.sendMessage(recipient.telegramId, text, { parse_mode: "Markdown" });
    } catch (err) {
      logger.error(
        { err, telegramId: recipient.telegramId, eventId: event.id },
        "failed to send twap notification",
      );
    }
  }
}

// Hard safety cap — see trade-notifier.ts's identical constant doc comment for why this
// exists (a real incident during development, not a hypothetical).
const MAX_BACKLOG_REPLAY = 500;

/**
 * Starts the market-wide TWAP notifier: replays anything published while the bot was offline
 * (via the durable cursor), then listens live on the same Postgres NOTIFY channel the
 * realtime WS hub uses (apps/api RealtimeHub) — a second, independent consumer of the same
 * event bus, not a replacement for it. Returns a stop function.
 */
export async function startTwapNotifier(
  bot: Bot,
  db: Database,
  listenClient: ListenClient,
  logger: Logger,
): Promise<() => Promise<void>> {
  let cursor = await resolveInitialCursor(db);

  async function processIfNew(row: EventRow): Promise<void> {
    if (row.type !== "market_twap") return;
    // Guards against the catch-up backlog and a live NOTIFY racing on the same event.
    if (row.id <= cursor) return;
    await notifyTwap(bot, db, logger, row);
    cursor = row.id;
    await setCursor(db, cursor);
  }

  const backlog = await db
    .select()
    .from(events)
    .where(and(gt(events.id, cursor), eq(events.type, "market_twap")))
    .orderBy(asc(events.id));
  if (backlog.length > MAX_BACKLOG_REPLAY) {
    const skipped = backlog[backlog.length - 1] as EventRow;
    logger.error(
      { cursor, backlogSize: backlog.length, skippedToEventId: skipped.id },
      "twap notifier backlog exceeded safety cap — skipping to head without notifying, investigate the stale cursor",
    );
    cursor = skipped.id;
    await setCursor(db, cursor);
  } else {
    for (const row of backlog) {
      await processIfNew(row);
    }
  }

  await listenClient.listen(NOTIFICATION_CHANNEL, (payload: string) => {
    void (async () => {
      const eventId = Number(payload);
      if (!Number.isFinite(eventId)) return;
      const [row] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
      if (row) await processIfNew(row);
    })().catch((err: unknown) => {
      logger.error({ err }, "unhandled error processing twap notify");
    });
  });

  logger.info({ channel: NOTIFICATION_CHANNEL, cursor }, "twap notifier listening");

  return () => listenClient.end();
}
