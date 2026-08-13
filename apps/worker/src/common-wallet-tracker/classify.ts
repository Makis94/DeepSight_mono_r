import type { WsTrade } from "@hypertracker/hyperliquid-sdk";
import type {
  WalletClosePositionPayload,
  WalletLargePositionChangePayload,
  WalletOpenLongPayload,
  WalletOpenShortPayload,
} from "@hypertracker/shared";
import type { PositionUpdate } from "./position-state.js";

export interface ClassifiedTrade {
  payload:
    | WalletOpenLongPayload
    | WalletOpenShortPayload
    | WalletClosePositionPayload
    | WalletLargePositionChangePayload;
  notionalUsd: number;
}

// Spot trades use a coin format like "@107" or "PURR/USDC" — same convention as
// wallet-watcher's isPerpFill / market-watcher's isPerpTrade.
export function isPerpTrade(trade: WsTrade): boolean {
  return !trade.coin.startsWith("@") && !trade.coin.includes("/");
}

/**
 * There is no Hyperliquid-native `dir` on the public `trades` feed (that's a WsFill-only
 * field) — classification here comes entirely from diffing wallet_position_state
 * (`update`, computed by position-state.ts) against the trade side, positive = long:
 *   - previous 0, new != 0            -> open (long if new > 0, else short)
 *   - previous != 0, new 0            -> close
 *   - anything else (same-sign resize, or a sign flip that doesn't land exactly on 0)
 *     -> large_position_change, mirroring wallet-watcher classify.ts's own catch-all for
 *        everything that isn't a clean open/close. A same-trade flip (e.g. +10 -> -5) is a
 *        real simplification here: Hyperliquid would report that as a close + a separate
 *        open, but the public trades feed gives us one row, so it's reported as a single
 *        large_position_change rather than synthesizing two events out of one trade.
 */
export function classifyTrade(
  trade: WsTrade,
  walletIsBuyer: boolean,
  update: PositionUpdate,
): ClassifiedTrade {
  const notionalUsd = Math.abs(Number(trade.px) * Number(trade.sz));
  const base = {
    coin: trade.coin,
    side: walletIsBuyer ? ("buy" as const) : ("sell" as const),
    price: trade.px,
    size: trade.sz,
    startPosition: update.previousSignedSize.toString(),
    notionalUsd: notionalUsd.toString(),
    source: "common" as const,
  };

  const { previousSignedSize, newSignedSize } = update;

  if (previousSignedSize === 0 && newSignedSize !== 0) {
    return newSignedSize > 0
      ? { payload: { type: "wallet_open_long", ...base }, notionalUsd }
      : { payload: { type: "wallet_open_short", ...base }, notionalUsd };
  }
  if (previousSignedSize !== 0 && newSignedSize === 0) {
    return { payload: { type: "wallet_close_position", ...base }, notionalUsd };
  }
  return { payload: { type: "wallet_large_position_change", ...base }, notionalUsd };
}
