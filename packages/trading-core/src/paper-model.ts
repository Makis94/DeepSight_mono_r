import type { z } from "zod";
import type { tradeSide } from "@hypertracker/shared";
import { Decimal, money } from "./money.js";

type TradeSide = z.infer<typeof tradeSide>;

// Fractions of notional (not percents), decimal strings per the project's money rule.
// source: hyperliquid-docs MCP, trading/fees page — tier 0 (base) perps rates, taker 0.045% /
// maker 0.015%, verified: 2026-09-25. Base tier deliberately: a paper account has no volume
// history, and a real account of this size starts at tier 0 too.
export interface PaperFeeRates {
  takerRate: string;
  makerRate: string;
}
export const HYPERLIQUID_BASE_PERP_FEES: PaperFeeRates = {
  takerRate: "0.00045",
  makerRate: "0.00015",
};

// CALIBRATION PLACEHOLDER, not customer-specified: the derived stop must sit at least this
// many full bid-ask spreads from the entry. A stop inside (or at) the spread is not a stop —
// the position is born already stopped out by normal quoting noise. Found 2026-09-25: 28 of 78
// paper trades had a stop on the wrong side of the entry (or a zero-width bracket when the
// predicted price impact was ~0), which polluted every win-rate/PnL number.
export const MIN_STOP_DISTANCE_SPREADS = 2;

export type BracketRejection =
  "zero_width_bracket" | "stop_wrong_side" | "take_profit_wrong_side" | "stop_inside_spread";

export type BracketCheck = { valid: true } | { valid: false; reason: BracketRejection };

export interface BracketCheckInput {
  side: TradeSide;
  entryPx: string;
  stopLossPx: string;
  takeProfitPx: string;
  // Best ask minus best bid at the moment the levels were derived.
  spreadPx: string;
}

// Pure geometry check on a derived SL/TP bracket — see MIN_STOP_DISTANCE_SPREADS for why.
export function validateBracket(
  input: BracketCheckInput,
  minStopSpreads: number = MIN_STOP_DISTANCE_SPREADS,
): BracketCheck {
  const long = input.side === "buy";
  const entry = money(input.entryPx);
  const stopDistance = long ? entry.minus(input.stopLossPx) : money(input.stopLossPx).minus(entry);
  const takeProfitDistance = long
    ? money(input.takeProfitPx).minus(entry)
    : entry.minus(input.takeProfitPx);

  if (stopDistance.eq(0)) return { valid: false, reason: "zero_width_bracket" };
  if (stopDistance.lt(0)) return { valid: false, reason: "stop_wrong_side" };
  if (takeProfitDistance.lte(0)) return { valid: false, reason: "take_profit_wrong_side" };
  if (stopDistance.lt(money(input.spreadPx).times(minStopSpreads))) {
    return { valid: false, reason: "stop_inside_spread" };
  }
  return { valid: true };
}

export type PaperExitKind = "take_profit" | "stop_loss" | "manual";

export interface PaperExitInput {
  side: TradeSide;
  sizeUsd: string;
  entryPx: string;
  stopLossPx: string;
  takeProfitPx: string;
  // Latest mid price when the exit was detected (the monitor only has mids, not bid/ask).
  midPx: string;
  kind: PaperExitKind;
  fees?: PaperFeeRates;
}

export interface PaperExit {
  exitPx: string;
  grossPnlUsd: string;
  feesUsd: string;
  netPnlUsd: string;
}

// How a paper position exits, modeled on how the real order types behave:
//  - take_profit: a resting LIMIT order — fills at its own level, never better (a poll that
//    happens to see the mid overshoot the level must not bank the overshoot), and pays the
//    maker fee.
//  - stop_loss: a stop-MARKET — fills wherever the market actually is once triggered, i.e. the
//    worse of the stop level and the observed mid, and pays the taker fee.
//  - manual: closes at the observed mid, taker fee.
// Entry is always a market order at the touch (taker fee). Realized PnL is NET of both fees.
// Known residual optimism: exit detection compares mids to the levels, so it can be up to half
// a spread early; the spread itself is charged on entry (touch fill) but not again on exit.
export function computePaperExit(input: PaperExitInput): PaperExit {
  const fees = input.fees ?? HYPERLIQUID_BASE_PERP_FEES;
  const long = input.side === "buy";
  const direction = long ? 1 : -1;
  const entry = money(input.entryPx);
  const mid = money(input.midPx);

  let exit: Decimal;
  if (input.kind === "take_profit") {
    exit = money(input.takeProfitPx);
  } else if (input.kind === "stop_loss") {
    const stop = money(input.stopLossPx);
    exit = long ? Decimal.min(stop, mid) : Decimal.max(stop, mid);
  } else {
    exit = mid;
  }

  const sizeBase = money(input.sizeUsd).dividedBy(entry);
  const gross = exit.minus(entry).times(sizeBase).times(direction);
  const exitRate = input.kind === "take_profit" ? fees.makerRate : fees.takerRate;
  const entryFee = money(input.sizeUsd).times(fees.takerRate);
  const exitFee = sizeBase.times(exit).times(exitRate);
  const totalFees = entryFee.plus(exitFee);

  return {
    exitPx: exit.toString(),
    grossPnlUsd: gross.toString(),
    feesUsd: totalFees.toString(),
    netPnlUsd: gross.minus(totalFees).toString(),
  };
}
