import { describe, expect, it } from "vitest";
import { computePaperExit, validateBracket } from "./paper-model.js";

describe("validateBracket", () => {
  const spreadPx = "0.02";

  it("accepts a well-formed long bracket", () => {
    expect(
      validateBracket({
        side: "buy",
        entryPx: "100",
        stopLossPx: "99",
        takeProfitPx: "100.65",
        spreadPx,
      }),
    ).toEqual({ valid: true });
  });

  it("accepts a well-formed short bracket", () => {
    expect(
      validateBracket({
        side: "sell",
        entryPx: "100",
        stopLossPx: "101",
        takeProfitPx: "99.35",
        spreadPx,
      }),
    ).toEqual({ valid: true });
  });

  it("rejects a zero-width bracket (predicted impact ~0 collapses SL and TP onto the entry)", () => {
    expect(
      validateBracket({
        side: "buy",
        entryPx: "100",
        stopLossPx: "100",
        takeProfitPx: "100",
        spreadPx,
      }),
    ).toEqual({ valid: false, reason: "zero_width_bracket" });
  });

  it("rejects a stop on the wrong side of the entry (the XMR-sell shape found in prod)", () => {
    expect(
      validateBracket({
        side: "sell",
        entryPx: "571.745",
        stopLossPx: "570.315",
        takeProfitPx: "568.789",
        spreadPx,
      }),
    ).toEqual({ valid: false, reason: "stop_wrong_side" });
  });

  it("rejects a take-profit on the wrong side of the entry", () => {
    expect(
      validateBracket({
        side: "buy",
        entryPx: "100",
        stopLossPx: "99",
        takeProfitPx: "99.5",
        spreadPx,
      }),
    ).toEqual({ valid: false, reason: "take_profit_wrong_side" });
  });

  it("rejects a stop closer to the entry than 2 full spreads", () => {
    expect(
      validateBracket({
        side: "buy",
        entryPx: "100",
        stopLossPx: "99.97",
        takeProfitPx: "100.5",
        spreadPx,
      }),
    ).toEqual({ valid: false, reason: "stop_inside_spread" });
  });
});

describe("computePaperExit", () => {
  const base = {
    sizeUsd: "1000",
    entryPx: "100",
    stopLossPx: "99",
    takeProfitPx: "100.65",
    fees: { takerRate: "0.0005", makerRate: "0.0002" },
  };

  it("take-profit exits at the TP level, not at an overshooting mid, and pays maker on exit", () => {
    // 10 units, +0.65 each = 6.5 gross; entry fee 1000*0.0005=0.5; exit fee 10*100.65*0.0002=0.2013
    const exit = computePaperExit({ ...base, side: "buy", midPx: "103", kind: "take_profit" });
    expect(exit.exitPx).toBe("100.65");
    expect(Number(exit.grossPnlUsd)).toBeCloseTo(6.5, 8);
    expect(Number(exit.feesUsd)).toBeCloseTo(0.7013, 8);
    expect(Number(exit.netPnlUsd)).toBeCloseTo(5.7987, 8);
  });

  it("stop-loss fills at the worse of the stop level and the observed mid (long gaps through)", () => {
    const exit = computePaperExit({ ...base, side: "buy", midPx: "98", kind: "stop_loss" });
    expect(exit.exitPx).toBe("98");
    expect(Number(exit.grossPnlUsd)).toBeCloseTo(-20, 8);
  });

  it("stop-loss on a short fills at the higher of stop and mid", () => {
    const exit = computePaperExit({
      ...base,
      side: "sell",
      stopLossPx: "101",
      takeProfitPx: "99.35",
      midPx: "102",
      kind: "stop_loss",
    });
    expect(exit.exitPx).toBe("102");
    expect(Number(exit.grossPnlUsd)).toBeCloseTo(-20, 8);
  });

  it("a short take-profit is a gain and still pays fees on both legs", () => {
    const exit = computePaperExit({
      ...base,
      side: "sell",
      stopLossPx: "101",
      takeProfitPx: "99.35",
      midPx: "99",
      kind: "take_profit",
    });
    expect(Number(exit.grossPnlUsd)).toBeCloseTo(6.5, 8);
    expect(Number(exit.netPnlUsd)).toBeLessThan(Number(exit.grossPnlUsd));
  });

  it("manual close exits at mid with the taker fee", () => {
    const exit = computePaperExit({ ...base, side: "buy", midPx: "101", kind: "manual" });
    expect(exit.exitPx).toBe("101");
    // entry 0.5 + exit 10*101*0.0005 = 0.505
    expect(Number(exit.feesUsd)).toBeCloseTo(1.005, 8);
  });
});
