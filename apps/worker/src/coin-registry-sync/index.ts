import { createDb } from "@hypertracker/db";
import { createCoinRegistrySyncEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { resolveCmcSource } from "./cmc-client.js";
import { syncCoinRegistry } from "./sync.js";

const WORKER_ID = "coin-registry-sync";
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
// This job only ticks every SYNC_INTERVAL_MS, unlike the continuously-streaming WS
// workers — the heartbeat's staleness window has to be wider than the interval or it
// would report unhealthy the moment a tick finishes.
const STALE_AFTER_MS = SYNC_INTERVAL_MS + 60 * 60 * 1000;

const env = createCoinRegistrySyncEnv(9104);
const log = createLogger(env.NODE_ENV, env.LOG_LEVEL).child({ worker: WORKER_ID });
const db = createDb(env.DATABASE_URL);
const cmcSource = resolveCmcSource(env);

const state: HeartbeatState = {
  workerId: WORKER_ID,
  lastEventAt: Date.now(),
  isHealthy: false,
};

startHeartbeatServer(state, env.HEARTBEAT_PORT, STALE_AFTER_MS);

async function runSync(): Promise<void> {
  try {
    await syncCoinRegistry(db, log, cmcSource);
    state.isHealthy = true;
    state.lastEventAt = Date.now();
  } catch (err) {
    state.isHealthy = false;
    log.error({ err }, "coin_registry sync failed");
  }
}

void runSync();
setInterval(() => void runSync(), SYNC_INTERVAL_MS);
