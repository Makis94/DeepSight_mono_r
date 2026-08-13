import { getMeta, type HyperliquidWsClient } from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";

/**
 * Unlike market-watcher's SubscriptionManager (scoped to coin_registry's top-250-CMC
 * intersection, for large-trade monitoring only), a common-mode watched wallet can trade
 * ANY Hyperliquid-listed perp — so this subscribes to `trades` for the full universe from
 * `getMeta`, not just coin_registry. Hyperliquid currently lists ~230 perps
 * (worker logs, coin-registry-sync), comfortably under HYPERLIQUID_WS_LIMITS
 * .maxSubscriptionsPerIp (1000, per-IP not per-connection) — one connection is enough.
 * Polled infrequently since new listings are rare, unlike wallet-watcher/market-watcher's
 * 15s wallet/coin_registry refresh.
 */
const UNIVERSE_REFRESH_INTERVAL_MS = 5 * 60_000;

export class CoinUniverseManager {
  private readonly subscribedCoins = new Set<string>();

  constructor(
    private readonly restBaseUrl: string,
    private readonly client: HyperliquidWsClient,
    private readonly logger: Logger,
  ) {}

  async refresh(): Promise<void> {
    const universe = await getMeta(this.restBaseUrl);
    const desired = new Set(
      universe.filter((entry) => !entry.isDelisted).map((entry) => entry.name),
    );

    for (const coin of desired) {
      if (!this.subscribedCoins.has(coin)) {
        this.client.subscribe({ type: "trades", coin });
        this.subscribedCoins.add(coin);
      }
    }

    for (const coin of this.subscribedCoins) {
      if (!desired.has(coin)) {
        this.client.unsubscribe({ type: "trades", coin });
        this.subscribedCoins.delete(coin);
      }
    }

    this.logger.info(
      { coinCount: this.subscribedCoins.size },
      "coin universe subscriptions refreshed",
    );
  }

  startPolling(): void {
    void this.refresh().catch((err: unknown) => {
      this.logger.error({ err }, "failed to refresh coin universe subscriptions");
    });
    setInterval(() => {
      void this.refresh().catch((err: unknown) => {
        this.logger.error({ err }, "failed to refresh coin universe subscriptions");
      });
    }, UNIVERSE_REFRESH_INTERVAL_MS);
  }
}
