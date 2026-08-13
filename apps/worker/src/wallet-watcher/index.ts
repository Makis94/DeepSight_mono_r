import { createDb } from "@hypertracker/db";
import {
  HYPERLIQUID_REST_URLS,
  HYPERLIQUID_WS_URLS,
  HyperliquidWsClient,
} from "@hypertracker/hyperliquid-sdk";
import { createWorkerEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { RecentIdDedup } from "./dedup.js";
import { createFillsHandler } from "./handlers/fills.js";
import { createTwapHandler } from "./handlers/twap.js";
import { SubscriptionManager } from "./subscription-manager.js";

const WORKER_ID = "wallet-watcher";
const REFRESH_INTERVAL_MS = 15_000;

const env = createWorkerEnv(9101);
const log = createLogger(env.NODE_ENV, env.LOG_LEVEL).child({ worker: WORKER_ID });
const db = createDb(env.DATABASE_URL);

// Which wallet-watcher instance/egress IP this process represents — matches
// watched_wallets.shard_id. Not yet wired to actual multi-IP deployment; single instance
// defaults to shard 0 today.
const shardId = Number(process.env["SHARD_ID"] ?? "0");
const network = process.env["HYPERLIQUID_NETWORK"] === "testnet" ? "testnet" : "mainnet";

const state: HeartbeatState = {
  workerId: WORKER_ID,
  lastEventAt: Date.now(),
  isHealthy: false,
};
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
});

const dedup = new RecentIdDedup();
const subscriptions = new SubscriptionManager(db, client, shardId, log);

client.on(
  "userFills",
  createFillsHandler(db, dedup, subscriptions, log, HYPERLIQUID_REST_URLS[network]),
);
client.on(
  "userTwapHistory",
  createTwapHandler(db, dedup, subscriptions, log, HYPERLIQUID_REST_URLS[network]),
);

client.connect();

async function refreshLoop(): Promise<void> {
  try {
    await subscriptions.refresh();
  } catch (err) {
    log.error({ err }, "failed to refresh wallet-watcher subscriptions");
  }
}

void refreshLoop();
setInterval(() => void refreshLoop(), REFRESH_INTERVAL_MS);

log.info({ shardId, network, heartbeatPort: env.HEARTBEAT_PORT }, "wallet-watcher started");
