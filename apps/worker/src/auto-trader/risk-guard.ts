import {
  autoTraderGlobalConfig,
  autoTrades,
  riskLimits,
  tradingAccounts,
  type Database,
} from "@hypertracker/db";
import { Decimal } from "@hypertracker/trading-core";
import { and, eq, gte, inArray } from "drizzle-orm";

export interface EligibleAccount {
  tradingAccountId: number;
  telegramId: number;
  mode: "paper" | "live";
  // Decimal strings (CLAUDE.md: money is never number/float) — straight from risk_limits,
  // never cast to Number here so trigger-pipeline.ts's arithmetic on them stays exact.
  baseSizeUsd: string;
  maxPositionUsd: string;
  maxDailyLossUsd: string;
  // Exact Hyperliquid symbols this account never opens NEW trades on (risk_limits.ignoredCoins).
  ignoredCoins: readonly string[];
}

/**
 * The two layers of risk control the CLAUDE.md decision log calls for (2026-09-22): a
 * platform-wide kill switch (auto_trader_global_config, independent of any one account) and
 * per-account limits (risk_limits). trigger-pipeline.ts must check BOTH before opening any
 * trade — this class is the single place that logic lives, so the two checks can't drift
 * apart between call sites.
 */
export class RiskGuard {
  constructor(private readonly db: Database) {}

  async isGlobalKillSwitchActive(): Promise<boolean> {
    const [row] = await this.db
      .select({ killSwitchActive: autoTraderGlobalConfig.killSwitchActive })
      .from(autoTraderGlobalConfig)
      .where(eq(autoTraderGlobalConfig.id, 1))
      .limit(1);
    // No row yet = the singleton config was never seeded = treat as "not active" (fail open
    // on a config table that doesn't exist yet, rather than refuse to ever trade until an
    // operator manually inserts a row) — the row is created by apps/api's admin tooling
    // (not built yet) the first time anyone touches the kill switch.
    return row?.killSwitchActive ?? false;
  }

  /**
   * Every account eligible to receive a NEW trade right now: linked, and the user's own
   * soft-pause checkbox (trading_accounts.tradingEnabled) is on. Does not check the daily
   * loss limit or an existing open position on this coin — those are per-signal checks
   * (todaysRealizedLossUsd / hasOpenPosition below), not account-eligibility ones.
   */
  async listEligibleAccounts(): Promise<EligibleAccount[]> {
    const rows = await this.db
      .select({
        id: tradingAccounts.id,
        telegramId: tradingAccounts.telegramId,
        mode: tradingAccounts.mode,
        baseSizeUsd: riskLimits.baseSizeUsd,
        maxPositionUsd: riskLimits.maxPositionUsd,
        maxDailyLossUsd: riskLimits.maxDailyLossUsd,
        ignoredCoins: riskLimits.ignoredCoins,
      })
      .from(tradingAccounts)
      .innerJoin(riskLimits, eq(riskLimits.tradingAccountId, tradingAccounts.id))
      .where(
        and(eq(tradingAccounts.linkStatus, "linked"), eq(tradingAccounts.tradingEnabled, true)),
      );

    return rows.map((row) => ({
      tradingAccountId: row.id,
      telegramId: row.telegramId,
      mode: row.mode,
      baseSizeUsd: row.baseSizeUsd,
      maxPositionUsd: row.maxPositionUsd,
      maxDailyLossUsd: row.maxDailyLossUsd,
      ignoredCoins: row.ignoredCoins,
    }));
  }

  /**
   * Batch form of hasOpenPosition — one query for every eligible account instead of N
   * (code-review, 2026-09-23: trigger-pipeline.ts's per-account loop was calling
   * hasOpenPosition + todaysRealizedLossUsd separately for each account, up to 2N sequential
   * round-trips per triggering signal). Returns the set of tradingAccountIds that already
   * have an open position on `coin`.
   */
  async openPositionsByAccount(
    tradingAccountIds: readonly number[],
    coin: string,
  ): Promise<Set<number>> {
    if (tradingAccountIds.length === 0) return new Set();
    const rows = await this.db
      .select({ tradingAccountId: autoTrades.tradingAccountId })
      .from(autoTrades)
      .where(
        and(
          inArray(autoTrades.tradingAccountId, tradingAccountIds as number[]),
          eq(autoTrades.coin, coin),
          eq(autoTrades.status, "open"),
        ),
      );
    return new Set(rows.map((row) => row.tradingAccountId));
  }

  /** Batch form of todaysRealizedLossUsd — one query for every eligible account instead of N. */
  async todaysRealizedLossUsdByAccount(
    tradingAccountIds: readonly number[],
  ): Promise<Map<number, string>> {
    const totals = new Map<number, Decimal>();
    if (tradingAccountIds.length === 0) return new Map();

    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);

    const rows = await this.db
      .select({
        tradingAccountId: autoTrades.tradingAccountId,
        realizedPnlUsd: autoTrades.realizedPnlUsd,
      })
      .from(autoTrades)
      .where(
        and(
          inArray(autoTrades.tradingAccountId, tradingAccountIds as number[]),
          gte(autoTrades.closedAt, startOfDayUtc),
        ),
      );

    for (const row of rows) {
      const pnl = new Decimal(row.realizedPnlUsd ?? "0");
      if (pnl.lt(0)) {
        totals.set(
          row.tradingAccountId,
          (totals.get(row.tradingAccountId) ?? new Decimal(0)).plus(pnl.abs()),
        );
      }
    }
    return new Map([...totals].map(([accountId, total]) => [accountId, total.toString()]));
  }
}
