import type { TwapTier } from "@hypertracker/shared";
import { Decimal, money } from "./money.js";

export interface TierBaseConfig {
  tier: TwapTier;
  baseCoin: string;
  // Decimal strings — money (CLAUDE.md). baseWindowMinutes stays `number`, it's a duration.
  // Spec §2 (CLAUDE.md): ZEC >= $500,000/5min for Tier A, ARB/UNI-class >= $300,000/5min for
  // Tier B.
  baseThresholdUsd: string;
  baseWindowMinutes: number;
  // dayNtlVlm (24h notional volume) of the tier's base coin — refreshed periodically from
  // Hyperliquid's metaAndAssetCtxs by the caller. This module does no I/O.
  baseDayNtlVlm: string;
}

// CALIBRATION PLACEHOLDER (CLAUDE.md spec §2, open question #1 — "threshold normalization
// formula", NOT resolved by the customer as of 2026-09-22). Scales a tier's base USD
// threshold by this coin's share of the base coin's 24h notional volume, dampened by
// `volumeExponent` so a coin with e.g. 4x the base coin's volume doesn't get a literal 4x
// threshold. exponent=1 -> linear scaling; exponent=0 -> every coin in the tier gets the same
// threshold (ignores volume entirely). 0.5 (sqrt) is a starting default, not a calibrated
// value — revisit with backtest data before relying on it.
export interface ThresholdNormalizationConfig {
  // Dimensionless exponent, not money — stays `number`.
  volumeExponent: number;
  // Never let a derived threshold fall below Hyperliquid's own order minimum (source:
  // hyperliquid-docs MCP, verified 2026-09-20: "Order must have minimum value of $10.") — a
  // threshold under a level that can never be a real order isn't a meaningful floor. Set
  // above HL's literal $10 as a sanity margin.
  minThresholdUsd: string;
}

export const DEFAULT_THRESHOLD_NORMALIZATION: ThresholdNormalizationConfig = {
  volumeExponent: 0.5,
  minThresholdUsd: "100",
};

export interface TierThresholdInput {
  base: TierBaseConfig;
  coinDayNtlVlm: string;
}

export function computeTierThresholdUsd(
  input: TierThresholdInput,
  config: ThresholdNormalizationConfig = DEFAULT_THRESHOLD_NORMALIZATION,
): string {
  const { base, coinDayNtlVlm } = input;
  const baseDayNtlVlm = money(base.baseDayNtlVlm);
  if (baseDayNtlVlm.lte(0)) {
    throw new Error("computeTierThresholdUsd: base.baseDayNtlVlm must be positive");
  }
  const minThresholdUsd = money(config.minThresholdUsd);
  const coinVlm = money(coinDayNtlVlm);
  if (coinVlm.lte(0)) {
    // An illiquid/unlisted coin never clears any real threshold below the tier's own base —
    // return the base threshold rather than dividing by (or by near-)zero.
    return Decimal.max(money(base.baseThresholdUsd), minThresholdUsd).toString();
  }
  const ratio = coinVlm.dividedBy(baseDayNtlVlm);
  // ratio is always positive here (both operands are positive), so decimal.js's generalized
  // pow (fractional exponent via ln/exp) applies cleanly — see decimal.js docs on Decimal.pow.
  const scaled = money(base.baseThresholdUsd).times(ratio.pow(config.volumeExponent));
  return Decimal.max(scaled, minThresholdUsd).toString();
}

// Interpretation choice, not stated explicitly in the spec text (flagged for confirmation):
// "$500,000 over 5 minutes" is read as an INTENSITY threshold ($/5min-equivalent rate), not a
// flat notional cutoff — a $500k TWAP compressed into 5 minutes is far more aggressive market
// pressure than the same $500k spread over Hyperliquid's max 7-day TWAP window (source:
// hyperliquid-docs MCP "Order types", verified 2026-09-20). Every incoming signal's actual
// notional is rescaled to what it would be at the tier's baseWindowMinutes before comparing
// against the threshold.
export function normalizeToBaseWindow(
  notionalUsd: string,
  actualDurationMinutes: number,
  baseWindowMinutes: number,
): string {
  if (actualDurationMinutes <= 0) {
    throw new Error("normalizeToBaseWindow: actualDurationMinutes must be positive");
  }
  return money(notionalUsd).dividedBy(actualDurationMinutes).times(baseWindowMinutes).toString();
}

export interface TierEvaluationResult {
  passesThreshold: boolean;
  thresholdUsd: string;
  normalizedNotionalUsd: string;
}

export function evaluateTierTrigger(
  actualNotionalUsd: string,
  actualDurationMinutes: number,
  input: TierThresholdInput,
  config: ThresholdNormalizationConfig = DEFAULT_THRESHOLD_NORMALIZATION,
): TierEvaluationResult {
  const thresholdUsd = computeTierThresholdUsd(input, config);
  const normalizedNotionalUsd = normalizeToBaseWindow(
    actualNotionalUsd,
    actualDurationMinutes,
    input.base.baseWindowMinutes,
  );
  return {
    passesThreshold: money(normalizedNotionalUsd).gte(money(thresholdUsd)),
    thresholdUsd,
    normalizedNotionalUsd,
  };
}
