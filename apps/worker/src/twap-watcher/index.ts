import { createDb, type NewEvent } from "@hypertracker/db";
import type { MarketTwapPayload } from "@hypertracker/shared";
import { createTwapWatcherEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { publishEvent } from "../shared/publish-event.js";
import { MidPriceCache } from "./mid-price-cache.js";
import { QuicknodeTwapSource } from "./sources/quicknode-twap-source.js";
import { RECOGNIZED_TWAP_STATUSES, type QuicknodeTwapEvent } from "./quicknode-schemas.js";
import { SpotNameCache } from "./spot-name-cache.js";

const WORKER_ID = "twap-watcher";

// Same "B"/"A" convention as every other Hyperliquid fill/state side field this project
// parses (see apps/worker/src/wallet-watcher/classify.ts's fillSide) — QuickNode's TWAP
// `state` object mirrors Hyperliquid's own native TWAP state verbatim (see
// quicknode-schemas.ts doc comment).
function sideFromHyperliquid(side: string): "buy" | "sell" {
  return side === "B" ? "buy" : "sell";
}

// packages/shared marketTwapPayloadSchema only persists these three. "activated" opens a row
// in the web table; every other status that carries real execution is an end-of-life update.
function toPayloadStatus(status: string): "activated" | "finished" | "terminated" {
  if (status === "activated") return "activated";
  if (status === "finished") return "finished";
  return "terminated";
}

// How stale a REST allMids snapshot may be before it's treated as "no price" at activation.
// The cache polls every 3s, so anything past this means polling itself is failing.
const MAX_MID_AGE_MS = 30_000;

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

  // Mid prices via Hyperliquid's REST allMids (polled), NOT a second allMids WS — a duplicate
  // allMids subscription from the same IP as market-watcher's was observed in prod to get
  // dropped within seconds, repeatedly, which starved this worker of activation prices (see
  // mid-price-cache.ts).
  const midPrices = new MidPriceCache(network, log.child({ source: "allMids-rest" }));
  midPrices.start();

  // Classifies each TWAP's coin as perp/spot and resolves spot ids ("@107") to a readable
  // pair ("HYPE/USDC") off Hyperliquid's spotMeta. Spot TWAPs used to be dropped outright.
  const spotNames = new SpotNameCache(network, log.child({ source: "spotMeta" }));
  spotNames.start();

  async function handleTwapEvent(event: QuicknodeTwapEvent): Promise<void> {
    state.lastEventAt = Date.now();
    const { twap_id: twapId, status, state: order } = event;

    // The order failed to ever place (e.g. insufficient margin) — see quicknode-schemas.ts
    // doc comment. Nothing opened and nothing executed, so there's nothing worth a row for.
    if (status === "error" || status === "waitingForTrigger") {
      log.debug({ twapId, coin: order.coin, status }, "twap order not yet live — skipping");
      return;
    }

    // A status string outside everything we've seen from QuickNode so far. Don't drop it
    // silently — log the raw value (so a vocabulary change is visible in prod immediately),
    // then fall through only if it carries real execution, treated as a terminal update.
    if (!RECOGNIZED_TWAP_STATUSES.has(status)) {
      const executed = Math.abs(Number(order.executedNtl));
      if (!Number.isFinite(executed) || executed === 0) {
        log.warn(
          { twapId, coin: order.coin, status },
          "unrecognized quicknode twap status with nothing executed — skipping",
        );
        return;
      }
      log.warn(
        { twapId, coin: order.coin, status, executedNtl: order.executedNtl },
        "unrecognized quicknode twap status — publishing as a terminal update",
      );
    }

    const resolved = spotNames.resolve(order.coin);
    if (!resolved) {
      log.debug(
        { twapId, coin: order.coin },
        "twap on an unhandled market (outcome asset) — skipping",
      );
      return;
    }

    // Builder-deployed perp ("{dex}:{coin}") — start polling that dex's mids so the next
    // transition (and ideally this one) can be priced. Its prices are never in the main dex.
    // Spot ("@107" / "PURR/USDC") mids ride the main-dex allMids response already.
    const colon = order.coin.indexOf(":");
    if (colon !== -1) midPrices.ensureDex(order.coin.slice(0, colon));

    const side = sideFromHyperliquid(order.side);
    const executedNotionalUsd = Math.abs(Number(order.executedNtl));

    let notionalUsd: number;
    let estimatedNotionalUsd: string | undefined;
    if (status === "activated") {
      const mid = midPrices.get(order.coin);
      if (mid !== undefined && mid.ageMs <= MAX_MID_AGE_MS) {
        const estimated = Math.abs(Number(order.sz)) * mid.price;
        notionalUsd = estimated;
        estimatedNotionalUsd = estimated.toString();
      } else {
        // No fresh mid — a HIP-3 dex we've only just started polling, or the REST poll is
        // failing. Do NOT silently drop the open like the old WS-cache path did: publish it
        // at the base threshold (so it still reaches subscribers) with no $ estimate. The
        // follow-up finished/terminated event carries the real executed notional.
        log.warn(
          { twapId, coin: order.coin, hadStalePrice: mid !== undefined },
          "no fresh mid price for activated twap — publishing the open at base threshold, no estimate",
        );
        notionalUsd = env.TWAP_MIN_NOTIONAL_USD;
      }
    } else {
      notionalUsd = executedNotionalUsd;
    }

    if (notionalUsd < env.TWAP_MIN_NOTIONAL_USD) return;

    const payload: MarketTwapPayload = {
      type: "market_twap",
      twapId,
      coin: order.coin,
      market: resolved.market,
      displayCoin: resolved.displayCoin,
      side,
      address: order.user.toLowerCase(),
      size: order.sz,
      executedSize: order.executedSz,
      executedNotionalUsd: order.executedNtl,
      ...(estimatedNotionalUsd !== undefined && { estimatedNotionalUsd }),
      minutes: order.minutes,
      reduceOnly: order.reduceOnly,
      randomize: order.randomize,
      status: toPayloadStatus(status),
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
    // Every frame (mostly empty blocks) keeps the heartbeat's staleness clock fresh — TWAP
    // transitions are far too sporadic to use as the liveness signal, so before this the
    // heartbeat went stale within 60s of a working connection. Now a stale timestamp means
    // the feed itself stopped, which is the thing worth alerting on.
    onFrame: () => {
      state.lastEventAt = Date.now();
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
