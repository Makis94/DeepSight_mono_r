import { describe, expect, it } from "vitest";
import {
  computeConfidence,
  computeTrustScore,
  DEFAULT_BLOCK_CONFIG,
  DEFAULT_CONFIDENCE_CONFIG,
  DEFAULT_TRUST_SCORE_CONFIG,
  evaluateWalletTrust,
  scoreToSizeMultiplier,
  type TrustScoreEvent,
} from "./trust-score.js";

const NOW = new Date("2026-09-22T00:00:00.000Z");

describe("computeTrustScore", () => {
  it("returns 0 for a wallet with no history", () => {
    expect(computeTrustScore([], NOW)).toBe(0);
  });

  it("rewards a fully executed TWAP with a positive score", () => {
    const events: TrustScoreEvent[] = [{ type: "fully_executed", occurredAt: NOW }];
    expect(computeTrustScore(events, NOW)).toBeCloseTo(
      DEFAULT_TRUST_SCORE_CONFIG.deltaFullyExecuted,
      5,
    );
  });

  it("penalizes a pre-execution cancel harder than a mid-execution one", () => {
    const before = computeTrustScore(
      [{ type: "cancelled_before_execution", occurredAt: NOW }],
      NOW,
    );
    const mid = computeTrustScore([{ type: "cancelled_mid_execution", occurredAt: NOW }], NOW);
    expect(before).toBeLessThan(mid);
  });

  it("applies the repeat-cancellation penalty once the threshold is hit", () => {
    const oneCancel = computeTrustScore(
      [{ type: "cancelled_mid_execution", occurredAt: NOW }],
      NOW,
    );
    const twoCancels = computeTrustScore(
      [
        { type: "cancelled_mid_execution", occurredAt: NOW },
        { type: "cancelled_mid_execution", occurredAt: NOW },
      ],
      NOW,
    );
    // Two cancels should be worse than simply double the single-cancel penalty, because of
    // the extra repeat multiplier.
    expect(twoCancels).toBeLessThan(oneCancel * 2);
  });

  it("decays an old event's contribution toward zero", () => {
    const fresh = computeTrustScore([{ type: "fully_executed", occurredAt: NOW }], NOW);
    const halfLifeAgo = new Date(
      NOW.getTime() - DEFAULT_TRUST_SCORE_CONFIG.decayHalfLifeDays * 86_400_000,
    );
    const decayed = computeTrustScore([{ type: "fully_executed", occurredAt: halfLifeAgo }], NOW);
    expect(decayed).toBeCloseTo(fresh / 2, 1);
  });

  it("ignores events timestamped in the future", () => {
    const future = new Date(NOW.getTime() + 86_400_000);
    expect(computeTrustScore([{ type: "fully_executed", occurredAt: future }], NOW)).toBe(0);
  });

  it("clamps to scoreMax/scoreMin", () => {
    const manyGoodEvents: TrustScoreEvent[] = Array.from({ length: 50 }, () => ({
      type: "fully_executed" as const,
      occurredAt: NOW,
    }));
    expect(computeTrustScore(manyGoodEvents, NOW)).toBe(DEFAULT_TRUST_SCORE_CONFIG.scoreMax);
  });
});

describe("scoreToSizeMultiplier", () => {
  it("maps a neutral score (0) to exactly 1.0 with the default symmetric range", () => {
    expect(scoreToSizeMultiplier(0)).toBe(1);
  });

  it("maps scoreMax to the configured max multiplier", () => {
    expect(scoreToSizeMultiplier(DEFAULT_TRUST_SCORE_CONFIG.scoreMax)).toBeCloseTo(1.5, 5);
  });

  it("maps scoreMin to the configured min multiplier", () => {
    expect(scoreToSizeMultiplier(DEFAULT_TRUST_SCORE_CONFIG.scoreMin)).toBeCloseTo(0.5, 5);
  });

  it("clamps out-of-range scores instead of extrapolating", () => {
    expect(scoreToSizeMultiplier(1_000)).toBeCloseTo(1.5, 5);
    expect(scoreToSizeMultiplier(-1_000)).toBeCloseTo(0.5, 5);
  });
});

describe("computeConfidence", () => {
  it("is 0 for a wallet with no events", () => {
    expect(computeConfidence([], NOW)).toBe(0);
  });

  it("is near 0 for a burst of same-day events (no tenure yet)", () => {
    const events: TrustScoreEvent[] = Array.from({ length: 10 }, () => ({
      type: "fully_executed" as const,
      occurredAt: NOW,
    }));
    expect(computeConfidence(events, NOW)).toBeCloseTo(0, 5);
  });

  it("reaches 1.0 once both tenure and volume are satisfied", () => {
    const events: TrustScoreEvent[] = [];
    for (let d = 0; d <= DEFAULT_CONFIDENCE_CONFIG.maturityDays; d += 5) {
      events.push({ type: "fully_executed", occurredAt: new Date(NOW.getTime() - d * 86_400_000) });
    }
    expect(events.length).toBeGreaterThanOrEqual(
      DEFAULT_CONFIDENCE_CONFIG.minEventsForFullConfidence,
    );
    expect(computeConfidence(events, NOW)).toBe(1);
  });

  it("stays partial when tenure is long but volume is low", () => {
    const events: TrustScoreEvent[] = [
      { type: "fully_executed", occurredAt: new Date(NOW.getTime() - 90 * 86_400_000) },
      { type: "fully_executed", occurredAt: NOW },
    ];
    const confidence = computeConfidence(events, NOW);
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThan(1);
  });
});

describe("evaluateWalletTrust — manipulation defense", () => {
  it("CLOSES THE EXPLOIT: a same-day burst of fully_executed events does not reach the boosted multiplier", () => {
    const events: TrustScoreEvent[] = Array.from({ length: 15 }, () => ({
      type: "fully_executed" as const,
      occurredAt: NOW,
    }));
    const result = evaluateWalletTrust(events, NOW);
    expect(result.rawScore).toBe(DEFAULT_TRUST_SCORE_CONFIG.scoreMax); // raw score alone WOULD max out
    expect(result.confidence).toBeCloseTo(0, 5);
    expect(result.sizeMultiplier).toBeCloseTo(1, 2); // stays neutral, not 1.5x
  });

  it("still rewards a genuinely long, real track record", () => {
    const events: TrustScoreEvent[] = [];
    for (let d = 0; d <= 90; d += 3)
      events.push({ type: "fully_executed", occurredAt: new Date(NOW.getTime() - d * 86_400_000) });
    const result = evaluateWalletTrust(events, NOW);
    expect(result.confidence).toBe(1);
    expect(result.sizeMultiplier).toBeCloseTo(1.5, 1);
  });

  it("does NOT dampen a bad pattern with confidence — penalizes immediately", () => {
    const events: TrustScoreEvent[] = [
      { type: "cancelled_before_execution", occurredAt: NOW },
      { type: "cancelled_before_execution", occurredAt: NOW },
    ];
    const result = evaluateWalletTrust(events, NOW);
    // Undamped: same magnitude as computeTrustScore would give directly.
    expect(result.effectiveScore).toBe(result.rawScore);
  });

  it("blocks a wallet whose confident, undamped negative score crosses blockThreshold", () => {
    const events: TrustScoreEvent[] = [];
    for (let i = 0; i < 5; i++)
      events.push({ type: "cancelled_before_execution", occurredAt: NOW });
    const result = evaluateWalletTrust(events, NOW);
    expect(result.effectiveScore).toBeLessThanOrEqual(DEFAULT_BLOCK_CONFIG.blockThreshold);
    expect(result.blocked).toBe(true);
    expect(result.sizeMultiplier).toBe(0);
  });

  it("a brand-new wallet is neutral, not blocked, not boosted", () => {
    const result = evaluateWalletTrust([], NOW);
    expect(result.blocked).toBe(false);
    expect(result.sizeMultiplier).toBe(1);
  });

  it("blocking can be disabled by setting blockThreshold to -Infinity", () => {
    const events: TrustScoreEvent[] = [];
    for (let i = 0; i < 5; i++)
      events.push({ type: "cancelled_before_execution", occurredAt: NOW });
    const result = evaluateWalletTrust(
      events,
      NOW,
      DEFAULT_TRUST_SCORE_CONFIG,
      DEFAULT_CONFIDENCE_CONFIG,
      undefined,
      { blockThreshold: Number.NEGATIVE_INFINITY },
    );
    expect(result.blocked).toBe(false);
    expect(result.sizeMultiplier).toBeGreaterThan(0);
  });
});
