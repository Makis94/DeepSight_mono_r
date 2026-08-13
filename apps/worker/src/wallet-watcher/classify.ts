import type { WsFill } from "@hypertracker/hyperliquid-sdk";
import type {
  WalletClosePositionPayload,
  WalletLargePositionChangePayload,
  WalletOpenLongPayload,
  WalletOpenShortPayload,
} from "@hypertracker/shared";

export interface ClassifiedFill {
  payload:
    | WalletOpenLongPayload
    | WalletOpenShortPayload
    | WalletClosePositionPayload
    | WalletLargePositionChangePayload;
  notionalUsd: number;
}

// source: hyperliquid-docs MCP (notation page), verified: 2026-07-27 — "B" = Bid = Buy,
// "A" = Ask = Short/Sell.
export function fillSide(side: string): "buy" | "sell" {
  return side === "B" ? "buy" : "sell";
}

// Spot fills use a coin format like "@107" or "PURR/USDC" — Long/Short/close only make
// sense for perps, so wallet-watcher's position notifications skip spot activity entirely.
export function isPerpFill(fill: WsFill): boolean {
  return !fill.coin.startsWith("@") && !fill.coin.includes("/");
}

/**
 * Only "Open Long" is directly confirmed in Hyperliquid's own docs examples (verified via
 * hyperliquid-docs MCP, 2026-07-27); "Open Short"/"Close Long"/"Close Short" are inferred
 * from Hyperliquid's known frontend conventions, not individually doc-confirmed. The
 * matching is deliberately defensive (prefix checks, not an exhaustive enum) so an
 * unrecognized `dir` string falls into the large-position-change catch-all instead of
 * being silently dropped or throwing.
 */
export function classifyFill(fill: WsFill): ClassifiedFill {
  const notionalUsd = Math.abs(Number(fill.px) * Number(fill.sz));
  const base = {
    coin: fill.coin,
    side: fillSide(fill.side),
    price: fill.px,
    size: fill.sz,
    startPosition: fill.startPosition,
    closedPnl: fill.closedPnl,
    notionalUsd: notionalUsd.toString(),
    dir: fill.dir,
    source: "precise" as const,
  };

  if (fill.dir.startsWith("Open Long")) {
    return { payload: { type: "wallet_open_long", ...base }, notionalUsd };
  }
  if (fill.dir.startsWith("Open Short")) {
    return { payload: { type: "wallet_open_short", ...base }, notionalUsd };
  }
  if (fill.dir.startsWith("Close")) {
    return { payload: { type: "wallet_close_position", ...base }, notionalUsd };
  }
  return { payload: { type: "wallet_large_position_change", ...base }, notionalUsd };
}
