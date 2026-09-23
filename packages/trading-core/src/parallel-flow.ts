import type { z } from "zod";
import type { tradeSide } from "@hypertracker/shared";
import { Decimal, money } from "./money.js";

// One TWAP currently considered "active" for the parallel-flow aggregator (CLAUDE.md spec
// §7). Built by apps/worker/src/auto-trader from the raw, UNFILTERED SignalSource stream —
// added on "activated", removed on "finished"/"stopped"/"terminated"/"error". Must be
// persisted across restarts by the caller (trading-core does no I/O): the QuickNode TWAP
// dataset is forward-only with no snapshot on (re)subscribe (packages/hyperliquid-sdk notes),
// so a cold worker restart otherwise loses every currently-active TWAP until fresh events
// repopulate it.
export interface ActiveTwap {
  externalId: string;
  coin: string;
  side: z.infer<typeof tradeSide>;
  // Decimal string — money (CLAUDE.md).
  notionalUsd: string;
  activatedAt: Date;
  // reduceOnly TWAPs close an existing position rather than express fresh directional
  // intent — per CLAUDE.md's 2026-09-22 decision they are NOT trigger candidates but ARE
  // counted here, since their volume is still real market pressure on the coin.
  reduceOnly: boolean;
}

export interface NetFlow {
  buyNotionalUsd: string;
  sellNotionalUsd: string;
  // buyNotionalUsd - sellNotionalUsd; positive = net buy pressure.
  netFlowUsd: string;
}

// Sums notional of every ActiveTwap on `coin` — i.e. every TWAP that hasn't reached a
// terminal status yet (activeTwaps is already exactly that set, built by the caller from
// "activated" through finished/stopped/terminated/error — see ActiveTwap's own doc comment).
// Spec §7's own worked example (10 sixty-minute buy-TWAPs started 12-20 minutes ago, still
// executing) must count as pressure — a TWAP being "active" already means "still running,"
// regardless of when it started. A prior version filtered by activatedAt falling inside a
// recent "sliding window," which excluded exactly that worked example (code-review,
// 2026-09-23) — removed rather than kept as a second, redundant staleness filter (the tracker
// already has its own eviction sweep for genuinely stale/leaked entries, see
// ActiveTwapTracker.all()).
export function computeNetFlow(activeTwaps: readonly ActiveTwap[], coin: string): NetFlow {
  let buyNotionalUsd = new Decimal(0);
  let sellNotionalUsd = new Decimal(0);
  for (const twap of activeTwaps) {
    if (twap.coin !== coin) continue;
    if (twap.side === "buy") buyNotionalUsd = buyNotionalUsd.plus(twap.notionalUsd);
    else sellNotionalUsd = sellNotionalUsd.plus(twap.notionalUsd);
  }
  return {
    buyNotionalUsd: buyNotionalUsd.toString(),
    sellNotionalUsd: sellNotionalUsd.toString(),
    netFlowUsd: buyNotionalUsd.minus(sellNotionalUsd).toString(),
  };
}

// CALIBRATION PLACEHOLDER (CLAUDE.md spec §7, open question #4 — "counter-flow ->
// size/decision formula", NOT resolved as of 2026-09-22). skipRatio=1.0 matches the spec's
// own worked example ("their combined volume exceeds the trigger signal's volume" ->
// skip/reduce/downweight).
export interface CounterFlowConfig {
  // Dimensionless ratios/multipliers, not money — stay `number`.
  // counterVolume/triggerVolume ratio at/above which the trigger is skipped entirely.
  skipRatio: number;
  // ratio at/above which size starts being linearly reduced (below this, no adjustment).
  reduceStartRatio: number;
  // multiplier at the point just before skipRatio — floor of the linear ramp between
  // reduceStartRatio and skipRatio.
  minMultiplierBeforeSkip: number;
}

export const DEFAULT_COUNTER_FLOW_CONFIG: CounterFlowConfig = {
  skipRatio: 1.0,
  reduceStartRatio: 0.3,
  minMultiplierBeforeSkip: 0.25,
};

export interface CounterFlowAdjustment {
  skip: boolean;
  // 1.0 when no adjustment applies; 0 when skip is true. Dimensionless — stays `number`.
  sizeMultiplier: number;
}

// `triggerSide` is the trigger signal's own side; counter-flow is whatever sits on the
// OPPOSITE side of the aggregated window (a sell-TWAP trigger is opposed by buy-side net
// flow — spec §7's worked example: a sell trigger opposed by parallel buy-TWAPs).
export function computeCounterFlowAdjustment(
  triggerSide: z.infer<typeof tradeSide>,
  triggerNotionalUsd: string,
  netFlow: NetFlow,
  config: CounterFlowConfig = DEFAULT_COUNTER_FLOW_CONFIG,
): CounterFlowAdjustment {
  const triggerNotional = money(triggerNotionalUsd);
  if (triggerNotional.lte(0)) {
    throw new Error("computeCounterFlowAdjustment: triggerNotionalUsd must be positive");
  }
  const counterNotionalUsd =
    triggerSide === "buy" ? netFlow.sellNotionalUsd : netFlow.buyNotionalUsd;
  // The ratio itself is dimensionless (money/money) — safe to drop to `number` here, feeding
  // the rest of this function's plain-number linear interpolation.
  const ratio = money(counterNotionalUsd).dividedBy(triggerNotional).toNumber();

  if (ratio >= config.skipRatio) {
    return { skip: true, sizeMultiplier: 0 };
  }
  if (ratio <= config.reduceStartRatio) {
    return { skip: false, sizeMultiplier: 1 };
  }
  const t = (ratio - config.reduceStartRatio) / (config.skipRatio - config.reduceStartRatio);
  return { skip: false, sizeMultiplier: 1 - t * (1 - config.minMultiplierBeforeSkip) };
}
