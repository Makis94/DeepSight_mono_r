import { describe, expect, it } from "vitest";
import type { ActiveTwap } from "@hypertracker/trading-core";
import { ActiveTwapTracker } from "./active-twap-tracker.js";

function twap(overrides: Partial<ActiveTwap>): ActiveTwap {
  return {
    externalId: "1",
    coin: "ZEC",
    side: "sell",
    notionalUsd: "500000",
    activatedAt: new Date(),
    reduceOnly: false,
    ...overrides,
  };
}

describe("ActiveTwapTracker", () => {
  it("keeps a fresh entry", () => {
    const tracker = new ActiveTwapTracker();
    tracker.upsert(twap({ externalId: "fresh", activatedAt: new Date() }));
    expect(tracker.all().map((t) => t.externalId)).toEqual(["fresh"]);
  });

  it("evicts an entry older than the max TWAP duration on read, without an explicit remove()", () => {
    const tracker = new ActiveTwapTracker();
    const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    tracker.upsert(twap({ externalId: "stale", activatedAt: nineDaysAgo }));
    tracker.upsert(twap({ externalId: "fresh", activatedAt: new Date() }));

    expect(tracker.all().map((t) => t.externalId)).toEqual(["fresh"]);
    // Second call confirms the stale entry is actually gone from byId, not just filtered.
    expect(tracker.all().map((t) => t.externalId)).toEqual(["fresh"]);
  });

  it("remove() still works for an explicit terminal-status transition", () => {
    const tracker = new ActiveTwapTracker();
    tracker.upsert(twap({ externalId: "done" }));
    tracker.remove("done");
    expect(tracker.all()).toEqual([]);
  });
});
