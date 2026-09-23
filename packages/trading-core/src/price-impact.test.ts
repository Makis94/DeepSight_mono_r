import { describe, expect, it } from "vitest";
import { deriveStopLossTakeProfit, estimatePriceImpact, type BookLevel } from "./price-impact.js";

const asks: BookLevel[] = [
  { price: "100", size: "1" }, // $100 notional at best
  { price: "101", size: "2" }, // $202 notional
  { price: "102", size: "10" }, // $1020 notional
];

describe("estimatePriceImpact", () => {
  it("returns the best price with zero impact when the first level covers the notional", () => {
    const result = estimatePriceImpact(asks, "50");
    expect(result.estimatedAvgPx).toBe("100");
    expect(result.maxMovePct).toBe(0);
    expect(result.depthExhausted).toBe(false);
  });

  it("walks multiple levels and computes a volume-weighted average price", () => {
    // $100 @100 + $202 @101 = $302 for (1 + 2) = 3 units -> avg 100.666...
    const result = estimatePriceImpact(asks, "302");
    expect(Number(result.estimatedAvgPx)).toBeCloseTo(100.6667, 3);
    expect(result.maxMovePct).toBeGreaterThan(0);
    expect(result.depthExhausted).toBe(false);
  });

  it("flags depthExhausted when the book can't fill the full notional", () => {
    const result = estimatePriceImpact(asks, "10000");
    expect(result.depthExhausted).toBe(true);
  });

  it("throws on an empty book", () => {
    expect(() => estimatePriceImpact([], "100")).toThrow();
  });
});

describe("deriveStopLossTakeProfit", () => {
  it("places SL below entry and TP above entry for a buy", () => {
    const { stopLossPx, takeProfitPx } = deriveStopLossTakeProfit("100", 5, "buy");
    expect(Number(stopLossPx)).toBeLessThan(100);
    expect(Number(takeProfitPx)).toBeGreaterThan(100);
  });

  it("places SL above entry and TP below entry for a sell", () => {
    const { stopLossPx, takeProfitPx } = deriveStopLossTakeProfit("100", 5, "sell");
    expect(Number(stopLossPx)).toBeGreaterThan(100);
    expect(Number(takeProfitPx)).toBeLessThan(100);
  });

  it("TP is closer to entry than SL given the default sub-1.0 tpFractionOfMax", () => {
    const { stopLossPx, takeProfitPx } = deriveStopLossTakeProfit("100", 5, "buy");
    expect(100 - Number(stopLossPx)).toBeGreaterThan(Number(takeProfitPx) - 100);
  });
});
