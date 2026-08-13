const MAX_SEEN_PER_SCOPE = 5000;

/**
 * Same shape as wallet-watcher's RecentIdDedup (not shared across watchers — each is an
 * independent process). `scope` is the coin symbol; `id` is the trade's `tid`. Defensive: in
 * case Hyperliquid ever redelivers trades around a reconnect, this prevents re-inserting the
 * same trade as a new event. Not explicitly confirmed by docs for the `trades` channel
 * specifically — WsTrade carries no `isSnapshot` field, unlike userFills/userTwapHistory,
 * whose backlog-on-(re)subscribe behavior IS documented (verified via hyperliquid-docs MCP,
 * 2026-07-31) — kept as a cheap safety net rather than a documented requirement. The
 * durable `events.externalId` unique index (see publishEvent) is the real backstop either
 * way. Sized larger than wallet-watcher's per-address dedup since a single active coin can
 * produce far more trades per window than one wallet's fills.
 */
export class RecentIdDedup {
  private readonly seen = new Map<string, Set<number>>();

  hasSeen(scope: string, id: number): boolean {
    return this.seen.get(scope)?.has(id) ?? false;
  }

  markSeen(scope: string, id: number): void {
    let set = this.seen.get(scope);
    if (!set) {
      set = new Set();
      this.seen.set(scope, set);
    }
    set.add(id);
    if (set.size > MAX_SEEN_PER_SCOPE) {
      const excess = set.size - MAX_SEEN_PER_SCOPE;
      const iterator = set.values();
      for (let i = 0; i < excess; i += 1) {
        const next = iterator.next();
        if (next.done) break;
        set.delete(next.value);
      }
    }
  }

  clearScope(scope: string): void {
    this.seen.delete(scope);
  }
}
