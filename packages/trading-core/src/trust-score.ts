import type { TrustScoreEventType } from "@hypertracker/shared";

export interface TrustScoreEvent {
  type: TrustScoreEventType;
  occurredAt: Date;
}

// CALIBRATION PLACEHOLDER (CLAUDE.md spec §3, open question #2 — score scale, per-event
// deltas, decay half-life, and the score->size-multiplier mapping are all starting defaults,
// NOT resolved/calibrated as of 2026-09-22).
export interface TrustScoreConfig {
  scoreMin: number;
  scoreMax: number;
  deltaFullyExecuted: number;
  // Spec: "cancelled before first execution" -> "large penalty".
  deltaCancelledBeforeExecution: number;
  // Spec: "cancelled mid-execution" -> penalty smaller than a full pre-execution cancel.
  deltaCancelledMidExecution: number;
  // Spec: "two or more cancellations (cumulative): additional decrease". Applied as an extra
  // multiplier on top of the per-event deltas below once this many cancellation-type events
  // (cancelled_before_execution or cancelled_mid_execution) appear in the passed-in history —
  // not modeled as its own event type, to keep the insert-only event log (packages/db
  // trust-score-events) a plain record of what actually happened.
  repeatCancellationCountThreshold: number;
  repeatCancellationExtraPenaltyMultiplier: number;
  // Exponential decay half-life in days — an event's contribution to the live score halves
  // every this many days. Spec calls for "a decay formula for old events over time" but gives
  // no half-life.
  decayHalfLifeDays: number;
}

export const DEFAULT_TRUST_SCORE_CONFIG: TrustScoreConfig = {
  scoreMin: -100,
  scoreMax: 100,
  deltaFullyExecuted: 10,
  deltaCancelledBeforeExecution: -30,
  deltaCancelledMidExecution: -15,
  repeatCancellationCountThreshold: 2,
  repeatCancellationExtraPenaltyMultiplier: 1.5,
  decayHalfLifeDays: 30,
};

function isCancellation(type: TrustScoreEventType): boolean {
  return type === "cancelled_before_execution" || type === "cancelled_mid_execution";
}

function deltaFor(type: TrustScoreEventType, config: TrustScoreConfig): number {
  switch (type) {
    case "fully_executed":
      return config.deltaFullyExecuted;
    case "cancelled_before_execution":
      return config.deltaCancelledBeforeExecution;
    case "cancelled_mid_execution":
      return config.deltaCancelledMidExecution;
  }
}

// Pure — the caller (apps/worker/src/auto-trader) reads a wallet's insert-only event log from
// packages/db (trust-score-events) and passes it in here; this module never touches the
// database, matching trading-core's no-I/O rule.
export function computeTrustScore(
  events: readonly TrustScoreEvent[],
  now: Date,
  config: TrustScoreConfig = DEFAULT_TRUST_SCORE_CONFIG,
): number {
  const decayLambda = Math.log(2) / config.decayHalfLifeDays;
  const cancellationCount = events.filter((event) => isCancellation(event.type)).length;
  const repeatPenalty =
    cancellationCount >= config.repeatCancellationCountThreshold
      ? config.repeatCancellationExtraPenaltyMultiplier
      : 1;

  let raw = 0;
  for (const event of events) {
    const ageDays = (now.getTime() - event.occurredAt.getTime()) / 86_400_000;
    if (ageDays < 0) continue; // clock skew / future timestamp — never let it inflate the score
    const decayFactor = Math.exp(-decayLambda * ageDays);
    let delta = deltaFor(event.type, config) * decayFactor;
    if (isCancellation(event.type)) delta *= repeatPenalty;
    raw += delta;
  }

  return Math.min(config.scoreMax, Math.max(config.scoreMin, raw));
}

export interface SizeMultiplierConfig {
  minMultiplier: number;
  maxMultiplier: number;
}

// Symmetric around 1.0 by default (0.5..1.5) so a brand-new, never-scored wallet (score 0)
// lands exactly at neutral sizing — see scoreToSizeMultiplier's doc comment.
export const DEFAULT_SIZE_MULTIPLIER_CONFIG: SizeMultiplierConfig = {
  minMultiplier: 0.5,
  maxMultiplier: 1.5,
};

// CALIBRATION PLACEHOLDER (spec §3's "score -> size-multiplier formula", open). Linear map
// from [scoreMin, scoreMax] to [minMultiplier, maxMultiplier]. With the default symmetric
// multiplier range, score 0 (a wallet with no scoring history yet) maps to 1.0 — neither
// boosted nor penalized until it has a track record.
export function scoreToSizeMultiplier(
  score: number,
  trustConfig: TrustScoreConfig = DEFAULT_TRUST_SCORE_CONFIG,
  multiplierConfig: SizeMultiplierConfig = DEFAULT_SIZE_MULTIPLIER_CONFIG,
): number {
  const clamped = Math.min(trustConfig.scoreMax, Math.max(trustConfig.scoreMin, score));
  const t = (clamped - trustConfig.scoreMin) / (trustConfig.scoreMax - trustConfig.scoreMin);
  return (
    multiplierConfig.minMultiplier +
    t * (multiplierConfig.maxMultiplier - multiplierConfig.minMultiplier)
  );
}

// --- Manipulation defense (added 2026-09-22, in response to a scenario-based review of the
// two functions above — see CLAUDE.md's TWAP auto-trading section for the empirical findings
// that motivated this). Scored-but-unconfirmed finding: computeTrustScore alone reaches
// scoreMax with as few as 10 SAME-DAY fully_executed events (verified by direct scenario
// run) — a wallet could cheaply mass-submit small TWAPs in one burst to buy max trust, then
// exploit the resulting 1.5x size boost on one real, misleading signal. This section adds a
// CONFIDENCE factor that requires real TENURE (calendar time observed) and VOLUME (distinct
// events), not just a raw score, before a wallet can earn a sizing BOOST above neutral.

// CALIBRATION PLACEHOLDER, same status as TrustScoreConfig above — not customer-confirmed,
// but principled: maturityDays/minEventsForFullConfidence share decayHalfLifeDays' ~30-day
// scale (both are "how long is a meaningful track record" judgments), verified by scenario
// run to fully close the same-day-burst exploit (10 same-day execs -> confidence 0 -> stays
// at neutral 1.0x, not 1.5x) while still letting a genuine 90-day/30-signal history reach
// full confidence.
export interface ConfidenceConfig {
  maturityDays: number;
  minEventsForFullConfidence: number;
}

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  maturityDays: 45,
  minEventsForFullConfidence: 8,
};

// Tenure confidence: fraction of maturityDays actually observed (earliest event to now).
// Volume confidence: fraction of minEventsForFullConfidence actually seen. Both must be
// satisfied — a wallet observed for a long time but rarely, or observed often but only
// briefly, gets partial confidence either way. 0 for a wallet with no events at all (the
// caller should never need this case: scoreToSizeMultiplier(0) is already neutral 1.0x
// without calling this).
export function computeConfidence(
  events: readonly TrustScoreEvent[],
  now: Date,
  config: ConfidenceConfig = DEFAULT_CONFIDENCE_CONFIG,
): number {
  if (events.length === 0) return 0;
  let earliest = events[0]!.occurredAt;
  for (const event of events) if (event.occurredAt < earliest) earliest = event.occurredAt;

  const historyDays = Math.max(0, (now.getTime() - earliest.getTime()) / 86_400_000);
  const tenureConfidence = Math.min(1, historyDays / config.maturityDays);
  const volumeConfidence = Math.min(1, events.length / config.minEventsForFullConfidence);
  return tenureConfidence * volumeConfidence;
}

// CALIBRATION PLACEHOLDER, NOT in the original spec — an addition on top of it, flagged
// explicitly for customer sign-off (spec §3 only ever says "enter with deliberately smaller
// size", never "stop following entirely"). -90 (close to, but short of, the -100 floor) means
// only a wallet whose CONFIDENT, undamped-by-tenure negative score is severe and sustained
// gets fully skipped — not merely downsized. To disable blocking outright and match the
// spec's literal text (shrink only, never skip), set blockThreshold to
// Number.NEGATIVE_INFINITY.
export interface BlockConfig {
  blockThreshold: number;
}

export const DEFAULT_BLOCK_CONFIG: BlockConfig = { blockThreshold: -90 };

export interface WalletTrustEvaluation {
  rawScore: number;
  confidence: number;
  effectiveScore: number;
  sizeMultiplier: number;
  blocked: boolean;
}

// The actual entry point apps/worker/src/auto-trader's trigger-pipeline uses — combines
// computeTrustScore + computeConfidence + scoreToSizeMultiplier with the asymmetric rule
// that makes this a manipulation defense rather than just a smoothing function:
//
//   effectiveScore = rawScore >= 0 ? rawScore * confidence : rawScore
//
// Confidence dampens the UPSIDE only. A wallet cannot buy a boosted multiplier with a burst
// of cheap same-day signals (confidence ~0 for a brand-new wallet regardless of event count
// or raw score) — but a genuinely bad pattern is punished at full strength immediately, with
// no "grace period" a bad actor could hide behind. This asymmetry is deliberate: a false
// positive (trusting a bad actor) risks real capital; a false negative (being slow to reward
// a good one) only costs missed upside.
export function evaluateWalletTrust(
  events: readonly TrustScoreEvent[],
  now: Date,
  trustConfig: TrustScoreConfig = DEFAULT_TRUST_SCORE_CONFIG,
  confidenceConfig: ConfidenceConfig = DEFAULT_CONFIDENCE_CONFIG,
  multiplierConfig: SizeMultiplierConfig = DEFAULT_SIZE_MULTIPLIER_CONFIG,
  blockConfig: BlockConfig = DEFAULT_BLOCK_CONFIG,
): WalletTrustEvaluation {
  const rawScore = computeTrustScore(events, now, trustConfig);
  const confidence = computeConfidence(events, now, confidenceConfig);
  const effectiveScore = rawScore >= 0 ? rawScore * confidence : rawScore;
  const blocked = effectiveScore <= blockConfig.blockThreshold;
  const sizeMultiplier = blocked
    ? 0
    : scoreToSizeMultiplier(effectiveScore, trustConfig, multiplierConfig);
  return { rawScore, confidence, effectiveScore, sizeMultiplier, blocked };
}
