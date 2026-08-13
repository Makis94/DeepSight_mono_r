const MAX_SEEN_PER_SCOPE = 2000;

/**
 * Same shape as wallet-watcher's RecentIdDedup and market-watcher's (not shared across
 * workers — each is an independent process, see CLAUDE.md). `scope` is the wallet address;
 * `id` is the trade's `tid`. A single trade can match both a watched buyer and a watched
 * seller — dedup is scoped per matched address (not per coin, unlike market-watcher) so
 * both sides are still processed independently rather than one suppressing the other.
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
