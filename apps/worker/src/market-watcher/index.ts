import { createDb, type NewEvent } from "@hypertracker/db";
import {
  HYPERLIQUID_REST_URLS,
  HYPERLIQUID_WS_URLS,
  HyperliquidWsClient,
} from "@hypertracker/hyperliquid-sdk";
import type { MarketTwapSuspectedPayload } from "@hypertracker/shared";
import { createMarketWatcherEnv } from "../shared/env.js";
import { startHeartbeatServer, type HeartbeatState } from "../shared/heartbeat.js";
import { createLogger } from "../shared/logger.js";
import { publishEvent } from "../shared/publish-event.js";
import { RecentIdDedup } from "./dedup.js";
import { createAllMidsHandler } from "./handlers/all-mids.js";
import { createTradesHandler } from "./handlers/trades.js";
import { SubscriptionManager } from "./subscription-manager.js";
import { ActiveTwapTracker } from "./twap-active.js";
import { identifyTwapId, pollTwapId } from "./twap-confirm.js";
import { DEFAULT_TWAP_HEURISTIC_PARAMS, TwapPatternDetector } from "./twap-heuristic.js";

const WORKER_ID = "market-watcher";
const REFRESH_INTERVAL_MS = 15_000;

// getUserTwapSliceFills has weight 20 (+ extra per 20 items returned) against the 1200/min
// per-IP REST weight budget, shared with every other worker on this VM's IP — so confirmation
// gets its own slower interval, decoupled from REFRESH_INTERVAL_MS, and each tick only spends
// a bounded slice of that budget. source: hyperliquid-docs MCP (rate-limits-and-user-limits),
// verified: 2026-08-22.
const TWAP_FLUSH_INTERVAL_MS = 60_000;
const MAX_TWAP_CONFIRMATIONS_PER_TICK = 10;

// A separate REST budget from MAX_TWAP_CONFIRMATIONS_PER_TICK (same 60s tick, same weight-20
// endpoint, same shared 1200/min IP budget) — rechecking already-identified TWAPs must not
// starve discovery of brand-new candidates, or vice versa, so each gets its own bounded slice.
const MAX_TWAP_ACTIVE_RECHECKS_PER_TICK = 10;

// How long a known-real twapId can go without a new matching slice fill before it's treated as
// finished and published at its accumulated total. Not a documented Hyperliquid constant — the
// Order types page only gives the suborder cadence bounds this is derived from: suborders as
// frequent as every 30s for large/short orders down to ~6min for the smallest/longest ones
// (e.g. a $10k/4-day TWAP sends roughly every 6 minutes). This grace period is set well above
// that slowest documented cadence so a genuinely still-running TWAP isn't finalized mid-stride.
const TWAP_COMPLETION_GRACE_MS = 15 * 60_000;

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
const activeTwaps = new ActiveTwapTracker();

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

// Two-phase, on the same tick:
//
// Phase 1 — discovery: offers every streak that currently clears the heuristic thresholds and
// hasn't been reported yet (see twap-heuristic.ts collectCandidates() doc comment — this runs
// as soon as a streak first qualifies, not once its series ends) and REST-identifies which real
// Hyperliquid twapId, if any, it corresponds to. A candidate that doesn't identify is left
// alone to be re-offered on a later tick, until it either identifies or the streak goes stale
// and is silently dropped. Only MAX_TWAP_CONFIRMATIONS_PER_TICK candidates are checked per tick
// — active trading can produce far more qualifying streaks than the REST weight budget allows
// checking in one go. collectCandidates itself picks which ones (least-recently-offered first —
// sorting by notional instead would starve real TWAPs behind noisy long-running bot streaks).
//
// Phase 2 — tracking: once a twapId is identified it is NOT published immediately — a
// heuristic streak typically clears the threshold within the order's first few suborders, long
// before a large/long-running TWAP is anywhere near done, so publishing then would report only
// a small fraction of the real order (this starved real $100k+ TWAPs behind their own opening
// slices — see the 2026-08-23 incident). Instead the twapId is tracked in `activeTwaps` and
// re-polled (unbounded by any time window, unlike phase 1's identification) until no new
// matching slice fill has appeared for TWAP_COMPLETION_GRACE_MS, at which point it's published
// once at its true accumulated total.
async function flushTwapDetector(): Promise<void> {
  const now = Date.now();

  const candidates = twapDetector.collectCandidates(now, MAX_TWAP_CONFIRMATIONS_PER_TICK);
  for (const candidate of candidates) {
    try {
      const result = await identifyTwapId(HYPERLIQUID_REST_URLS[network], candidate, log);
      if (result.status === "not_yet") continue;

      twapDetector.markReported(candidate.coin, candidate.address, candidate.side);
      if (activeTwaps.has(result.twapId)) continue;

      activeTwaps.start(
        {
          twapId: result.twapId,
          address: candidate.address,
          coin: candidate.coin,
          side: candidate.side,
          notionalUsd: Number(candidate.notionalUsd),
          avgPrice: Number(candidate.avgPrice),
          occurrences: candidate.occurrences,
          firstSeenAt: candidate.firstSeenAt,
          lastSeenAt: result.lastFillTime,
        },
        now,
      );
    } catch (err) {
      log.error(
        { err, coin: candidate.coin, address: candidate.address },
        "failed to identify twapId for market_twap_suspected candidate",
      );
    }
  }

  const due = activeTwaps.collectDue(MAX_TWAP_ACTIVE_RECHECKS_PER_TICK);
  for (const entry of due) {
    try {
      const update = await pollTwapId(
        HYPERLIQUID_REST_URLS[network],
        entry.address,
        entry.twapId,
        log,
      );
      if (update) activeTwaps.applyUpdate(entry.twapId, update, now);
      if (!activeTwaps.isFinished(entry.twapId, now, TWAP_COMPLETION_GRACE_MS)) continue;

      const final = activeTwaps.remove(entry.twapId);
      if (!final) continue;

      const payload: MarketTwapSuspectedPayload = {
        type: "market_twap_suspected",
        coin: final.coin,
        side: final.side,
        address: final.address,
        notionalUsd: final.notionalUsd.toString(),
        avgPrice: final.avgPrice.toString(),
        occurrences: final.occurrences,
        firstSeenAt: final.firstSeenAt,
        lastSeenAt: final.lastSeenAt,
        twapId: final.twapId,
      };
      const event: Omit<NewEvent, "id" | "createdAt"> = {
        type: "market_twap_suspected",
        walletAddress: null,
        coin: payload.coin,
        side: payload.side,
        amountUsd: payload.notionalUsd,
        payload,
        occurredAt: new Date(payload.lastSeenAt),
        externalId: `twap-confirmed:${payload.twapId}`,
      };
      await publishEvent(db, event);
    } catch (err) {
      log.error(
        { err, twapId: entry.twapId, address: entry.address },
        "failed to poll/finalize active twap",
      );
    }
  }
}
setInterval(() => void flushTwapDetector(), TWAP_FLUSH_INTERVAL_MS);

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
