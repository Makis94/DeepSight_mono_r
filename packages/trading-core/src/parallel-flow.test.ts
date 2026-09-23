import { describe, expect, it } from "vitest";
import {
  computeCounterFlowAdjustment,
  computeNetFlow,
  DEFAULT_COUNTER_FLOW_CONFIG,
  type ActiveTwap,
} from "./parallel-flow.js";

const NOW = new Date("2026-09-22T00:20:00.000Z");

function twap(overrides: Partial<ActiveTwap>): ActiveTwap {
  return {
    externalId: "1",
    coin: "ZEC",
    side: "buy",
    notionalUsd: "100000",
    activatedAt: NOW,
    reduceOnly: false,
    ...overrides,
  };
}

describe("computeNetFlow", () => {
  it("sums buy and sell notional separately", () => {
    const active = [
      twap({ externalId: "1", side: "buy", notionalUsd: "100000" }),
      twap({ externalId: "2", side: "buy", notionalUsd: "50000" }),
      twap({ externalId: "3", side: "sell", notionalUsd: "30000" }),
    ];
    const result = computeNetFlow(active, "ZEC");
    expect(result.buyNotionalUsd).toBe("150000");
    expect(result.sellNotionalUsd).toBe("30000");
    expect(result.netFlowUsd).toBe("120000");
  });

  it("counts a long-running TWAP regardless of how long ago it started (spec §7's own worked example: 60-min TWAPs started 12-20 min ago still count)", () => {
    const longRunning = twap({
      activatedAt: new Date(NOW.getTime() - 20 * 60_000),
      notionalUsd: "999999",
    });
    const result = computeNetFlow([longRunning], "ZEC");
    expect(result.buyNotionalUsd).toBe("999999");
  });

  it("excludes TWAPs on a different coin", () => {
    const other = twap({ coin: "HYPE", notionalUsd: "999999" });
    const result = computeNetFlow([other], "ZEC");
    expect(Number(result.buyNotionalUsd) + Number(result.sellNotionalUsd)).toBe(0);
  });

  it("still counts reduceOnly TWAPs (they're real market pressure, just not trigger candidates)", () => {
    const reduceOnly = twap({ reduceOnly: true, notionalUsd: "42000" });
    const result = computeNetFlow([reduceOnly], "ZEC");
    expect(result.buyNotionalUsd).toBe("42000");
  });
});

describe("computeCounterFlowAdjustment", () => {
  it("does not adjust when counter-flow is small relative to the trigger", () => {
    const result = computeCounterFlowAdjustment("sell", "800000", {
      buyNotionalUsd: "100000",
      sellNotionalUsd: "0",
      netFlowUsd: "100000",
    });
    expect(result.skip).toBe(false);
    expect(result.sizeMultiplier).toBe(1);
  });

  it("skips entirely when counter-flow volume matches or exceeds the trigger (spec's worked example)", () => {
    const result = computeCounterFlowAdjustment("sell", "800000", {
      buyNotionalUsd: "900000",
      sellNotionalUsd: "0",
      netFlowUsd: "900000",
    });
    expect(result.skip).toBe(true);
    expect(result.sizeMultiplier).toBe(0);
  });

  it("linearly reduces size in the middle zone", () => {
    const result = computeCounterFlowAdjustment("sell", "1000000", {
      buyNotionalUsd: "650000", // ratio 0.65, halfway between reduceStartRatio(0.3) and skipRatio(1.0)
      sellNotionalUsd: "0",
      netFlowUsd: "650000",
    });
    expect(result.skip).toBe(false);
    expect(result.sizeMultiplier).toBeGreaterThan(
      DEFAULT_COUNTER_FLOW_CONFIG.minMultiplierBeforeSkip,
    );
    expect(result.sizeMultiplier).toBeLessThan(1);
  });

  it("checks the opposite side from the trigger — a buy trigger is opposed by sell flow", () => {
    const result = computeCounterFlowAdjustment("buy", "500000", {
      buyNotionalUsd: "0",
      sellNotionalUsd: "500000",
      netFlowUsd: "-500000",
    });
    expect(result.skip).toBe(true);
  });

  it("throws for a non-positive trigger notional", () => {
    expect(() =>
      computeCounterFlowAdjustment("buy", "0", {
        buyNotionalUsd: "0",
        sellNotionalUsd: "0",
        netFlowUsd: "0",
      }),
    ).toThrow();
  });
});
