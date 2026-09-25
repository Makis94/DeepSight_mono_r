import { autoTrades, type Database } from "@hypertracker/db";
import { computePaperExit, Decimal } from "@hypertracker/trading-core";
import type {
  ExecutionAdapter,
  OpenPositionRequest,
  OpenPositionResult,
  PositionSnapshot,
} from "@hypertracker/trading-core";
import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";

/**
 * Phase A's only ExecutionAdapter (CLAUDE.md, 2026-09-22 decision: paper first, live is a
 * separate plan+confirmation later). Simulates a fill at the request's reference (touch) price and tracks
 * the resulting "position" entirely in packages/db's auto_trades table — never signs or
 * submits anything to Hyperliquid. A future live adapter (Phase B,
 * packages/hyperliquid-sdk-backed) implements the exact same ExecutionAdapter interface, so
 * trigger-pipeline.ts does not change when an account is promoted from paper to live —
 * only which adapter instance it's wired to does.
 *
 * Assumes at most one open position per (trading account, coin) at a time — reasonable for
 * Phase A's scope (spec §6's reverse-trade, which would need two concurrent opposite
 * positions on the same coin, is explicitly descoped). Enforced by risk-guard.ts before
 * openPosition is ever called, not by this adapter.
 */
export class PaperExecutionAdapter implements ExecutionAdapter {
  readonly exchange = "hyperliquid";

  constructor(
    private readonly db: Database,
    // MidPriceCache (apps/worker/src/twap-watcher, shared with twap-watcher) is a pre-existing
    // boundary this module doesn't own — its `number` return is converted to Decimal at first
    // use below, the one blessed conversion point from that external float source into this
    // module's otherwise all-decimal money arithmetic.
    private readonly getMidPrice: (coin: string) => number | undefined,
    private readonly logger: Logger,
  ) {}

  // No `await` in here — a real exchange call would need one, but Phase A's paper fill is
  // pure in-memory arithmetic against the already-cached mid price. Kept returning a Promise
  // (not made synchronous) to match ExecutionAdapter's interface exactly, so a Phase B live
  // adapter is a drop-in replacement.
  // eslint-disable-next-line @typescript-eslint/require-await -- see comment above
  async openPosition(request: OpenPositionRequest): Promise<OpenPositionResult> {
    // Fills exactly at the request's reference price (the touch the SL/TP were derived from)
    // — NOT at the cached allMids mid. Two different price references for entry vs SL/TP is
    // what produced brackets born on the wrong side of their own entry (2026-09-25 audit:
    // 28 of 78 trades). Spread is paid by construction: a buy fills at the ask, a sell at the
    // bid, not at the friendlier mid.
    const fillPx = new Decimal(request.referencePx);
    const sizeBase = new Decimal(request.sizeUsd).dividedBy(fillPx);

    this.logger.info(
      {
        accountId: request.accountId,
        coin: request.coin,
        side: request.side,
        entryPx: request.referencePx,
      },
      "paper: simulated fill",
    );

    return {
      // Not a real Hyperliquid order id — clearly tagged so nothing downstream mistakes this
      // for a live identifier.
      externalOrderId: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entryPx: fillPx.toString(),
      filledSize: sizeBase.toString(),
      stopLossOrderId: null,
      takeProfitOrderId: null,
    };
  }

  async closePosition(accountId: string, coin: string): Promise<void> {
    const tradingAccountId = Number(accountId);
    const [open] = await this.db
      .select()
      .from(autoTrades)
      .where(
        and(
          eq(autoTrades.tradingAccountId, tradingAccountId),
          eq(autoTrades.coin, coin),
          eq(autoTrades.status, "open"),
        ),
      )
      .limit(1);
    if (!open) return;

    const midPriceNum = this.getMidPrice(coin);
    const pnl =
      midPriceNum !== undefined && open.entryPx
        ? new Decimal(
            computePaperExit({
              side: open.side === "buy" ? "buy" : "sell",
              sizeUsd: open.sizeUsd,
              entryPx: open.entryPx,
              stopLossPx: open.stopLossPx,
              takeProfitPx: open.takeProfitPx,
              midPx: String(midPriceNum),
              kind: "manual",
            }).netPnlUsd,
          )
        : null;

    await this.db
      .update(autoTrades)
      .set({
        status: "closed_manual",
        closedAt: new Date(),
        ...(pnl !== null && { realizedPnlUsd: pnl.toString() }),
      })
      .where(eq(autoTrades.id, open.id));
  }

  async getPosition(accountId: string, coin: string): Promise<PositionSnapshot | null> {
    const tradingAccountId = Number(accountId);
    const [open] = await this.db
      .select()
      .from(autoTrades)
      .where(
        and(
          eq(autoTrades.tradingAccountId, tradingAccountId),
          eq(autoTrades.coin, coin),
          eq(autoTrades.status, "open"),
        ),
      )
      .limit(1);
    if (!open) return null;

    const midPriceNum = this.getMidPrice(coin);
    const unrealizedPnlUsd =
      midPriceNum !== undefined ? this.computePnl(open, new Decimal(midPriceNum)) : new Decimal(0);
    // Base-asset quantity, per PositionSnapshot.size's own doc comment — not sizeUsd
    // (dollars). Derived the same way computePnl already does internally (code-review,
    // 2026-09-23: this previously returned open.sizeUsd directly, silently mismatching the
    // field's documented unit).
    const sizeBase = open.entryPx
      ? new Decimal(open.sizeUsd).dividedBy(open.entryPx)
      : new Decimal(0);

    return {
      coin: open.coin,
      side: open.side === "buy" ? "buy" : "sell",
      size: sizeBase.toString(),
      entryPx: open.entryPx ?? "0",
      unrealizedPnlUsd: unrealizedPnlUsd.toString(),
      isOpen: true,
    };
  }

  private computePnl(
    trade: { side: string; sizeUsd: string; entryPx: string | null },
    currentPx: Decimal,
  ): Decimal {
    if (!trade.entryPx) return new Decimal(0);
    const entryPx = new Decimal(trade.entryPx);
    const sizeBase = new Decimal(trade.sizeUsd).dividedBy(entryPx);
    const direction = trade.side === "buy" ? 1 : -1;
    return currentPx.minus(entryPx).times(sizeBase).times(direction);
  }
}
