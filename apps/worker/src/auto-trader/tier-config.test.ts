import { describe, expect, it } from "vitest";
import { classifyCoin, TIER_BASES } from "./tier-config.js";

describe("classifyCoin", () => {
  it("classifies the spec's own Tier A examples", () => {
    expect(classifyCoin("ZEC")).toBe("A");
    expect(classifyCoin("HYPE")).toBe("A");
  });

  it("classifies the spec's own Tier B examples", () => {
    expect(classifyCoin("ARB")).toBe("B");
    expect(classifyCoin("UNI")).toBe("B");
  });

  it("defaults an unclassified coin to the stricter tier (A), not the easier one (B)", () => {
    expect(classifyCoin("SOME_UNLISTED_COIN")).toBe("A");
  });
});

describe("TIER_BASES", () => {
  it("matches the spec's own worked base thresholds", () => {
    expect(TIER_BASES.A).toMatchObject({
      baseCoin: "ZEC",
      baseThresholdUsd: "500000",
      baseWindowMinutes: 5,
    });
    expect(TIER_BASES.B).toMatchObject({
      baseCoin: "ARB",
      baseThresholdUsd: "300000",
      baseWindowMinutes: 5,
    });
  });
});
