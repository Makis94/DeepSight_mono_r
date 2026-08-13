import {
  activeSubscriptionCondition,
  events,
  eventCursors,
  subscriptions,
  users,
  type Database,
  type ListenClient,
} from "@hypertracker/db";
import { NOTIFICATION_CHANNEL, type MarketTradePayload } from "@hypertracker/shared";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Bot } from "grammy";
import type { Logger } from "pino";

// Same shape as deposit-notifier.ts's CONSUMER, but its own row — event_cursors is keyed by
// consumer, and this notifier watermarks a different filtered subset of the same events.id
// sequence (type = "market_trade") than the deposit one does.
const CONSUMER = "bot-notifier-trades";

type EventRow = typeof events.$inferSelect;

// null means this consumer has never run before (no row at all yet) — distinct from an
// existing row whose lastEventId happens to be small. Unlike deposit-notifier (low volume,
// safe to replay from the very start), market_trade already has tens of thousands of
// historical rows by the time this notifier is first deployed — replaying all of it would
// blast every matching user with a backlog of one-time Telegram messages. See
// startTradeNotifier: a null cursor gets seeded to the current head instead of 0.
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

// Resolves the starting cursor, seeding a brand-new consumer to the current head (see
// getCursor's doc comment) rather than leaving `cursor` typed number | null through the rest
// of startTradeNotifier.
async function resolveInitialCursor(db: Database): Promise<number> {
  const existing = await getCursor(db);
  if (existing !== null) return existing;

  const [head] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.type, "market_trade"))
    .orderBy(desc(events.id))
    .limit(1);
  const cursor = head?.id ?? 0;
  await setCursor(db, cursor);
  return cursor;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTradeMessage(payload: MarketTradePayload, amountUsd: string): string {
  const amount = Math.round(Number(amountUsd)).toLocaleString("en-US");
  const sideLabel = payload.side === "buy" ? "🟢 Buy" : "🔴 Sell";
  return [
    `📈 Large trade: ${sideLabel} $${amount} ${payload.coin} @ $${payload.price}`,
    `Buyer: \`${shortAddress(payload.buyerAddress)}\``,
    `Seller: \`${shortAddress(payload.sellerAddress)}\``,
  ].join("\n");
}

async function notifyTrade(bot: Bot, db: Database, logger: Logger, event: EventRow): Promise<void> {
  const amountUsd = event.amountUsd ?? "0";
  // Guaranteed by the producer (market-watcher publishEvent, type "market_trade") — the
  // caller (processIfNew below) already filtered on event.type before reaching here.
  const payload = event.payload as MarketTradePayload;

  // Only users with a currently-active subscription/trial ever get notified — see
  // activeSubscriptionCondition's doc comment (packages/db) for why this re-checks the date
  // rather than trusting the cached subscriptions.status column.
  const recipients = await db
    .select({ telegramId: users.telegramId })
    .from(users)
    .innerJoin(subscriptions, eq(subscriptions.telegramId, users.telegramId))
    .where(
      and(
        eq(users.notifyTrades, true),
        sql`${users.minTradeAmount}::numeric <= ${amountUsd}::numeric`,
        activeSubscriptionCondition(),
      ),
    );

  const text = formatTradeMessage(payload, amountUsd);
  for (const recipient of recipients) {
    try {
      await bot.api.sendMessage(recipient.telegramId, text, { parse_mode: "Markdown" });
    } catch (err) {
      logger.error(
        { err, telegramId: recipient.telegramId, eventId: event.id },
        "failed to send trade notification",
      );
    }
  }
}

// Hard safety cap, independent of resolveInitialCursor's seed-to-head logic — that logic
// only protects a true first run. If a cursor ever ends up stale for some other reason (a
// bad manual reset, a consumer rename, a migration mistake), this is the last line of
// defense against silently blasting a huge historical backlog out to every matching user's
// Telegram as one-time messages (this happened once during development — see git history).
const MAX_BACKLOG_REPLAY = 500;

/**
 * Starts the large-trade notifier: replays anything published while the bot was offline (via
 * the durable cursor), then listens live on the same Postgres NOTIFY channel the realtime WS
 * hub uses (apps/api RealtimeHub) — a second, independent consumer of the same event bus, not
 * a replacement for it. Returns a stop function.
 */
export async function startTradeNotifier(
  bot: Bot,
  db: Database,
  listenClient: ListenClient,
  logger: Logger,
): Promise<() => Promise<void>> {
  let cursor = await resolveInitialCursor(db);

  async function processIfNew(row: EventRow): Promise<void> {
    if (row.type !== "market_trade") return;
    // Guards against the catch-up backlog and a live NOTIFY racing on the same event.
    if (row.id <= cursor) return;
    await notifyTrade(bot, db, logger, row);
    cursor = row.id;
    await setCursor(db, cursor);
  }

  const backlog = await db
    .select()
    .from(events)
    .where(and(gt(events.id, cursor), eq(events.type, "market_trade")))
    .orderBy(asc(events.id));
  if (backlog.length > MAX_BACKLOG_REPLAY) {
    const skipped = backlog[backlog.length - 1] as EventRow;
    logger.error(
      { cursor, backlogSize: backlog.length, skippedToEventId: skipped.id },
      "trade notifier backlog exceeded safety cap — skipping to head without notifying, investigate the stale cursor",
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
      logger.error({ err }, "unhandled error processing trade notify");
    });
  });

  logger.info({ channel: NOTIFICATION_CHANNEL, cursor }, "trade notifier listening");

  return () => listenClient.end();
}
