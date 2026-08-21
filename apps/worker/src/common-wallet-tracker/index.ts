import { createDb } from "@hypertracker/db";
import {
  HYPERLIQUID_REST_URLS,
  HYPERLIQUID_WS_URLS,
  HyperliquidWsClient,
} from "@hypertracker/hyperliquid-sdk";
import { createWorkerEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { CoinUniverseManager } from "./coin-universe-manager.js";
import { RecentIdDedup } from "./dedup.js";
import { createTradesHandler } from "./handlers/trades.js";
import { CommonWalletRegistry } from "./wallet-registry.js";

const WORKER_ID = "common-wallet-tracker";
const WALLET_REFRESH_INTERVAL_MS = 15_000;

const env = createWorkerEnv(9105);
const log = createLogger(env.NODE_ENV, env.LOG_LEVEL).child({ worker: WORKER_ID });
const db = createDb(env.DATABASE_URL);

const network = process.env["HYPERLIQUID_NETWORK"] === "testnet" ? "testnet" : "mainnet";
const restBaseUrl = HYPERLIQUID_REST_URLS[network];

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
const registry = new CommonWalletRegistry(db);
const coinUniverse = new CoinUniverseManager(restBaseUrl, client, log);

client.on("trades", createTradesHandler(db, dedup, registry, log, restBaseUrl));

client.connect();
coinUniverse.startPolling();

async function refreshWallets(): Promise<void> {
  try {
    await registry.refresh();
  } catch (err) {
    log.error({ err }, "failed to refresh common wallet registry");
  }
}

void refreshWallets();
setInterval(() => void refreshWallets(), WALLET_REFRESH_INTERVAL_MS);

log.info({ network, heartbeatPort: env.HEARTBEAT_PORT }, "common-wallet-tracker started");
