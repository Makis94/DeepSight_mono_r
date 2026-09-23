import type { ActiveTwap } from "@hypertracker/trading-core";

// Hyperliquid's own documented max TWAP duration is 7 days (hyperliquid-docs MCP, verified
// 2026-09-20) — comfortably past that, an entry can only still be here because its terminal
// status event was dropped/unparsed (remove() never fired), not because the TWAP is
// legitimately still running. Used by the eviction sweep below (code-review, 2026-09-23:
// byId was previously only pruned on an explicit remove(), so a lost WS frame leaked that
// entry for the rest of the worker's uptime — unbounded growth over weeks).
const MAX_ENTRY_AGE_MS = 8 * 24 * 60 * 60 * 1000;

// KNOWN LIMITATION, deliberately accepted for Phase A (not a silent gap — flagged here and
// in CLAUDE.md): in-memory only, not persisted. packages/trading-core's ActiveTwap doc
// comment calls out that the QuickNode TWAP dataset is forward-only with no snapshot on
// (re)subscribe, so a worker restart loses every currently-active TWAP until fresh
// "activated" events repopulate this tracker. Since parallel-flow.ts's computeNetFlow counts
// every currently-active TWAP with no time-based window (code-review, 2026-09-23 — a prior
// window filter excluded exactly the long-running TWAPs spec §7's own worked example says
// must count), a TWAP that was already active before a restart stays invisible to the
// counter-flow check for the REST OF ITS OWN RUN (up to Hyperliquid's 7-day max TWAP
// duration in the worst case), not a fixed bounded window — it only starts counting again
// once IT next transitions and a fresh event repopulates it, or (more commonly) once other,
// newly-activated TWAPs provide fresh pressure signal. Revisit with a DB-backed snapshot if
// restart frequency during active trading hours makes this matter in practice.
export class ActiveTwapTracker {
  private readonly byId = new Map<string, ActiveTwap>();

  upsert(twap: ActiveTwap): void {
    this.byId.set(twap.externalId, twap);
  }

  remove(externalId: string): void {
    this.byId.delete(externalId);
  }

  /**
   * All ActiveTwap entries this tracker currently knows about, across every coin. Sweeps
   * stale entries (older than MAX_ENTRY_AGE_MS) first — lazy on read rather than a timer,
   * since this is already called on every trigger evaluation (trigger-pipeline.ts), which is
   * frequent enough to keep the map bounded without a separate scheduler.
   */
  all(): ActiveTwap[] {
    const cutoff = Date.now() - MAX_ENTRY_AGE_MS;
    for (const [externalId, twap] of this.byId) {
      if (twap.activatedAt.getTime() < cutoff) {
        this.byId.delete(externalId);
      }
    }
    return [...this.byId.values()];
  }
}
