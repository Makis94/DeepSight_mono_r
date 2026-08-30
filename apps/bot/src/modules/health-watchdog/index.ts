import { events, type Database } from "@hypertracker/db";
import { desc, eq } from "drizzle-orm";
import type { Bot } from "grammy";
import type { Logger } from "pino";
import { env } from "../../env.js";

const CHECK_INTERVAL_MS = 60_000;
// A still-firing alarm re-pings the admin at most this often — a multi-hour outage should
// nag, not go quiet after one message, but also not spam every minute.
const RENOTIFY_MS = 60 * 60_000;
// Worker heartbeats can legitimately be unreachable for the first minute after a deploy
// (compose only waits on postgres, not on sibling workers) — don't alert during that window.
const HEARTBEAT_GRACE_MS = 2 * 60_000;

// service name (docker-compose.prod.yml) -> heartbeat port. Reachable from the bot container
// over the shared `internal` network. Only checked in production: dev workers run on
// localhost under `concurrently` and aren't addressable by service name.
const WORKER_HEARTBEATS: Record<string, number> = {
  "wallet-watcher": 9101,
  "market-watcher": 9102,
  "deposit-watcher": 9103,
  "coin-registry-sync": 9104,
  "common-wallet-tracker": 9105,
  "subscription-watcher": 9106,
  "twap-watcher": 9107,
};

interface AlarmState {
  firing: boolean;
  lastNotifiedAt: number;
}

/**
 * Polls the two signals that would have caught the ~31h market-TWAP outage on 2026-08-29
 * within a minute instead of when a user complained:
 *  - no `market_twap` row written for `TWAP_STALE_MINUTES` (covers every failure mode —
 *    dead WS, QuickNode wire-format drift, container crash, price starvation — since they
 *    all end in "nothing gets published"), and
 *  - any apps/worker process reporting an unhealthy `/healthz` (faster, names the worker).
 *
 * Sends one Telegram message to `ADMIN_TELEGRAM_ID` on each healthy→unhealthy transition and
 * one on recovery; re-nags hourly while still down. Idle (logs and returns) if
 * `ADMIN_TELEGRAM_ID` is unset, same opt-in shape as the workers' USE_REAL_* flags.
 */
export function startHealthWatchdog(bot: Bot, db: Database, logger: Logger): void {
  if (env.ADMIN_TELEGRAM_ID === undefined) {
    logger.warn("health-watchdog idle — ADMIN_TELEGRAM_ID unset, no alerts will be sent");
    return;
  }
  const adminId: number = env.ADMIN_TELEGRAM_ID;

  const staleMs = env.TWAP_STALE_MINUTES * 60_000;
  const alarms = new Map<string, AlarmState>();
  const startedAt = Date.now();

  async function send(text: string): Promise<void> {
    try {
      await bot.api.sendMessage(adminId, text);
    } catch (err) {
      logger.error({ err }, "health-watchdog failed to send alert");
    }
  }

  async function evaluate(
    key: string,
    down: boolean,
    downMsg: string,
    upMsg: string,
  ): Promise<void> {
    const prev = alarms.get(key) ?? { firing: false, lastNotifiedAt: 0 };
    const now = Date.now();

    if (down) {
      const isNew = !prev.firing;
      const renotify = prev.firing && now - prev.lastNotifiedAt >= RENOTIFY_MS;
      alarms.set(key, {
        firing: true,
        lastNotifiedAt: isNew || renotify ? now : prev.lastNotifiedAt,
      });
      if (isNew || renotify) await send(`🔴 ${downMsg}`);
      return;
    }

    if (prev.firing) {
      alarms.set(key, { firing: false, lastNotifiedAt: now });
      await send(`🟢 ${upMsg}`);
    }
  }

  async function checkTwapFreshness(): Promise<void> {
    const [row] = await db
      .select({ occurredAt: events.occurredAt })
      .from(events)
      .where(eq(events.type, "market_twap"))
      .orderBy(desc(events.occurredAt))
      .limit(1);

    if (!row) {
      await evaluate(
        "twap-data",
        true,
        "No market_twap rows in the database at all — twap-watcher has never published.",
        "Market TWAP feed is flowing again.",
      );
      return;
    }

    const ageMs = Date.now() - row.occurredAt.getTime();
    const mins = Math.round(ageMs / 60_000);
    await evaluate(
      "twap-data",
      ageMs > staleMs,
      `No new market TWAP for ${mins} min (last ${row.occurredAt.toISOString()}). twap-watcher / the QuickNode feed is likely down.`,
      "Market TWAP feed is flowing again.",
    );
  }

  async function checkWorkerHeartbeats(): Promise<void> {
    if (env.NODE_ENV !== "production") return;
    if (Date.now() - startedAt < HEARTBEAT_GRACE_MS) return;

    for (const [service, port] of Object.entries(WORKER_HEARTBEATS)) {
      let ok = false;
      let detail: string;
      try {
        const res = await fetch(`http://${service}:${port}/healthz`, {
          signal: AbortSignal.timeout(3_000),
        });
        ok = res.ok;
        detail = `HTTP ${res.status}`;
      } catch (err) {
        detail = err instanceof Error ? err.message : "unreachable";
      }
      await evaluate(
        `hb:${service}`,
        !ok,
        `Worker "${service}" is unhealthy (${detail}).`,
        `Worker "${service}" is healthy again.`,
      );
    }
  }

  async function runChecks(): Promise<void> {
    try {
      await checkTwapFreshness();
      await checkWorkerHeartbeats();
    } catch (err) {
      logger.error({ err }, "health-watchdog check cycle failed");
    }
  }

  void runChecks();
  setInterval(() => void runChecks(), CHECK_INTERVAL_MS);
  logger.info({ staleMinutes: env.TWAP_STALE_MINUTES }, "health-watchdog started");
}
