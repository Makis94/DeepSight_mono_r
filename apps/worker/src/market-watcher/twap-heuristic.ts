// Tunable pattern-match parameters — NOT sourced from Hyperliquid docs, because there is no
// documented "typical suborder cadence" constant to verify against. The Order types page
// only gives bounds: interval >= 30s, duration 5min-7days, catch-up suborders up to 3x the
// normal suborder size. These are this project's own heuristic thresholds (biased toward
// fewer false positives over catching every real TWAP) — see marketTwapSuspectedPayloadSchema
// doc comment for why this can never be presented as confirmed TWAP data on its own; see
// twap-confirm.ts for how a candidate produced here gets checked against Hyperliquid's real
// TWAP fill history before anything is published.
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
  // Set once a candidate built from this streak has been successfully confirmed+published
  // (see markReported) — stops collectCandidates from re-offering the same still-growing
  // streak on every later tick while it keeps accumulating more trades. Reset to false
  // whenever a gap resets the streak to a fresh one (see observe()).
  reported: boolean;
  // Last time (ms) this streak was offered as a candidate — see collectCandidates. 0 means
  // never offered. Used for fairness, NOT recency of trading: a streak's cumulative
  // notionalUsd grows without bound for as long as it stays unbroken, so a continuously
  // trading bot/market-maker (no real TWAP at all) can vastly outweigh a short-lived genuine
  // TWAP — sorting candidates by notional starves real TWAPs behind noisy streaks that never
  // confirm. Round-robin by "longest since last checked" instead so every qualifying streak
  // gets a REST confirmation attempt within a bounded number of ticks, regardless of size.
  lastOfferedAt: number;
}

export interface TwapObservationInput {
  coin: string;
  side: "buy" | "sell";
  address: string;
  price: number;
  size: number;
  time: number;
}

export interface TwapCandidate {
  coin: string;
  side: "buy" | "sell";
  address: string;
  notionalUsd: string;
  avgPrice: string;
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

function streakKey(coin: string, address: string, side: "buy" | "sell"): string {
  return `${coin}|${address}|${side}`;
}

/**
 * Pattern-matches the public `trades` feed for series that look like a TWAP execution: the
 * same address repeatedly on the same side of the same coin, similar suborder sizes, within a
 * bounded time gap. This is inference over trade-tape data with no order-type field — it
 * cannot and does not confirm an actual Hyperliquid TWAP order (see module doc comment on
 * marketTwapSuspectedPayloadSchema, and twap-confirm.ts for the REST confirmation step this
 * feeds into). Each `market-watcher` process owns one instance; state is in-memory only and
 * resets on restart, same as RecentIdDedup.
 *
 * `observe()` only accumulates — it never emits a detection itself. `collectCandidates()`
 * (called on an interval) offers up every streak that currently clears the detection
 * thresholds and hasn't been reported yet, so the very first tick after the streak first
 * qualifies already gets a REST confirmation attempt (twap-confirm.ts) — real TWAP data
 * appears about as quickly as the old fire-immediately design did, instead of waiting for the
 * whole series to go quiet. A streak that isn't confirmed on one tick is offered again on the
 * next (the caller must call `markReported` once it succeeds, or it keeps being re-offered
 * until either that happens or the streak goes stale and is pruned).
 */
export class TwapPatternDetector {
  private readonly streaks = new Map<string, Streak>();

  constructor(private readonly config: TwapHeuristicConfig) {}

  // Feed every trade side (buyer AND seller, called separately per trade) regardless of its
  // individual notional — a real TWAP suborder is typically far smaller than any single-trade
  // large-trade threshold (e.g. a $10k/1h TWAP is ~$83 suborders), so filtering upstream would
  // make this detector blind to exactly the trades it needs to accumulate.
  observe(input: TwapObservationInput): void {
    const key = streakKey(input.coin, input.address, input.side);
    const existing = this.streaks.get(key);
    const last = existing?.observations[existing.observations.length - 1];
    const streak: Streak =
      existing && last && input.time - last.time <= this.config.maxGapMs
        ? existing
        : { observations: [], reported: false, lastOfferedAt: 0 };

    streak.observations.push({ time: input.time, size: input.size, price: input.price });
    this.streaks.set(key, streak);
  }

  /**
   * Prunes streaks that have gone stale (no observation within `maxGapMs` — the series has
   * ended, reported or not) and returns a candidate for up to `maxCandidates` of the streaks
   * that currently clear the detection thresholds and haven't been reported yet — the ones
   * least recently offered first (see `lastOfferedAt`), so a REST-confirmation budget that
   * can't cover every qualifying streak every tick still cycles through all of them fairly
   * instead of always picking the same ones. Called on each tick; the caller is expected to
   * attempt REST confirmation for each candidate and call `markReported` on success (see
   * market-watcher/index.ts).
   */
  collectCandidates(now: number, maxCandidates: number): TwapCandidate[] {
    const eligible: [string, Streak][] = [];

    for (const [key, streak] of this.streaks) {
      const last = streak.observations[streak.observations.length - 1];
      if (!last) continue;
      if (now - last.time > this.config.maxGapMs) {
        this.streaks.delete(key);
        continue;
      }

      if (streak.reported) continue;
      if (streak.observations.length < this.config.minOccurrences) continue;

      const sizes = streak.observations.map((o) => o.size);
      const maxSize = Math.max(...sizes);
      const minSize = Math.min(...sizes);
      if (minSize <= 0 || maxSize / minSize > this.config.maxSizeRatio) continue;

      const notionalUsd = streak.observations.reduce((sum, o) => sum + o.size * o.price, 0);
      if (notionalUsd < this.config.minNotionalUsd) continue;

      eligible.push([key, streak]);
    }

    eligible.sort(([, a], [, b]) => a.lastOfferedAt - b.lastOfferedAt);

    const candidates: TwapCandidate[] = [];
    for (const [key, streak] of eligible.slice(0, maxCandidates)) {
      const notionalUsd = streak.observations.reduce((sum, o) => sum + o.size * o.price, 0);
      const avgPrice =
        streak.observations.reduce((sum, o) => sum + o.price, 0) / streak.observations.length;
      const firstObservation = streak.observations[0];
      const lastObservation = streak.observations[streak.observations.length - 1];
      if (!firstObservation || !lastObservation) continue;

      streak.lastOfferedAt = now;

      const [coin, address, side] = key.split("|") as [string, string, "buy" | "sell"];
      candidates.push({
        coin,
        address,
        side,
        notionalUsd: notionalUsd.toString(),
        avgPrice: avgPrice.toString(),
        occurrences: streak.observations.length,
        firstSeenAt: firstObservation.time,
        lastSeenAt: lastObservation.time,
      });
    }

    return candidates;
  }

  /**
   * Marks the streak behind a given (coin, address, side) as reported so it stops being
   * re-offered by `collectCandidates` while it keeps growing. A no-op if the streak has since
   * gone stale and been pruned (harmless — there's nothing left to mark).
   */
  markReported(coin: string, address: string, side: "buy" | "sell"): void {
    const streak = this.streaks.get(streakKey(coin, address, side));
    if (streak) streak.reported = true;
  }
}
