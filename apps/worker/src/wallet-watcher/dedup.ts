const MAX_SEEN_PER_SCOPE = 2000;

/**
 * Hyperliquid resends a fresh `isSnapshot: true` backlog every time a subscription is
 * (re-)established (including after a reconnect) — without this, the same fills/TWAP
 * entries would be re-inserted as new events each time wallet-watcher reconnects.
 * `scope` is the wallet address; `id` is the fill's `tid` or a composite TWAP key.
 */
export class RecentIdDedup {
  private readonly seen = new Map<string, Set<string | number>>();

  hasSeen(scope: string, id: string | number): boolean {
    return this.seen.get(scope)?.has(id) ?? false;
  }

  markSeen(scope: string, id: string | number): void {
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
