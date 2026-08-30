import { getAllMids, HYPERLIQUID_REST_URLS } from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";

type Network = "mainnet" | "testnet";

interface DexSnapshot {
  prices: Map<string, number>;
  fetchedAt: number;
}

// Hyperliquid's first/main perp dex is addressed by the empty string.
const MAIN_DEX = "";

/**
 * Mid-price source for twap-watcher's activation-notional estimate. Polls Hyperliquid's own
 * REST `allMids` (info request weight 2) on a short interval rather than opening a second
 * `allMids` WS subscription — Hyperliquid silently drops a duplicate `allMids` subscription
 * opened from the same IP as market-watcher's already-running one, which is what starved
 * this worker of prices and left every "activated" TWAP unpublished.
 *
 * The main dex is polled continuously. Builder-deployed (HIP-3) dexes — coins named
 * "{dex}:{coin}", which the main-dex response does NOT include — are polled only once one of
 * their coins is actually seen in the TWAP stream (`ensureDex`), and dropped again after
 * `dexIdleEvictMs` with no further interest.
 */
export class MidPriceCache {
  private readonly baseUrl: string;
  private readonly snapshots = new Map<string, DexSnapshot>();
  private readonly dexWantedAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

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
    void this.pollAll();
    this.timer = setInterval(() => {
      void this.pollAll();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Register interest in a builder-deployed dex so its mids start being polled. */
  ensureDex(dex: string): void {
    this.dexWantedAt.set(dex, Date.now());
    if (!this.snapshots.has(dex)) void this.pollDex(dex);
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

  private async pollAll(): Promise<void> {
    const now = Date.now();
    for (const [dex, wantedAt] of this.dexWantedAt) {
      if (dex !== MAIN_DEX && now - wantedAt > this.dexIdleEvictMs) {
        this.dexWantedAt.delete(dex);
        this.snapshots.delete(dex);
        continue;
      }
      await this.pollDex(dex);
    }
  }

  private async pollDex(dex: string): Promise<void> {
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
