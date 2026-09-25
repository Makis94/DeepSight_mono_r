import { getL2Book } from "@hypertracker/hyperliquid-sdk";
import {
  Decimal,
  type BookLevel,
  type OrderBookSnapshot,
  type OrderBookSource,
} from "@hypertracker/trading-core";

/**
 * trading-core OrderBookSource implementation for Hyperliquid, backed by hyperliquid-sdk's
 * getL2Book (POST /info l2Book, on-demand per trigger — not polled/pooled, see getL2Book's
 * own doc comment). Fetched fresh per call, deliberately: order-book depth is only relevant
 * at the exact moment a trigger fires, and this only ever runs after every cheaper gate
 * (tier threshold, Trust Score, kill switch) has already passed (trigger-pipeline.ts).
 */
export class HyperliquidOrderBookSource implements OrderBookSource {
  readonly exchange = "hyperliquid";

  constructor(private readonly baseUrl: string) {}

  async getBook(coin: string): Promise<OrderBookSnapshot> {
    const l2Book = await getL2Book(this.baseUrl, coin);
    // levels: [bids, asks] (hyperliquid-docs MCP, verified 2026-09-22 — see rest-client.ts's
    // l2BookLevelSchema doc comment). Hyperliquid-specific {px, sz, n} -> trading-core's
    // exchange-agnostic {price, size} adaptation lives here, not in trading-core itself, per
    // the multi-exchange design (CLAUDE.md, 2026-09-22).
    const [bids, asks] = l2Book.levels;
    // The docs (verified 2026-09-25 by hyperliquid-api-reviewer) confirm levels = [bids, asks]
    // but never state that each side is sorted best-first. Index 0 of each side is now the
    // touch price the whole paper bracket is anchored to (entry, SL/TP, spread), so sort
    // explicitly instead of trusting an undocumented ordering: bids high->low, asks low->high.
    const toLevel = (level: { px: string; sz: string }): BookLevel => ({
      price: level.px,
      size: level.sz,
    });
    return {
      bids: bids.map(toLevel).sort((a, b) => new Decimal(b.price).comparedTo(a.price)),
      asks: asks.map(toLevel).sort((a, b) => new Decimal(a.price).comparedTo(b.price)),
    };
  }
}
