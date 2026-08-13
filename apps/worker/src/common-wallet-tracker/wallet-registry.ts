import { users, watchedWallets, type Database } from "@hypertracker/db";
import { eq } from "drizzle-orm";

/**
 * In-memory mirror of tracking_mode="common" watched wallets and their lowest configured
 * minTradeAmount, refreshed periodically by index.ts — same polling pattern as
 * wallet-watcher's SubscriptionManager, minus any WS subscribe/unsubscribe calls: common
 * mode has no per-wallet subscription to manage, membership is just an address-set lookup
 * against the shared `trades` feed (see coin-universe-manager.ts).
 */
export class CommonWalletRegistry {
  private readonly addressThresholds = new Map<string, number>();

  constructor(private readonly db: Database) {}

  getMinTradeAmountUsd(address: string): number | undefined {
    return this.addressThresholds.get(address.toLowerCase());
  }

  async refresh(): Promise<void> {
    const rows = await this.db
      .select({
        address: watchedWallets.address,
        minTradeAmount: users.minTradeAmount,
      })
      .from(watchedWallets)
      .innerJoin(users, eq(watchedWallets.userId, users.telegramId))
      .where(eq(watchedWallets.trackingMode, "common"));

    const next = new Map<string, number>();
    for (const row of rows) {
      const address = row.address.toLowerCase();
      const amount = Number(row.minTradeAmount);
      const existing = next.get(address);
      if (existing === undefined || amount < existing) {
        next.set(address, amount);
      }
    }

    this.addressThresholds.clear();
    for (const [address, amount] of next) {
      this.addressThresholds.set(address, amount);
    }
  }
}
