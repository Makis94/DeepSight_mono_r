import { MAX_IGNORED_COINS, updateRiskLimitsBodySchema } from "@hypertracker/shared";
import { describe, expect, it } from "vitest";

describe("updateRiskLimitsBodySchema.ignoredCoins", () => {
  it("is optional — a PATCH that only changes sizes leaves the ignore list untouched", () => {
    const parsed = updateRiskLimitsBodySchema.parse({ baseSizeUsd: "50" });
    expect(parsed.ignoredCoins).toBeUndefined();
  });

  it("accepts plain, mixed-case and dex-prefixed symbols and keeps their exact case", () => {
    const parsed = updateRiskLimitsBodySchema.parse({ ignoredCoins: ["BTC", "kPEPE", "xyz:NVDA"] });
    expect(parsed.ignoredCoins).toEqual(["BTC", "kPEPE", "xyz:NVDA"]);
  });

  it("dedupes repeated symbols", () => {
    const parsed = updateRiskLimitsBodySchema.parse({ ignoredCoins: ["ETH", "ETH", "SOL"] });
    expect(parsed.ignoredCoins).toEqual(["ETH", "SOL"]);
  });

  it("accepts an empty list (clearing every ignore)", () => {
    expect(updateRiskLimitsBodySchema.parse({ ignoredCoins: [] }).ignoredCoins).toEqual([]);
  });

  it("rejects malformed symbols", () => {
    for (const bad of ["", "BT C", "BTC;DROP", "a:b:c", "X".repeat(21)]) {
      expect(updateRiskLimitsBodySchema.safeParse({ ignoredCoins: [bad] }).success).toBe(false);
    }
  });

  it("rejects more than the max number of entries", () => {
    const tooMany = Array.from({ length: MAX_IGNORED_COINS + 1 }, (_, i) => `C${i}`);
    expect(updateRiskLimitsBodySchema.safeParse({ ignoredCoins: tooMany }).success).toBe(false);
  });
});
