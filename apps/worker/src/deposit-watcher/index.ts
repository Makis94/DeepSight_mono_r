import { createDb, type NewEvent } from "@hypertracker/db";
import { createDepositWatcherEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { publishEvent } from "../shared/publish-event.js";
import {
  ArbitrumBridge2DepositSource,
  resolveArbitrumSource,
} from "./sources/arbitrum-bridge2-deposit-source.js";
import type { DepositEvent, DepositSource } from "./sources/deposit-source.interface.js";
import { getBlockNumber } from "./sources/evm-json-rpc.js";
import {
  HYPEREVM_RPC_URL,
  HyperEvmCctpForwarderDepositSource,
  resolveHyperEvmCctpSource,
} from "./sources/hyperevm-cctp-forwarder-deposit-source.js";

const WORKER_ID = "deposit-watcher";
const HEALTH_POLL_INTERVAL_MS = 30_000;

const env = createDepositWatcherEnv(9103);
const log = createLogger(env.NODE_ENV, env.LOG_LEVEL).child({ worker: WORKER_ID });
const db = createDb(env.DATABASE_URL);
const arbitrumSource = resolveArbitrumSource(env);
const hyperEvmCctpSource = resolveHyperEvmCctpSource(env);

const state: HeartbeatState = {
  workerId: WORKER_ID,
  lastEventAt: Date.now(),
  isHealthy: false,
};
startHeartbeatServer(state, env.HEARTBEAT_PORT);

// No dedicated cursor table for this worker (same tradeoff the removed The Graph source
// made) — each EVM source resumes from "current latest block minus a small safety buffer"
// on every process start rather than a persisted per-source cursor. A cold start (or a
// restart) doesn't replay arbitrary history; the buffer only covers the gap a restart itself
// might introduce, not extended downtime.
const RESTART_SAFETY_BLOCKS = 50;

async function getStartingBlock(rpcUrl: string): Promise<number> {
  const latest = await getBlockNumber(rpcUrl);
  return Math.max(0, latest - RESTART_SAFETY_BLOCKS);
}

async function handleDeposit(deposit: DepositEvent): Promise<void> {
  // Global floor — fetch once above the lowest configured threshold, filter per-user
  // downstream (apps/api settings/realtime hub, apps/bot notifier), same pattern as
  // market-watcher's MARKET_TRADE_MIN_NOTIONAL_USD.
  if (Number(deposit.amountUsdc) < env.DEPOSIT_MIN_NOTIONAL_USD) return;

  const event: Omit<NewEvent, "id" | "createdAt"> = {
    type: "global_deposit",
    walletAddress: null,
    coin: null,
    side: null,
    amountUsd: deposit.amountUsdc,
    payload: {
      type: "global_deposit",
      depositorAddress: deposit.depositorAddress,
      amountUsdc: deposit.amountUsdc,
      txHash: deposit.txHash,
      sourceChain: deposit.sourceChain,
    },
    occurredAt: new Date(deposit.blockTimestamp * 1000),
    externalId: `deposit:${deposit.txHash}`,
  };

  try {
    await publishEvent(db, event);
    state.isHealthy = true;
    state.lastEventAt = Date.now();
  } catch (err) {
    log.error({ err, txHash: deposit.txHash }, "failed to publish global_deposit event");
  }
}

async function run(): Promise<void> {
  if (!arbitrumSource.useReal && !hyperEvmCctpSource.useReal) {
    // Deliberately idle, not a crash and not a fake "healthy" — there is no meaningful mock
    // for "which deposits happened" the way coin-registry-sync can fall back to a static
    // coin list, so silence here would be a silent stub. See CLAUDE.md's "never leave silent
    // stubs" rule and the Post-MVP note on deposit monitoring's external dependency.
    log.warn(
      "USE_REAL_ARBITRUM=false and USE_REAL_HYPEREVM_CCTP=false — deposit-watcher is idle and will not detect any deposits until at least one is enabled",
    );
    return;
  }

  const sources: { source: DepositSource; rpcUrl: string }[] = [];
  if (arbitrumSource.useReal) {
    sources.push({
      source: new ArbitrumBridge2DepositSource(arbitrumSource.rpcUrl, log),
      rpcUrl: arbitrumSource.rpcUrl,
    });
  }
  if (hyperEvmCctpSource.useReal) {
    sources.push({ source: new HyperEvmCctpForwarderDepositSource(log), rpcUrl: HYPEREVM_RPC_URL });
  }

  log.info(
    { sources: sources.map((s) => s.source.name), minNotionalUsd: env.DEPOSIT_MIN_NOTIONAL_USD },
    "deposit-watcher starting",
  );

  for (const { source, rpcUrl } of sources) {
    const cursor = await getStartingBlock(rpcUrl);
    log.info({ source: source.name, cursor }, "starting deposit source");
    void source.start(cursor, (deposit) => void handleDeposit(deposit));
  }

  // Bumps lastEventAt on every tick where all sources report healthy, regardless of whether
  // an actual deposit was found — deposits are naturally sparse (even at a $5k floor, gaps
  // of several minutes are normal), so tying heartbeat freshness to "a deposit was recently
  // published" (as handleDeposit's own state.lastEventAt update does) made a perfectly
  // healthy, idle poller/subscriber report itself as stale after staleAfterMs. This tick is
  // the actual liveness signal; a published deposit is a bonus, not the only valid one.
  setInterval(() => {
    const healthy = sources.every(({ source }) => source.getHealthStatus().isHealthy);
    state.isHealthy = healthy;
    if (healthy) state.lastEventAt = Date.now();
  }, HEALTH_POLL_INTERVAL_MS);
}

void run();
