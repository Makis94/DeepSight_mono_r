import { createDb, type NewEvent } from "@hypertracker/db";
import { HYPERLIQUID_WS_URLS, HyperliquidWsClient } from "@hypertracker/hyperliquid-sdk";
import type { MarketTwapPayload } from "@hypertracker/shared";
import { createTwapWatcherEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { publishEvent } from "../shared/publish-event.js";
import { MidPriceCache } from "./mid-price-cache.js";
import { QuicknodeTwapSource } from "./sources/quicknode-twap-source.js";
import type { QuicknodeTwapEvent } from "./quicknode-schemas.js";

const WORKER_ID = "twap-watcher";

// Same "B"/"A" convention as every other Hyperliquid fill/state side field this project
// parses (see apps/worker/src/wallet-watcher/classify.ts's fillSide) — QuickNode's TWAP
// `state` object mirrors Hyperliquid's own native TWAP state verbatim (see
// quicknode-schemas.ts doc comment).
function sideFromHyperliquid(side: string): "buy" | "sell" {
  return side === "B" ? "buy" : "sell";
}

const env = createTwapWatcherEnv(9107);
const log = createLogger(env.NODE_ENV, env.LOG_LEVEL).child({ worker: WORKER_ID });
const db = createDb(env.DATABASE_URL);

const state: HeartbeatState = { workerId: WORKER_ID, lastEventAt: Date.now(), isHealthy: false };
startHeartbeatServer(state, env.HEARTBEAT_PORT);

if (!env.USE_REAL_QUICKNODE_TWAP || !env.QUICKNODE_HYPERCORE_WSS_URL) {
  log.warn(
    { useReal: env.USE_REAL_QUICKNODE_TWAP, hasUrl: Boolean(env.QUICKNODE_HYPERCORE_WSS_URL) },
    "twap-watcher idle — USE_REAL_QUICKNODE_TWAP is false or QUICKNODE_HYPERCORE_WSS_URL is unset; no market-wide TWAP data source configured",
  );
} else {
  const network = process.env["HYPERLIQUID_NETWORK"] === "testnet" ? "testnet" : "mainnet";

  // Own connection to Hyperliquid's own public allMids feed, independent of market-watcher's
  // (each worker process must not depend on another one's liveness) — used only to estimate
  // notional at TWAP activation (see mid-price-cache.ts doc comment).
  const midPrices = new MidPriceCache();
  const pricesClient = new HyperliquidWsClient({
    url: HYPERLIQUID_WS_URLS[network],
    logger: log.child({ source: "allMids" }),
  });
  pricesClient.on("allMids", midPrices.createAllMidsHandler(log));
  pricesClient.subscribe({ type: "allMids" });
  pricesClient.connect();

  async function handleTwapEvent(event: QuicknodeTwapEvent): Promise<void> {
    state.lastEventAt = Date.now();
    const { twap_id: twapId, status, state: order } = event;
    const side = sideFromHyperliquid(order.side);
    const executedNotionalUsd = Math.abs(Number(order.executedNtl));

    let notionalUsd: number;
    let estimatedNotionalUsd: string | undefined;
    if (status === "activated") {
      const midPrice = midPrices.get(order.coin);
      if (midPrice === undefined) {
        log.warn(
          { twapId, coin: order.coin },
          "no cached mid price yet for newly activated twap — skipping threshold check for this transition",
        );
        return;
      }
      const estimated = Math.abs(Number(order.sz)) * midPrice;
      notionalUsd = estimated;
      estimatedNotionalUsd = estimated.toString();
    } else {
      notionalUsd = executedNotionalUsd;
    }

    if (notionalUsd < env.TWAP_MIN_NOTIONAL_USD) return;

    const payload: MarketTwapPayload = {
      type: "market_twap",
      twapId,
      coin: order.coin,
      side,
      address: order.user.toLowerCase(),
      size: order.sz,
      executedSize: order.executedSz,
      executedNotionalUsd: order.executedNtl,
      ...(estimatedNotionalUsd !== undefined && { estimatedNotionalUsd }),
      minutes: order.minutes,
      reduceOnly: order.reduceOnly,
      randomize: order.randomize,
      status,
    };

    const occurredAt = order.timestamp ? new Date(order.timestamp) : new Date();
    const newEvent: Omit<NewEvent, "id" | "createdAt"> = {
      type: "market_twap",
      walletAddress: null,
      coin: order.coin,
      side,
      amountUsd: notionalUsd.toString(),
      payload,
      occurredAt,
      externalId: `market-twap:${twapId}:${status}`,
    };

    try {
      await publishEvent(db, newEvent);
    } catch (err) {
      log.error({ err, twapId, status }, "failed to publish market twap event");
    }
  }

  const source = new QuicknodeTwapSource({
    url: env.QUICKNODE_HYPERCORE_WSS_URL,
    logger: log,
    onEvent: (event) => {
      void handleTwapEvent(event).catch((err: unknown) => {
        log.error({ err }, "unhandled error processing quicknode twap event");
      });
    },
    onOpen: () => {
      state.isHealthy = true;
      state.lastEventAt = Date.now();
    },
    onClose: () => {
      state.isHealthy = false;
    },
  });
  source.connect();

  log.info(
    { network, minNotionalUsd: env.TWAP_MIN_NOTIONAL_USD, heartbeatPort: env.HEARTBEAT_PORT },
    "twap-watcher started",
  );
}
