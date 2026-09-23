import { describe, expect, it } from "vitest";
import {
  computeTierThresholdUsd,
  DEFAULT_THRESHOLD_NORMALIZATION,
  evaluateTierTrigger,
  normalizeToBaseWindow,
  type TierBaseConfig,
} from "./tier-thresholds.js";

const tierABase: TierBaseConfig = {
  tier: "A",
  baseCoin: "ZEC",
  baseThresholdUsd: "500000",
  baseWindowMinutes: 5,
  baseDayNtlVlm: "10000000",
};

describe("computeTierThresholdUsd", () => {
  it("returns the base threshold unchanged for the base coin itself", () => {
    const result = computeTierThresholdUsd({
      base: tierABase,
      coinDayNtlVlm: tierABase.baseDayNtlVlm,
    });
    expect(result).toBe("500000");
  });

  it("scales sub-linearly (sqrt by default) for a higher-volume coin", () => {
    // 4x the base coin's volume -> sqrt(4) = 2x threshold, not 4x.
    const result = computeTierThresholdUsd({ base: tierABase, coinDayNtlVlm: "40000000" });
    expect(Number(result)).toBeCloseTo(1_000_000, 5);
  });

  it("scales down for a lower-volume coin but never below the floor", () => {
    const result = computeTierThresholdUsd({ base: tierABase, coinDayNtlVlm: "1" });
    expect(Number(result)).toBeGreaterThanOrEqual(
      Number(DEFAULT_THRESHOLD_NORMALIZATION.minThresholdUsd),
    );
  });

  it("falls back to the base threshold for a coin with no measurable volume", () => {
    const result = computeTierThresholdUsd({ base: tierABase, coinDayNtlVlm: "0" });
    expect(result).toBe("500000");
  });

  it("throws if the base coin's own volume is non-positive — can't normalize against it", () => {
    expect(() =>
      computeTierThresholdUsd({
        base: { ...tierABase, baseDayNtlVlm: "0" },
        coinDayNtlVlm: "1000",
      }),
    ).toThrow();
  });
});

describe("normalizeToBaseWindow", () => {
  it("scales a longer-duration TWAP's notional down to the base window's rate", () => {
    // $500k over 60 minutes is a much slower rate than $500k over 5 minutes.
    const result = normalizeToBaseWindow("500000", 60, 5);
    expect(Number(result)).toBeCloseTo(41_666.67, 1);
  });

  it("scales a shorter-duration TWAP's notional up", () => {
    const result = normalizeToBaseWindow("100000", 2.5, 5);
    expect(result).toBe("200000");
  });

  it("is a no-op when the actual duration already matches the base window", () => {
    expect(normalizeToBaseWindow("500000", 5, 5)).toBe("500000");
  });
});

describe("evaluateTierTrigger", () => {
  it("passes for a fast, large TWAP on the base coin", () => {
    const result = evaluateTierTrigger("500000", 5, {
      base: tierABase,
      coinDayNtlVlm: tierABase.baseDayNtlVlm,
    });
    expect(result.passesThreshold).toBe(true);
  });

  it("fails for the same notional spread over a much longer window", () => {
    const result = evaluateTierTrigger("500000", 300, {
      base: tierABase,
      coinDayNtlVlm: tierABase.baseDayNtlVlm,
    });
    expect(result.passesThreshold).toBe(false);
  });
});
