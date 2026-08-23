export interface ActiveTwapEntry {
  twapId: number;
  address: string;
  coin: string;
  side: "buy" | "sell";
  notionalUsd: number;
  avgPrice: number;
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastCheckedAt: number;
}

/**
 * Tracks real (twap-confirm.ts-identified) TWAP orders that are still running, so their
 * published notional reflects the order's true accumulated size rather than whatever fraction
 * had landed at the moment twap-confirm.ts first identified the twapId. Each `market-watcher`
 * process owns one instance; state is in-memory only and resets on restart, same as
 * TwapPatternDetector and RecentIdDedup — an order still running across a restart simply gets
 * re-identified from scratch by the pattern detector once its suborders resume appearing on the
 * public trades tape.
 */
export class ActiveTwapTracker {
  private readonly entries = new Map<number, ActiveTwapEntry>();

  has(twapId: number): boolean {
    return this.entries.has(twapId);
  }

  start(entry: Omit<ActiveTwapEntry, "lastCheckedAt">, now: number): void {
    if (this.entries.has(entry.twapId)) return;
    this.entries.set(entry.twapId, { ...entry, lastCheckedAt: now });
  }

  /**
   * Up to `maxCount` tracked entries due for a REST re-check, least-recently-checked first —
   * same round-robin fairness as TwapPatternDetector.collectCandidates, so a REST budget that
   * can't recheck every active entry every tick still cycles through all of them instead of
   * starving whichever was tracked last.
   */
  collectDue(maxCount: number): ActiveTwapEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => a.lastCheckedAt - b.lastCheckedAt)
      .slice(0, maxCount);
  }

  applyUpdate(
    twapId: number,
    update: {
      notionalUsd: number;
      avgPrice: number;
      occurrences: number;
      firstSeenAt: number;
      lastSeenAt: number;
    },
    now: number,
  ): void {
    const entry = this.entries.get(twapId);
    if (!entry) return;
    entry.notionalUsd = update.notionalUsd;
    entry.avgPrice = update.avgPrice;
    entry.occurrences = update.occurrences;
    entry.firstSeenAt = update.firstSeenAt;
    entry.lastSeenAt = update.lastSeenAt;
    entry.lastCheckedAt = now;
  }

  isFinished(twapId: number, now: number, graceMs: number): boolean {
    const entry = this.entries.get(twapId);
    if (!entry) return false;
    return now - entry.lastSeenAt > graceMs;
  }

  remove(twapId: number): ActiveTwapEntry | undefined {
    const entry = this.entries.get(twapId);
    this.entries.delete(twapId);
    return entry;
  }
}
