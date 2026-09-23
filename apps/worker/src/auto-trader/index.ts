import { createDb } from "@hypertracker/db";
import { HYPERLIQUID_REST_URLS } from "@hypertracker/hyperliquid-sdk";
import { Decimal, type ActiveTwap, type TwapSignal } from "@hypertracker/trading-core";
import { createAutoTraderEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { MidPriceCache } from "../twap-watcher/mid-price-cache.js";
import { ActiveTwapTracker } from "./active-twap-tracker.js";
import { MarketDataCache } from "./market-data-cache.js";
import { HyperliquidOrderBookSource } from "./order-book-source.js";
import { PaperExecutionAdapter } from "./paper-execution-adapter.js";
import { PositionMonitor } from "./position-monitor.js";
import { RiskGuard } from "./risk-guard.js";
import { HyperliquidTwapSignalSource } from "./signal-source.js";
import { classifyTrustScoreEvent } from "./trust-classification.js";
import { TrustScoreStore } from "./trust-score-store.js";
import { evaluateTrigger, type TriggerPipelineDeps } from "./trigger-pipeline.js";

const WORKER_ID = "auto-trader";

const env = createAutoTraderEnv(9108);
const log = createLogger(env.NODE_ENV, env.LOG_LEVEL).child({ worker: WORKER_ID });
const db = createDb(env.DATABASE_URL);

const state: HeartbeatState = { workerId: WORKER_ID, lastEventAt: Date.now(), isHealthy: false };
startHeartbeatServer(state, env.HEARTBEAT_PORT);

if (!env.USE_REAL_AUTO_TRADER) {
  log.warn(
    { useReal: env.USE_REAL_AUTO_TRADER },
    "auto-trader idle — USE_REAL_AUTO_TRADER is false (Phase A/paper is not yet confirmed ready, see CLAUDE.md)",
  );
} else if (!env.USE_REAL_QUICKNODE_TWAP || !env.QUICKNODE_HYPERCORE_WSS_URL) {
  log.warn(
    { useReal: env.USE_REAL_QUICKNODE_TWAP, hasUrl: Boolean(env.QUICKNODE_HYPERCORE_WSS_URL) },
    "auto-trader idle — USE_REAL_QUICKNODE_TWAP is false or QUICKNODE_HYPERCORE_WSS_URL is unset",
  );
} else {
  // env.HYPERLIQUID_NETWORK is zod-validated with a safe testnet default (createAutoTraderEnv)
  // rather than a raw process.env read that fails toward mainnet on any typo — code-review,
  // 2026-09-23 (see apps/api's identically-reasoned isMainnet()).
  const network = env.HYPERLIQUID_NETWORK;
  const baseUrl = HYPERLIQUID_REST_URLS[network];

  // Own REST poll of allMids, same pattern (and same rationale — a duplicate allMids WS
  // subscription from one IP gets dropped) as twap-watcher's identical cache. Reused
  // unmodified, not duplicated: this is a separate instance in a separate process (this
  // worker), which is the "each worker independent" rule, not code duplication.
  const midPrices = new MidPriceCache(network, log.child({ source: "allMids-rest" }));
  midPrices.start();

  const marketData = new MarketDataCache(
    baseUrl,
    log.child({ source: "metaAndAssetCtxs" }),
    env.MARKET_DATA_REFRESH_INTERVAL_MS,
  );
  marketData.start();

  const activeTwaps = new ActiveTwapTracker();
  const trustScores = new TrustScoreStore(db, log.child({ source: "trust-score" }));
  const riskGuard = new RiskGuard(db);
  const executionAdapter = new PaperExecutionAdapter(
    db,
    (coin) => midPrices.get(coin)?.price,
    log.child({ source: "paper-execution" }),
  );

  const positionMonitor = new PositionMonitor(
    db,
    midPrices,
    log.child({ source: "position-monitor" }),
    env.POSITION_MONITOR_POLL_INTERVAL_MS,
  );
  positionMonitor.start();

  const orderBookSource = new HyperliquidOrderBookSource(baseUrl);

  const pipelineDeps: TriggerPipelineDeps = {
    db,
    orderBookSource,
    marketData,
    midPrices,
    trustScores,
    riskGuard,
    executionAdapter,
    logger: log.child({ source: "trigger-pipeline" }),
  };

  // Returns null (not a $0 entry) when the mid-price cache isn't warm yet for this coin —
  // code-review (2026-09-23) caught that the old `?? 0` fallback still upserted a fake
  // zero-notional ActiveTwap, which computeNetFlow (packages/trading-core) would silently
  // include as if this TWAP contributed no pressure at all, invisibly excluding a
  // potentially large real TWAP from spec §7's counter-flow protection for as long as the
  // price cache lags (worker startup, or a coin whose allMids poll hasn't caught up).
  function toActiveTwap(signal: TwapSignal): ActiveTwap | null {
    const mid = midPrices.get(signal.coin);
    if (mid === undefined) return null;
    return {
      externalId: signal.externalId,
      coin: signal.coin,
      side: signal.side,
      notionalUsd: new Decimal(signal.totalSize).abs().times(mid.price).toString(),
      activatedAt: signal.occurredAt,
      reduceOnly: signal.reduceOnly,
    };
  }

  async function handleSignal(signal: TwapSignal): Promise<void> {
    state.lastEventAt = Date.now();

    if (signal.status === "activated") {
      const activeTwap = toActiveTwap(signal);
      if (activeTwap) {
        activeTwaps.upsert(activeTwap);
      } else {
        log.debug(
          { coin: signal.coin, twapId: signal.externalId },
          "no mid price yet — omitting from parallel-flow tracking for now",
        );
      }

      // Spec §1/§5: only fresh directional intent is a trigger candidate — a reduceOnly
      // TWAP closes an existing position rather than opening one (CLAUDE.md, 2026-09-22
      // decision). It was still added to activeTwaps above (when a price was available),
      // since its volume is real parallel-flow pressure (spec §7) even though it can't
      // itself be a trigger.
      if (!signal.reduceOnly) {
        try {
          await evaluateTrigger(signal, activeTwaps.all(), pipelineDeps);
        } catch (err) {
          log.error(
            { err, coin: signal.coin, twapId: signal.externalId },
            "trigger evaluation failed",
          );
        }
      }
      return;
    }

    // Terminal status — no longer active, and (for finished/terminated) potentially
    // Trust-Score-relevant (trust-classification.ts decides; "stopped"/"error" map to null
    // and are deliberately not scored).
    activeTwaps.remove(signal.externalId);

    const eventType = classifyTrustScoreEvent(signal);
    if (!eventType) return;

    const notionalUsd = new Decimal(signal.executedNotionalUsd).abs().toString();
    try {
      await trustScores.recordEvent({
        walletAddress: signal.wallet,
        externalTwapId: signal.externalId,
        eventType,
        coin: signal.coin,
        notionalUsd,
        occurredAt: signal.occurredAt,
      });
    } catch (err) {
      log.error(
        { err, wallet: signal.wallet, twapId: signal.externalId },
        "failed to record trust score event",
      );
    }
  }

  const source = new HyperliquidTwapSignalSource(
    env.QUICKNODE_HYPERCORE_WSS_URL,
    log.child({ source: "quicknode-twap" }),
    () => {
      state.lastEventAt = Date.now();
    },
    (open) => {
      state.isHealthy = open;
    },
  );
  source.start((signal) => {
    void handleSignal(signal).catch((err: unknown) => {
      log.error({ err }, "unhandled error processing twap signal");
    });
  });

  log.info(
    { network, heartbeatPort: env.HEARTBEAT_PORT },
    "auto-trader started (Phase A: paper only)",
  );
}
