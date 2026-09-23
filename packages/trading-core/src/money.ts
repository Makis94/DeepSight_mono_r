// Named import, not default — decimal.js's own .d.ts recommends this form (see its header
// comment); a default import re-exported from this module tripped up isolatedModules'
// handling of the class+namespace declaration merge.
import { Decimal } from "decimal.js";

// Single point where this package configures decimal.js — 30 significant digits is far past
// what a USD notional/price ever needs, but cheap and avoids ever rounding an intermediate
// step of a multi-multiplication chain (tier threshold scaling, VWAP book walks, position
// sizing) before the final result is stringified back out.
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

// CLAUDE.md: "Monetary amounts (USDC, PnL, volumes) — decimal strings or a fixed-point/
// BigInt-based type only. Never number/float." Money crosses every public function boundary
// in this package as a decimal string (same convention @hypertracker/shared's decimalString
// Zod schema already uses at the DB/API layer) — Decimal is purely an internal computation
// detail, never part of a public interface, so callers never need to import decimal.js
// themselves.
export { Decimal };

/** Parses a decimal string into a Decimal for internal arithmetic. */
export function money(value: string): Decimal {
  return new Decimal(value);
}
