import { autoTrades, type AutoTrade, type Database } from "@hypertracker/db";
import { computePaperExit, Decimal } from "@hypertracker/trading-core";
import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { MidPriceCache } from "../twap-watcher/mid-price-cache.js";

/**
 * Polls every open auto_trades row against the current mid price and closes it when its
 * stop-loss or take-profit level is crossed. Polling, not a push subscription, because
 * per-user Hyperliquid WS subscriptions are capped at 10 unique addresses per IP
 * (hyperliquid-docs MCP, rate-limits-and-user-limits page, verified 2026-09-20) — a
 * multi-account TP/SL watcher cannot rely on that path (see CLAUDE.md's TWAP auto-trading
 * section). Phase A only: closes are computed against the SAME MidPriceCache the trigger
 * pipeline uses, never a real exchange fill.
 */
export class PositionMonitor {
  private timer: NodeJS.Timeout | null = null;
  // Guards against an overlapping tick() if one run (DB round-trip x open-trade count) takes
  // longer than pollIntervalMs — without it, two overlapping ticks could both compute a TP/SL
  // hit off two different mid-price snapshots and race the same closing UPDATE (code-review,
  // 2026-09-23).
  private ticking = false;

  constructor(
    private readonly db: Database,
    private readonly midPrices: MidPriceCache,
    private readonly logger: Logger,
    private readonly pollIntervalMs: number,
  ) {}

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Wrapped like every per-trade check below — code-review (2026-09-23) caught that a
      // transient DB hiccup on this one call (unlike everything inside the loop) would throw
      // as an unhandled rejection (start()/setInterval never .catch it), crashing the whole
      // auto-trader process and violating "each worker must not go down together" (CLAUDE.md).
      const open = await this.db.select().from(autoTrades).where(eq(autoTrades.status, "open"));
      for (const trade of open) {
        try {
          await this.checkOne(trade);
        } catch (err) {
          this.logger.error({ err, tradeId: trade.id }, "position monitor failed to check trade");
        }
      }
    } catch (err) {
      this.logger.error({ err }, "position monitor tick failed");
    } finally {
      this.ticking = false;
    }
  }

  private async checkOne(trade: AutoTrade): Promise<void> {
    const mid = this.midPrices.get(trade.coin);
    if (mid === undefined) return;
    // MidPriceCache (apps/worker/src/twap-watcher, shared with twap-watcher) is a pre-existing
    // boundary this module doesn't own — its `number` price is converted to Decimal here, the
    // one blessed conversion point into this module's otherwise all-decimal money arithmetic.
    const price = new Decimal(mid.price);

    const stopLossPx = new Decimal(trade.stopLossPx);
    const takeProfitPx = new Decimal(trade.takeProfitPx);

    // SL/TP sides mirror packages/trading-core's deriveStopLossTakeProfit: long (buy) has SL
    // below entry / TP above; short (sell) has SL above entry / TP below.
    let hit: "closed_tp" | "closed_sl" | null = null;
    if (trade.side === "buy") {
      if (price.lte(stopLossPx)) hit = "closed_sl";
      else if (price.gte(takeProfitPx)) hit = "closed_tp";
    } else {
      if (price.gte(stopLossPx)) hit = "closed_sl";
      else if (price.lte(takeProfitPx)) hit = "closed_tp";
    }
    if (!hit) return;

    // Net-of-fees PnL at a modeled exit — TP fills at its own level (resting limit, maker fee),
    // SL at the worse of its level and the observed mid (stop-market, taker fee); see
    // packages/trading-core paper-model.ts. Realized PnL used to be computed at whatever mid
    // the poll happened to see, banking random overshoot past TP and ignoring fees entirely.
    let realizedPnlUsd: Decimal | null = null;
    if (trade.entryPx && new Decimal(trade.entryPx).gt(0)) {
      realizedPnlUsd = new Decimal(
        computePaperExit({
          side: trade.side === "buy" ? "buy" : "sell",
          sizeUsd: trade.sizeUsd,
          entryPx: trade.entryPx,
          stopLossPx: trade.stopLossPx,
          takeProfitPx: trade.takeProfitPx,
          midPx: price.toString(),
          kind: hit === "closed_tp" ? "take_profit" : "stop_loss",
        }).netPnlUsd,
      );
    }

    // `ticking` already prevents an overlapping tick() from racing this same trade, but the
    // WHERE guard is a cheap, correct-on-its-own defense too (code-review, 2026-09-23) — a
    // no-op UPDATE means "already closed by something else," not silently overwriting it.
    await this.db
      .update(autoTrades)
      .set({
        status: hit,
        closedAt: new Date(),
        ...(realizedPnlUsd !== null && { realizedPnlUsd: realizedPnlUsd.toString() }),
      })
      .where(and(eq(autoTrades.id, trade.id), eq(autoTrades.status, "open")));

    this.logger.info(
      { tradeId: trade.id, coin: trade.coin, hit, realizedPnlUsd: realizedPnlUsd?.toString() },
      "auto-trade closed",
    );
  }
}
