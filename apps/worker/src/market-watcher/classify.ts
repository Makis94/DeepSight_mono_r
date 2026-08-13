import type { WsTrade } from "@hypertracker/hyperliquid-sdk";
import type { MarketTradePayload } from "@hypertracker/shared";

export interface ClassifiedTrade {
  payload: MarketTradePayload;
  notionalUsd: number;
}

// source: hyperliquid-docs MCP (notation page), verified: 2026-07-31 — "B" = Bid = Buy,
// "A" = Ask = Short/Sell; side is the aggressing side for trades. Same convention as
// wallet-watcher's WsFill.side.
export function tradeSide(side: string): "buy" | "sell" {
  return side === "B" ? "buy" : "sell";
}

// Spot trades use a coin format like "@107" or "PURR/USDC" — large-trade monitoring is
// scoped to the top-250-CMC-intersected perp universe (coin_registry), so spot activity is
// skipped entirely, mirroring wallet-watcher's isPerpFill.
export function isPerpTrade(trade: WsTrade): boolean {
  return !trade.coin.startsWith("@") && !trade.coin.includes("/");
}

export function classifyTrade(trade: WsTrade): ClassifiedTrade {
  const notionalUsd = Math.abs(Number(trade.px) * Number(trade.sz));
  const [buyer, seller] = trade.users;
  return {
    payload: {
      type: "market_trade",
      coin: trade.coin,
      side: tradeSide(trade.side),
      price: trade.px,
      size: trade.sz,
      buyerAddress: buyer.toLowerCase(),
      sellerAddress: seller.toLowerCase(),
    },
    notionalUsd,
  };
}
