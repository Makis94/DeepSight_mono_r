import {
  findDayNtlVlm,
  getMetaAndAssetCtxs,
  type MetaAndAssetCtxsResponse,
} from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";

/**
 * Periodic cache of Hyperliquid's metaAndAssetCtxs response, feeding
 * packages/trading-core's tier-thresholds.ts (dayNtlVlm per coin, for the threshold
 * normalization formula — spec §2). Refreshed on a multi-minute interval (info request
 * weight 20, hyperliquid-docs MCP, verified 2026-09-20), never per-signal.
 */
export class MarketDataCache {
  private snapshot: MetaAndAssetCtxsResponse | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger,
    private readonly refreshIntervalMs: number,
  ) {}

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.refreshIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * 24h notional volume for `coin` as a decimal string (money — CLAUDE.md), or undefined if
   * unknown (unlisted, or cache not warm yet).
   */
  dayNtlVlm(coin: string): string | undefined {
    if (!this.snapshot) return undefined;
    return findDayNtlVlm(this.snapshot, coin);
  }

  private async refresh(): Promise<void> {
    try {
      this.snapshot = await getMetaAndAssetCtxs(this.baseUrl);
    } catch (err) {
      this.logger.warn({ err }, "metaAndAssetCtxs refresh failed — keeping last snapshot");
    }
  }
}
