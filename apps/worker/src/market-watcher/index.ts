import { createDb, type NewEvent } from "@hypertracker/db";
import {
  HYPERLIQUID_REST_URLS,
  HYPERLIQUID_WS_URLS,
  HyperliquidWsClient,
} from "@hypertracker/hyperliquid-sdk";
import { createMarketWatcherEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { publishEvent } from "../shared/publish-event.js";
import { RecentIdDedup } from "./dedup.js";
import { createAllMidsHandler } from "./handlers/all-mids.js";
import { createTradesHandler } from "./handlers/trades.js";
import { SubscriptionManager } from "./subscription-manager.js";
import { confirmTwapCandidate } from "./twap-confirm.js";
import { DEFAULT_TWAP_HEURISTIC_PARAMS, TwapPatternDetector } from "./twap-heuristic.js";

const WORKER_ID = "market-watcher";
const REFRESH_INTERVAL_MS = 15_000;

const env = createMarketWatcherEnv(9102);
const log = createLogger(env.NODE_ENV, env.LOG_LEVEL).child({ worker: WORKER_ID });
const db = createDb(env.DATABASE_URL);

const network = process.env["HYPERLIQUID_NETWORK"] === "testnet" ? "testnet" : "mainnet";

const state: HeartbeatState = { workerId: WORKER_ID, lastEventAt: Date.now(), isHealthy: false };
startHeartbeatServer(state, env.HEARTBEAT_PORT);

const client = new HyperliquidWsClient({
  url: HYPERLIQUID_WS_URLS[network],
  logger: log,
  onOpen: () => {
    state.isHealthy = true;
    state.lastEventAt = Date.now();
  },
  onClose: () => {
    state.isHealthy = false;
  },
  onPong: () => {
    state.lastEventAt = Date.now();
  },
});

const dedup = new RecentIdDedup();
const subscriptions = new SubscriptionManager(db, client, log);
const twapDetector = new TwapPatternDetector({
  ...DEFAULT_TWAP_HEURISTIC_PARAMS,
  minNotionalUsd: env.MARKET_TWAP_MIN_NOTIONAL_USD,
});

client.on(
  "trades",
  createTradesHandler(db, dedup, env.MARKET_TRADE_MIN_NOTIONAL_USD, twapDetector, log),
);

// Header price ticker (apps/web) — one shared subscription for every coin's mid price, not
// per-coin like `trades` above, so it's subscribed once here rather than through
// SubscriptionManager's active-coin refresh loop.
client.on("allMids", createAllMidsHandler(db, log));
client.subscribe({ type: "allMids" });

client.connect();

// Offers every streak that currently clears the heuristic thresholds and hasn't been
// reported yet (see twap-heuristic.ts collectCandidates() doc comment — this runs as soon as
// a streak first qualifies, not once its series ends), REST-confirms each against
// Hyperliquid's real TWAP fill history, and publishes only real confirmed matches — never a
// guess. A candidate the lookup doesn't confirm is left alone to be re-offered on a later
// tick, until it either confirms or the streak goes stale and is silently dropped.
async function flushTwapDetector(): Promise<void> {
  const candidates = twapDetector.collectCandidates(Date.now());
  for (const candidate of candidates) {
    try {
      const result = await confirmTwapCandidate(HYPERLIQUID_REST_URLS[network], candidate, log);
      if (result.status === "not_yet") continue;

      twapDetector.markReported(candidate.coin, candidate.address, candidate.side);

      const { payload } = result;
      const event: Omit<NewEvent, "id" | "createdAt"> = {
        type: "market_twap_suspected",
        walletAddress: null,
        coin: payload.coin,
        side: payload.side,
        amountUsd: payload.notionalUsd,
        payload,
        occurredAt: new Date(payload.lastSeenAt),
        externalId: `twap-confirmed:${payload.coin}:${payload.address}:${payload.side}:${candidate.firstSeenAt}`,
      };
      await publishEvent(db, event);
    } catch (err) {
      log.error(
        { err, coin: candidate.coin, address: candidate.address },
        "failed to confirm/publish market_twap_suspected candidate",
      );
    }
  }
}
setInterval(() => void flushTwapDetector(), REFRESH_INTERVAL_MS);

async function refreshLoop(): Promise<void> {
  try {
    await subscriptions.refresh();
  } catch (err) {
    log.error({ err }, "failed to refresh market-watcher subscriptions");
  }
}

void refreshLoop();
setInterval(() => void refreshLoop(), REFRESH_INTERVAL_MS);

log.info(
  {
    network,
    minNotionalUsd: env.MARKET_TRADE_MIN_NOTIONAL_USD,
    heartbeatPort: env.HEARTBEAT_PORT,
  },
  "market-watcher started",
);
