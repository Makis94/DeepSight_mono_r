import {
  activeSubscriptionCondition,
  events,
  eventCursors,
  subscriptions,
  users,
  type Database,
  type ListenClient,
} from "@hypertracker/db";
import { NOTIFICATION_CHANNEL, type GlobalDepositPayload } from "@hypertracker/shared";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Bot } from "grammy";
import type { Logger } from "pino";

// Scoped to global_deposit only for now — a general per-event-type dispatcher can be built
// once other event types need Telegram delivery too, see CLAUDE.md's Post-MVP note. Resumes
// via event_cursors (consumer="bot-notifier"), the durable-replay-cursor table that was
// already built with this exact consumer in mind (see its own doc comment).
const CONSUMER = "bot-notifier";

type EventRow = typeof events.$inferSelect;

async function getCursor(db: Database): Promise<number> {
  const [row] = await db
    .select({ lastEventId: eventCursors.lastEventId })
    .from(eventCursors)
    .where(eq(eventCursors.consumer, CONSUMER))
    .limit(1);
  return row?.lastEventId ?? 0;
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

function formatDepositMessage(payload: GlobalDepositPayload, amountUsd: string): string {
  const amount = Math.round(Number(amountUsd)).toLocaleString("en-US");
  const address = payload.depositorAddress;
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
  return [
    `🏦 New deposit: $${amount}`,
    `Address: \`${shortAddress}\``,
    `Tx: \`${payload.txHash}\``,
  ].join("\n");
}

async function notifyDeposit(
  bot: Bot,
  db: Database,
  logger: Logger,
  event: EventRow,
): Promise<void> {
  const amountUsd = event.amountUsd ?? "0";
  // Guaranteed by the producer (deposit-watcher publishEvent, type "global_deposit") — the
  // caller (handleNotifiableEvent below) already filtered on event.type before reaching here.
  const payload = event.payload as GlobalDepositPayload;

  // Only users with a currently-active subscription/trial ever get notified — see
  // activeSubscriptionCondition's doc comment for why this re-checks the date rather than
  // trusting the cached subscriptions.status column.
  const recipients = await db
    .select({ telegramId: users.telegramId })
    .from(users)
    .innerJoin(subscriptions, eq(subscriptions.telegramId, users.telegramId))
    .where(
      and(
        eq(users.notifyDeposits, true),
        sql`${users.minDepositAmount}::numeric <= ${amountUsd}::numeric`,
        activeSubscriptionCondition(),
      ),
    );

  const text = formatDepositMessage(payload, amountUsd);
  for (const recipient of recipients) {
    try {
      await bot.api.sendMessage(recipient.telegramId, text, { parse_mode: "Markdown" });
    } catch (err) {
      logger.error(
        { err, telegramId: recipient.telegramId, eventId: event.id },
        "failed to send deposit notification",
      );
    }
  }
}

/**
 * Starts the deposit notifier: replays anything published while the bot was offline (via
 * the durable cursor), then listens live on the same Postgres NOTIFY channel the realtime
 * WS hub uses (apps/api RealtimeHub) — a second, independent consumer of the same event bus,
 * not a replacement for it. Returns a stop function.
 */
export async function startDepositNotifier(
  bot: Bot,
  db: Database,
  listenClient: ListenClient,
  logger: Logger,
): Promise<() => Promise<void>> {
  let cursor = await getCursor(db);

  async function processIfNew(row: EventRow): Promise<void> {
    if (row.type !== "global_deposit") return;
    // Guards against the catch-up backlog and a live NOTIFY racing on the same event.
    if (row.id <= cursor) return;
    await notifyDeposit(bot, db, logger, row);
    cursor = row.id;
    await setCursor(db, cursor);
  }

  const backlog = await db
    .select()
    .from(events)
    .where(and(gt(events.id, cursor), eq(events.type, "global_deposit")))
    .orderBy(asc(events.id));
  for (const row of backlog) {
    await processIfNew(row);
  }

  await listenClient.listen(NOTIFICATION_CHANNEL, (payload: string) => {
    void (async () => {
      const eventId = Number(payload);
      if (!Number.isFinite(eventId)) return;
      const [row] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
      if (row) await processIfNew(row);
    })().catch((err: unknown) => {
      logger.error({ err }, "unhandled error processing deposit notify");
    });
  });

  logger.info({ channel: NOTIFICATION_CHANNEL, cursor }, "deposit notifier listening");

  return () => listenClient.end();
}
