import { describe, expect, it } from "vitest";
import type { TwapSignal } from "@hypertracker/trading-core";
import { classifyTrustScoreEvent } from "./trust-classification.js";

function signal(overrides: Partial<TwapSignal>): TwapSignal {
  return {
    exchange: "hyperliquid",
    externalId: "1",
    wallet: "0xabc",
    coin: "ZEC",
    side: "sell",
    status: "finished",
    totalSize: "10",
    executedSize: "10",
    executedNotionalUsd: "500000",
    durationMinutes: 5,
    reduceOnly: false,
    createdAt: new Date(),
    occurredAt: new Date(),
    ...overrides,
  };
}

describe("classifyTrustScoreEvent", () => {
  it("finished -> fully_executed", () => {
    expect(classifyTrustScoreEvent(signal({ status: "finished" }))).toBe("fully_executed");
  });

  it("finished with a partial fill is still fully_executed (market conditions, not a cancel)", () => {
    expect(classifyTrustScoreEvent(signal({ status: "finished", executedSize: "3" }))).toBe(
      "fully_executed",
    );
  });

  it("terminated with zero executed -> cancelled_before_execution", () => {
    expect(classifyTrustScoreEvent(signal({ status: "terminated", executedSize: "0" }))).toBe(
      "cancelled_before_execution",
    );
  });

  it("terminated with partial execution -> cancelled_mid_execution", () => {
    expect(classifyTrustScoreEvent(signal({ status: "terminated", executedSize: "4" }))).toBe(
      "cancelled_mid_execution",
    );
  });

  it("stopped is not scored (price boundary, not a wallet behavior)", () => {
    expect(classifyTrustScoreEvent(signal({ status: "stopped" }))).toBeNull();
  });

  it("error is not scored (never actually placed)", () => {
    expect(classifyTrustScoreEvent(signal({ status: "error" }))).toBeNull();
  });
});
