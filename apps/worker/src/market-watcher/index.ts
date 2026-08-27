import { createDb } from "@hypertracker/db";
import { HYPERLIQUID_WS_URLS, HyperliquidWsClient } from "@hypertracker/hyperliquid-sdk";
import { createMarketWatcherEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { RecentIdDedup } from "./dedup.js";
import { createAllMidsHandler } from "./handlers/all-mids.js";
import { createTradesHandler } from "./handlers/trades.js";
import { SubscriptionManager } from "./subscription-manager.js";

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

client.on("trades", createTradesHandler(db, dedup, env.MARKET_TRADE_MIN_NOTIONAL_USD, log));

// Header price ticker (apps/web) — one shared subscription for every coin's mid price, not
// per-coin like `trades` above, so it's subscribed once here rather than through
// SubscriptionManager's active-coin refresh loop.
client.on("allMids", createAllMidsHandler(db, log));
client.subscribe({ type: "allMids" });

client.connect();

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
