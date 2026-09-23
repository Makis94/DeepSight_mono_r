import { z } from "zod";
import type { tradeSide } from "@hypertracker/shared";
import { decimalString } from "@hypertracker/shared";
import { Decimal, money } from "./money.js";

export const bookLevelSchema = z.object({
  price: decimalString,
  size: decimalString,
});
export type BookLevel = z.infer<typeof bookLevelSchema>;

export interface PriceImpactEstimate {
  // Volume-weighted average price achieved walking the book to fill `notionalUsd` — a
  // decimal string (money, CLAUDE.md). maxMovePct is a percentage, not money — stays `number`.
  estimatedAvgPx: string;
  // Unsigned % move from the book's best level to estimatedAvgPx.
  maxMovePct: number;
  // True if the provided levels didn't have enough depth to fill the full notional — the
  // estimate is a lower bound in that case, not a firm number. The caller (apps/worker's
  // auto-trader) should treat this as a reason to shrink the trade, not ignore it.
  depthExhausted: boolean;
}

// Walks one side of an order book — asks for a buy-side estimate, bids for a sell-side
// estimate (the caller passes the side the TWAP itself trades INTO) — consuming levels until
// `notionalUsd` worth has been filled, returning the volume-weighted average execution price
// and % impact vs. the best level. Pure VWAP-style book walk, no exchange-specific
// assumption beyond the {price, size} shape already verified against Hyperliquid's l2Book
// response (hyperliquid-docs MCP, verified 2026-09-20) — levels must already be sorted
// best-to-worst by the caller.
export function estimatePriceImpact(
  levels: readonly BookLevel[],
  notionalUsd: string,
): PriceImpactEstimate {
  const first = levels[0];
  if (!first) {
    throw new Error("estimatePriceImpact: empty book — cannot estimate impact with no levels");
  }
  const bestPx = money(first.price);
  let remainingUsd = money(notionalUsd);
  let filledUsd = new Decimal(0);
  let filledSize = new Decimal(0);

  for (const level of levels) {
    if (remainingUsd.lte(0)) break;
    const px = money(level.price);
    const sz = money(level.size);
    const levelUsd = px.times(sz);
    const takeUsd = Decimal.min(levelUsd, remainingUsd);
    filledUsd = filledUsd.plus(takeUsd);
    filledSize = filledSize.plus(takeUsd.dividedBy(px));
    remainingUsd = remainingUsd.minus(takeUsd);
  }

  const depthExhausted = remainingUsd.gt(0);
  const estimatedAvgPx = filledSize.gt(0) ? filledUsd.dividedBy(filledSize) : bestPx;
  const maxMovePct = bestPx.gt(0)
    ? estimatedAvgPx.minus(bestPx).dividedBy(bestPx).times(100).abs().toNumber()
    : 0;

  return { estimatedAvgPx: estimatedAvgPx.toString(), maxMovePct, depthExhausted };
}

// CALIBRATION PLACEHOLDER (CLAUDE.md spec §5, open question #3 — "TP coefficient vs computed
// max move", NOT resolved as of 2026-09-22). tpFractionOfMax=0.65 is the spec's own
// starting-hypothesis midpoint ("60-70%"), not a backtested value.
export interface SlTpConfig {
  // Dimensionless fraction, not money — stays `number`.
  tpFractionOfMax: number;
}

export const DEFAULT_SL_TP_CONFIG: SlTpConfig = { tpFractionOfMax: 0.65 };

export interface SlTpLevels {
  stopLossPx: string;
  takeProfitPx: string;
}

// `side` is the position WE open — same direction as the TWAP itself (spec §1/§5). The
// reverse trade from spec §6 is explicitly descoped (CLAUDE.md, 2026-09-22), so this only
// ever derives levels for the main trade.
export function deriveStopLossTakeProfit(
  entryPx: string,
  maxMovePct: number,
  side: z.infer<typeof tradeSide>,
  config: SlTpConfig = DEFAULT_SL_TP_CONFIG,
): SlTpLevels {
  const direction = side === "buy" ? 1 : -1;
  const entry = money(entryPx);
  const moveUsd = entry.times(maxMovePct / 100);
  // SL sits at the full computed adverse-move potential; TP at a fraction of the same move in
  // the favorable direction (spec §5: TP deliberately short of the full potential, never the
  // max).
  return {
    stopLossPx: entry.minus(moveUsd.times(direction)).toString(),
    takeProfitPx: entry.plus(moveUsd.times(direction).times(config.tpFractionOfMax)).toString(),
  };
}
