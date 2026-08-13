import { coinRegistry, type Database } from "@hypertracker/db";
import type { HyperliquidWsClient } from "@hypertracker/hyperliquid-sdk";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";

/**
 * Owns the mapping from coin_registry's active coins (top-250 CMC ∩ Hyperliquid-listed,
 * kept in sync by the coin-registry-sync worker) to live `trades` WS subscriptions.
 * `refresh()` is polled periodically by index.ts, mirroring wallet-watcher's
 * SubscriptionManager — coins get subscribed/unsubscribed as coin_registry.is_active
 * changes without restarting the process. Up to ~250 coins fits comfortably on one
 * connection (HYPERLIQUID_WS_LIMITS.maxSubscriptionsPerIp is 1000; that cap is per-IP, not
 * per-connection), so no connection pooling is needed at this scale.
 */
export class SubscriptionManager {
  private readonly subscribedCoins = new Set<string>();

  constructor(
    private readonly db: Database,
    private readonly client: HyperliquidWsClient,
    private readonly logger: Logger,
  ) {}

  async refresh(): Promise<void> {
    const rows = await this.db
      .select({ symbol: coinRegistry.symbol })
      .from(coinRegistry)
      .where(eq(coinRegistry.isActive, true));

    const desired = new Set(rows.map((row) => row.symbol));

    for (const coin of desired) {
      if (!this.subscribedCoins.has(coin)) {
        this.client.subscribe({ type: "trades", coin });
        this.subscribedCoins.add(coin);
        this.logger.info({ coin }, "subscribed to trades");
      }
    }

    for (const coin of this.subscribedCoins) {
      if (!desired.has(coin)) {
        this.client.unsubscribe({ type: "trades", coin });
        this.subscribedCoins.delete(coin);
        this.logger.info({ coin }, "unsubscribed from trades");
      }
    }
  }
}
