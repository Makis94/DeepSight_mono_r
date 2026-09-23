import type { BookLevel } from "./price-impact.js";

// Exchange-agnostic order book snapshot — sorted best-to-worst per side, same {price, size}
// shape estimatePriceImpact (price-impact.ts) already expects. Bids highest-to-lowest, asks
// lowest-to-highest (matches Hyperliquid's own l2Book convention, hyperliquid-docs MCP,
// verified 2026-09-22 — see packages/hyperliquid-sdk/src/rest-client.ts's l2BookLevelSchema
// doc comment for the source).
export interface OrderBookSnapshot {
  bids: readonly BookLevel[];
  asks: readonly BookLevel[];
}

// One implementation per exchange (e.g. apps/worker/src/auto-trader's
// HyperliquidOrderBookSource, backed by hyperliquid-sdk's getL2Book). The trigger pipeline in
// apps/worker/src/auto-trader only ever calls this interface, never an exchange SDK directly
// (code-review, 2026-09-23 — trigger-pipeline.ts previously called hyperliquid-sdk's
// getL2Book/HYPERLIQUID_REST_URLS directly, contradicting this same promise already made for
// SignalSource/ExecutionAdapter), so a future second exchange only needs a new
// OrderBookSource implementation, not a trigger-pipeline.ts rewrite.
export interface OrderBookSource {
  readonly exchange: string;
  getBook(coin: string): Promise<OrderBookSnapshot>;
}
