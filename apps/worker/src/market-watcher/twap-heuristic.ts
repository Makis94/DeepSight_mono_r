import type { MarketTwapSuspectedPayload } from "@hypertracker/shared";

// Tunable pattern-match parameters — NOT sourced from Hyperliquid docs, because there is no
// documented "typical suborder cadence" constant to verify against. The Order types page
// only gives bounds: interval >= 30s, duration 5min-7days, catch-up suborders up to 3x the
// normal suborder size. These are this project's own heuristic thresholds (biased toward
// fewer false positives over catching every real TWAP) — see marketTwapSuspectedPayloadSchema
// doc comment for why this can never be presented as confirmed TWAP data.
export interface TwapHeuristicConfig {
  minOccurrences: number;
  maxSizeRatio: number;
  maxGapMs: number;
  minNotionalUsd: number;
}

export const DEFAULT_TWAP_HEURISTIC_PARAMS = {
  minOccurrences: 3,
  maxSizeRatio: 3,
  maxGapMs: 5 * 60_000,
};

interface TradeObservation {
  time: number;
  size: number;
  price: number;
}

interface Streak {
  observations: TradeObservation[];
}

export interface TwapObservationInput {
  coin: string;
  side: "buy" | "sell";
  address: string;
  price: number;
  size: number;
  time: number;
}

/**
 * Pattern-matches the public `trades` feed for series that look like a TWAP execution: the
 * same address repeatedly on the same side of the same coin, similar suborder sizes, within a
 * bounded time gap. This is inference over trade-tape data with no order-type field — it
 * cannot and does not confirm an actual Hyperliquid TWAP order (see module doc comment on
 * marketTwapSuspectedPayloadSchema). Each `market-watcher` process owns one instance; state is
 * in-memory only and resets on restart, same as RecentIdDedup.
 */
export class TwapPatternDetector {
  private readonly streaks = new Map<string, Streak>();

  constructor(private readonly config: TwapHeuristicConfig) {}

  // Feed every trade side (buyer AND seller, called separately per trade) regardless of its
  // individual notional — a real TWAP suborder is typically far smaller than any single-trade
  // large-trade threshold (e.g. a $10k/1h TWAP is ~$83 suborders), so filtering upstream would
  // make this detector blind to exactly the trades it needs to accumulate. Returns a detection
  // only the instant accumulated notional first crosses the configured threshold; the streak
  // is then cleared so the same run of suborders doesn't re-fire on every following slice.
  observe(input: TwapObservationInput): MarketTwapSuspectedPayload | null {
    const key = `${input.coin}|${input.address}|${input.side}`;
    const existing = this.streaks.get(key);
    const last = existing?.observations[existing.observations.length - 1];
    const streak: Streak =
      existing && last && input.time - last.time <= this.config.maxGapMs
        ? existing
        : { observations: [] };

    streak.observations.push({ time: input.time, size: input.size, price: input.price });
    this.streaks.set(key, streak);

    if (streak.observations.length < this.config.minOccurrences) return null;

    const sizes = streak.observations.map((o) => o.size);
    const maxSize = Math.max(...sizes);
    const minSize = Math.min(...sizes);
    if (minSize <= 0 || maxSize / minSize > this.config.maxSizeRatio) return null;

    const notionalUsd = streak.observations.reduce((sum, o) => sum + o.size * o.price, 0);
    if (notionalUsd < this.config.minNotionalUsd) return null;

    const avgPrice =
      streak.observations.reduce((sum, o) => sum + o.price, 0) / streak.observations.length;
    const firstObservation = streak.observations[0];
    const lastObservation = streak.observations[streak.observations.length - 1];
    if (!firstObservation || !lastObservation) return null;

    const payload: MarketTwapSuspectedPayload = {
      type: "market_twap_suspected",
      coin: input.coin,
      side: input.side,
      address: input.address,
      notionalUsd: notionalUsd.toString(),
      avgPrice: avgPrice.toString(),
      occurrences: streak.observations.length,
      firstSeenAt: firstObservation.time,
      lastSeenAt: lastObservation.time,
      source: "heuristic",
    };

    // Reset rather than keep accumulating — otherwise every additional suborder after the
    // threshold crossing would re-fire a fresh (near-duplicate) detection.
    this.streaks.delete(key);
    return payload;
  }

  // Bounds memory growth. Not required for correctness — a stale streak just gets replaced
  // the next time observe() sees that key past maxGapMs — but without this, addresses/coins
  // that go permanently quiet would accumulate forever.
  pruneStale(now: number): void {
    for (const [key, streak] of this.streaks) {
      const last = streak.observations[streak.observations.length - 1];
      if (!last || now - last.time > this.config.maxGapMs) {
        this.streaks.delete(key);
      }
    }
  }
}
