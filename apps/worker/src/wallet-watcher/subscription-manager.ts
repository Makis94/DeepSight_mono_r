import { coinRegistry, users, watchedWallets, type Database } from "@hypertracker/db";
import { HYPERLIQUID_WS_LIMITS, type HyperliquidWsClient } from "@hypertracker/hyperliquid-sdk";
import { and, eq, isNull, or } from "drizzle-orm";
import type { Logger } from "pino";

/**
 * Owns the mapping from watched wallets to live WS subscriptions and the cached
 * per-address/per-coin filters the fill/TWAP handlers consult synchronously (avoids a DB
 * round-trip per incoming message). `refresh()` is polled periodically by index.ts —
 * that's how wallets get subscribed/unsubscribed without restarting the process.
 */
export class SubscriptionManager {
  private readonly addressThresholds = new Map<string, number>();
  private readonly activeCoins = new Set<string>();
  private readonly subscribedAddresses = new Set<string>();

  constructor(
    private readonly db: Database,
    private readonly client: HyperliquidWsClient,
    private readonly shardId: number,
    private readonly logger: Logger,
  ) {}

  /**
   * The lowest `minTradeAmount` among all users currently watching this address — events
   * below this floor aren't worth writing at all. The exact per-user threshold (which may
   * be higher) is applied later by whichever consumer decides whether to notify that user.
   */
  getMinTradeAmountUsd(address: string): number | undefined {
    return this.addressThresholds.get(address.toLowerCase());
  }

  isCoinActive(coin: string): boolean {
    return this.activeCoins.has(coin);
  }

  async refresh(): Promise<void> {
    const walletRows = await this.db
      .select({
        address: watchedWallets.address,
        minTradeAmount: users.minTradeAmount,
      })
      .from(watchedWallets)
      .innerJoin(users, eq(watchedWallets.userId, users.telegramId))
      .where(
        and(
          eq(watchedWallets.trackingMode, "precise"),
          or(isNull(watchedWallets.shardId), eq(watchedWallets.shardId, this.shardId)),
        ),
      );

    const coinRows = await this.db
      .select({ symbol: coinRegistry.symbol })
      .from(coinRegistry)
      .where(eq(coinRegistry.isActive, true));

    this.activeCoins.clear();
    for (const row of coinRows) this.activeCoins.add(row.symbol);

    const nextThresholds = new Map<string, number>();
    for (const row of walletRows) {
      const address = row.address.toLowerCase();
      const amount = Number(row.minTradeAmount);
      const existing = nextThresholds.get(address);
      if (existing === undefined || amount < existing) {
        nextThresholds.set(address, amount);
      }
    }

    this.addressThresholds.clear();
    for (const [address, amount] of nextThresholds) {
      this.addressThresholds.set(address, amount);
    }

    // Primary enforcement of the 10-address cap is apps/api's precise_slots table (exactly
    // 10 rows) — a wallet can't reach tracking_mode="precise" without holding one. This is
    // defense-in-depth only: it should never trigger in practice, and if it does, something
    // upstream let more precise wallets through than there are slots for.
    let desiredAddresses = [...nextThresholds.keys()];
    const limit = HYPERLIQUID_WS_LIMITS.maxUniqueUsersForUserSubscriptions;
    if (desiredAddresses.length > limit) {
      this.logger.warn(
        { shardId: this.shardId, total: desiredAddresses.length, limit },
        "more precise-mode wallets on this shard than Hyperliquid's per-IP user-subscription limit — subscribing only the first N; precise_slots should have prevented this",
      );
      desiredAddresses = desiredAddresses.slice(0, limit);
    }
    const desiredSet = new Set(desiredAddresses);

    for (const address of desiredSet) {
      if (!this.subscribedAddresses.has(address)) {
        this.client.subscribe({ type: "userFills", user: address });
        this.client.subscribe({ type: "userTwapHistory", user: address });
        this.client.subscribe({ type: "userTwapSliceFills", user: address });
        this.subscribedAddresses.add(address);
        this.logger.info({ address }, "subscribed to wallet");
      }
    }

    for (const address of this.subscribedAddresses) {
      if (!desiredSet.has(address)) {
        this.client.unsubscribe({ type: "userFills", user: address });
        this.client.unsubscribe({ type: "userTwapHistory", user: address });
        this.client.unsubscribe({ type: "userTwapSliceFills", user: address });
        this.subscribedAddresses.delete(address);
        this.logger.info({ address }, "unsubscribed from wallet");
      }
    }
  }
}
