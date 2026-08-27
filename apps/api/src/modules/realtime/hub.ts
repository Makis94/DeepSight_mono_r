import {
  activeSubscriptionCondition,
  events,
  subscriptions,
  users,
  watchedWallets,
  type Database,
} from "@hypertracker/db";
import { NOTIFICATION_CHANNEL } from "@hypertracker/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { WebSocket } from "ws";

interface RealtimeClient {
  socket: WebSocket;
  telegramId: number;
  watchedAddresses: Set<string>;
  // Snapshot of the user's large-trade alert settings at connect time — same
  // once-per-connection semantics as watchedAddresses (see class doc comment).
  notifyTrades: boolean;
  minTradeAmount: number;
  // Same snapshot semantics, for the market-wide TWAP alert (market_twap).
  notifyTwaps: boolean;
  minTwapAmount: number;
  // Same snapshot semantics, for global deposit monitoring (global_deposit) — see module 1
  // in CLAUDE.md and the deposit-monitoring-architecture skill.
  notifyDeposits: boolean;
  minDepositAmount: number;
  // Same snapshot semantics — applies only to the market_trade/market_twap branches below,
  // not to watched-wallet events (see users.excludeBtc/excludeEth doc comment in
  // packages/db).
  excludeBtc: boolean;
  excludeEth: boolean;
  // Heartbeat bookkeeping (see startHeartbeat) — flipped true on every pong, checked and
  // reset false on every heartbeat tick.
  isAlive: boolean;
}

// A client whose fan-out never crosses its threshold (the common case at a $500k trade
// filter) sends and receives nothing for long stretches. Left alone, that idle socket gets
// silently dropped by intermediaries that time out idle connections — observed in local dev
// through an ngrok free-tier tunnel at roughly 100-135s — with no close frame the app can
// react to differently from any other disconnect. A ping well under that window keeps the
// connection classified as active; a client that stops answering pongs gets reaped instead
// of leaking.
const HEARTBEAT_INTERVAL_MS = 25_000;

// See users.excludeBtc/excludeEth doc comment (packages/db) — only market_trade/market_twap
// fan-out consults this, watched-wallet events never do.
function isCoinExcluded(client: RealtimeClient, coin: string | null): boolean {
  if (coin === "BTC") return client.excludeBtc;
  if (coin === "ETH") return client.excludeEth;
  return false;
}

/**
 * One shared LISTEN connection for the whole apps/api process, fanning out to every
 * connected WS client in-process — not one Postgres LISTEN per browser connection. A
 * client's `watchedAddresses` is a snapshot taken at connect time; adding/removing a
 * wallet while connected only takes effect on the next reconnect (acceptable for a basic
 * first version, not something to silently pretend is live).
 */
export class RealtimeHub {
  private readonly clients = new Set<RealtimeClient>();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly db: Database,
    private readonly listenClient: {
      listen: (channel: string, cb: (payload: string) => void) => Promise<unknown>;
    },
    private readonly logger: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    await this.listenClient.listen(NOTIFICATION_CHANNEL, (payload: string) => {
      void this.handleNotify(payload);
    });
    this.logger.info({ channel: NOTIFICATION_CHANNEL }, "realtime hub listening for events");
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  private heartbeat(): void {
    for (const client of this.clients) {
      if (!client.isAlive) {
        // Missed the previous ping entirely (proxy dropped it, client hung, ...) — terminate
        // rather than ping again so a dead socket doesn't linger a full extra interval.
        client.socket.terminate();
        this.clients.delete(client);
        continue;
      }
      client.isAlive = false;
      client.socket.ping();
    }
  }

  // Same guard requireActiveSubscription applies to every REST dashboard route — the realtime
  // channel is a dashboard surface too, just one that can't send an HTTP 402 (see
  // realtime/routes.ts, which closes the socket instead). Checked once at connect time, same
  // snapshot-at-connect semantics as watchedAddresses/notifyTrades below: a subscription that
  // lapses mid-session is caught on the next reconnect, not instantly.
  async hasActiveSubscription(telegramId: number): Promise<boolean> {
    const [sub] = await this.db
      .select({ telegramId: subscriptions.telegramId })
      .from(subscriptions)
      .where(and(eq(subscriptions.telegramId, telegramId), activeSubscriptionCondition()))
      .limit(1);
    return Boolean(sub);
  }

  async addClient(socket: WebSocket, telegramId: number): Promise<RealtimeClient> {
    const rows = await this.db
      .select({ address: watchedWallets.address })
      .from(watchedWallets)
      .where(eq(watchedWallets.userId, telegramId));

    const [userRow] = await this.db
      .select({
        notifyTrades: users.notifyTrades,
        minTradeAmount: users.minTradeAmount,
        notifyTwaps: users.notifyTwaps,
        minTwapAmount: users.minTwapAmount,
        notifyDeposits: users.notifyDeposits,
        minDepositAmount: users.minDepositAmount,
        excludeBtc: users.excludeBtc,
        excludeEth: users.excludeEth,
      })
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    const client: RealtimeClient = {
      socket,
      telegramId,
      watchedAddresses: new Set(rows.map((row) => row.address.toLowerCase())),
      // Fallbacks mirror the users table's own column defaults (packages/db/src/schema/
      // users.ts) — highest preset per threshold, not "0" — for the same theoretical
      // gap-before-the-row-lands case as settings/routes.ts's toResponse.
      notifyTrades: userRow?.notifyTrades ?? true,
      minTradeAmount: Number(userRow?.minTradeAmount ?? "1000000"),
      notifyTwaps: userRow?.notifyTwaps ?? true,
      minTwapAmount: Number(userRow?.minTwapAmount ?? "1000000"),
      notifyDeposits: userRow?.notifyDeposits ?? true,
      minDepositAmount: Number(userRow?.minDepositAmount ?? "2000000"),
      excludeBtc: userRow?.excludeBtc ?? false,
      excludeEth: userRow?.excludeEth ?? false,
      isAlive: true,
    };
    socket.on("pong", () => {
      client.isAlive = true;
    });
    this.clients.add(client);
    return client;
  }

  removeClient(client: RealtimeClient): void {
    this.clients.delete(client);
  }

  // Called right after auth/session-store.ts revokes this user's previous session (a newer
  // login superseding it) — closes any live socket for the old session immediately instead of
  // leaving it streaming on a stale snapshot until it happens to reconnect or the client-side
  // 401 handling on some other REST call catches up. 4001 mirrors the "invalid session" close
  // code realtime/routes.ts already uses for a bad handshake.
  forceDisconnect(telegramId: number): void {
    for (const client of this.clients) {
      if (client.telegramId !== telegramId) continue;
      client.socket.close(4001, "session revoked");
      this.clients.delete(client);
    }
  }

  private async handleNotify(payload: string): Promise<void> {
    const eventId = Number(payload);
    if (!Number.isFinite(eventId)) return;

    const [event] = await this.db.select().from(events).where(eq(events.id, eventId)).limit(1);
    if (!event) return;

    // market_trade events carry no wallet — they're global, so fan-out is per-user
    // threshold/opt-in (users.minTradeAmount/notifyTrades) rather than watchedAddresses.
    // Every other event type is tied to a specific watched wallet.
    if (event.type === "market_trade") {
      const notionalUsd = Number(event.amountUsd ?? "0");
      for (const client of this.clients) {
        if (!client.notifyTrades) continue;
        if (notionalUsd < client.minTradeAmount) continue;
        if (isCoinExcluded(client, event.coin)) continue;
        if (client.socket.readyState !== client.socket.OPEN) continue;
        this.send(client, event);
      }
      return;
    }

    // Same global fan-out shape as market_trade — market_twap is never tied to a watched
    // wallet either (see marketTwapPayloadSchema doc comment).
    if (event.type === "market_twap") {
      const notionalUsd = Number(event.amountUsd ?? "0");
      for (const client of this.clients) {
        if (!client.notifyTwaps) continue;
        if (notionalUsd < client.minTwapAmount) continue;
        if (isCoinExcluded(client, event.coin)) continue;
        if (client.socket.readyState !== client.socket.OPEN) continue;
        this.send(client, event);
      }
      return;
    }

    // Same global fan-out shape as market_trade/market_twap — global_deposit is never tied
    // to a watched wallet either (see globalDepositPayloadSchema doc comment).
    if (event.type === "global_deposit") {
      const notionalUsd = Number(event.amountUsd ?? "0");
      for (const client of this.clients) {
        if (!client.notifyDeposits) continue;
        if (notionalUsd < client.minDepositAmount) continue;
        if (client.socket.readyState !== client.socket.OPEN) continue;
        this.send(client, event);
      }
      return;
    }

    if (!event.walletAddress) return;
    const address = event.walletAddress.toLowerCase();
    for (const client of this.clients) {
      if (!client.watchedAddresses.has(address)) continue;
      if (client.socket.readyState !== client.socket.OPEN) continue;
      this.send(client, event);
    }
  }

  private send(client: RealtimeClient, event: typeof events.$inferSelect): void {
    client.socket.send(
      JSON.stringify({
        id: event.id,
        type: event.type,
        coin: event.coin,
        side: event.side,
        amountUsd: event.amountUsd,
        walletAddress: event.walletAddress,
        payload: event.payload,
        occurredAt: event.occurredAt,
      }),
    );
  }
}
