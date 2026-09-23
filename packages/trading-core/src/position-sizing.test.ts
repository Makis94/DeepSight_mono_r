import { describe, expect, it } from "vitest";
import { computePositionSizeUsd } from "./position-sizing.js";

describe("computePositionSizeUsd", () => {
  it("multiplies base size by both multipliers", () => {
    const result = computePositionSizeUsd({
      baseSizeUsd: "1000",
      trustMultiplier: 1.5,
      counterFlowMultiplier: 1,
      maxPositionUsd: "10000",
    });
    expect(result).toBe("1500");
  });

  it("clamps to maxPositionUsd", () => {
    const result = computePositionSizeUsd({
      baseSizeUsd: "10000",
      trustMultiplier: 1.5,
      counterFlowMultiplier: 1.5,
      maxPositionUsd: "5000",
    });
    expect(result).toBe("5000");
  });

  it("never goes negative", () => {
    const result = computePositionSizeUsd({
      baseSizeUsd: "1000",
      trustMultiplier: 0,
      counterFlowMultiplier: 0,
      maxPositionUsd: "10000",
    });
    expect(result).toBe("0");
  });
});
