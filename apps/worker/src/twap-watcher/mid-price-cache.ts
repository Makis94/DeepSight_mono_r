import { getAllMids, HYPERLIQUID_REST_URLS } from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";

type Network = "mainnet" | "testnet";

interface DexSnapshot {
  prices: Map<string, number>;
  fetchedAt: number;
}

// Hyperliquid's first/main perp dex is addressed by the empty string.
const MAIN_DEX = "";

// The main dex is polled every `pollIntervalMs` (constructor, default 3s). HIP-3 builder
// dexes only feed the activation-time notional estimate and MAX_MID_AGE_MS in index.ts is
// 30s, so they're polled far less often — and their count is capped — to keep this cache's
// share of the per-IP REST weight budget (1200/min, allMids = weight 2) bounded no matter
// how many builder dexes show up in the TWAP stream.
const HIP3_POLL_INTERVAL_MS = 12_000;
const MAX_TRACKED_HIP3_DEXES = 12;

/**
 * Mid-price source for twap-watcher's activation-notional estimate. Polls Hyperliquid's own
 * REST `allMids` (info request weight 2) on a short interval rather than opening a second
 * `allMids` WS subscription — a duplicate `allMids` subscription opened from the same IP as
 * market-watcher's already-running one was observed to get dropped by Hyperliquid within
 * seconds, repeatedly, which starved this worker of prices and left every "activated" TWAP
 * unpublished. (Not documented behaviour — observed in prod; the REST switch sidesteps it.)
 *
 * The main dex is polled continuously. Builder-deployed (HIP-3) dexes — coins named
 * "{dex}:{coin}", which the main-dex response does NOT include — are polled only once one of
 * their coins is seen in the TWAP stream (`ensureDex`), on a slower cadence, capped in
 * number, and dropped again after `dexIdleEvictMs` with no further interest.
 */
export class MidPriceCache {
  private readonly baseUrl: string;
  private readonly snapshots = new Map<string, DexSnapshot>();
  private readonly dexWantedAt = new Map<string, number>();
  private readonly dexPolledAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    network: Network,
    private readonly logger: Logger,
    private readonly pollIntervalMs = 3_000,
    private readonly dexIdleEvictMs = 5 * 60_000,
  ) {
    this.baseUrl = HYPERLIQUID_REST_URLS[network];
    this.dexWantedAt.set(MAIN_DEX, Number.POSITIVE_INFINITY);
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Register interest in a builder-deployed dex so its mids start being polled. */
  ensureDex(dex: string): void {
    if (dex === MAIN_DEX) return;

    const isNew = !this.dexWantedAt.has(dex);
    if (isNew) {
      const tracked = this.dexWantedAt.size - 1; // minus the main dex
      if (tracked >= MAX_TRACKED_HIP3_DEXES) this.evictOldestDex();
    }
    this.dexWantedAt.set(dex, Date.now());
    if (isNew) void this.pollDex(dex);
  }

  /**
   * Latest mid for `coin` and how long ago that snapshot was fetched, or undefined if
   * unknown. `coin` may be a plain name ("BTC") or a builder name ("xyz:SHEIN").
   */
  get(coin: string): { price: number; ageMs: number } | undefined {
    const colon = coin.indexOf(":");
    const dex = colon === -1 ? MAIN_DEX : coin.slice(0, colon);
    const snapshot = this.snapshots.get(dex);
    if (!snapshot) return undefined;

    // A dex-scoped `allMids` response may key by the bare coin or by the full "dex:coin" —
    // the docs don't pin this down, so try both.
    const bare = colon === -1 ? coin : coin.slice(colon + 1);
    const price = snapshot.prices.get(coin) ?? snapshot.prices.get(bare);
    if (price === undefined) return undefined;
    return { price, ageMs: Date.now() - snapshot.fetchedAt };
  }

  private evictOldestDex(): void {
    let oldest: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [dex, wantedAt] of this.dexWantedAt) {
      if (dex === MAIN_DEX) continue;
      if (wantedAt < oldestAt) {
        oldestAt = wantedAt;
        oldest = dex;
      }
    }
    if (oldest === undefined) return;
    this.dexWantedAt.delete(oldest);
    this.dexPolledAt.delete(oldest);
    this.snapshots.delete(oldest);
  }

  private async tick(): Promise<void> {
    // Reentrancy guard: a bare setInterval with an async body would otherwise stack
    // overlapping runs under REST latency — exactly when the API is already slow — and
    // multiply the request rate. Skip a tick if the previous one is still in flight.
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const due: string[] = [MAIN_DEX];
      for (const [dex, wantedAt] of this.dexWantedAt) {
        if (dex === MAIN_DEX) continue;
        if (now - wantedAt > this.dexIdleEvictMs) {
          this.dexWantedAt.delete(dex);
          this.dexPolledAt.delete(dex);
          this.snapshots.delete(dex);
          continue;
        }
        if (now - (this.dexPolledAt.get(dex) ?? 0) >= HIP3_POLL_INTERVAL_MS) due.push(dex);
      }
      for (const dex of due) await this.pollDex(dex);
    } finally {
      this.ticking = false;
    }
  }

  private async pollDex(dex: string): Promise<void> {
    this.dexPolledAt.set(dex, Date.now());
    try {
      const raw = await getAllMids(this.baseUrl, dex === MAIN_DEX ? undefined : dex);
      const prices = new Map<string, number>();
      for (const [coin, priceStr] of Object.entries(raw)) {
        const price = Number(priceStr);
        if (Number.isFinite(price)) prices.set(coin, price);
      }
      this.snapshots.set(dex, { prices, fetchedAt: Date.now() });
    } catch (err) {
      this.logger.warn(
        { err, dex: dex || "(main)" },
        "allMids REST poll failed — keeping last snapshot",
      );
    }
  }
}
