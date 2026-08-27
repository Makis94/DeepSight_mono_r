import { wsAllMidsMessageSchema } from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";

/**
 * In-memory-only cache of each coin's current mid price, fed by Hyperliquid's own public
 * `allMids` WS subscription (free, not user-specific, doesn't touch the 10-unique-user cap —
 * same subscription market-watcher already uses for the header ticker). Used only to
 * estimate a just-`activated` TWAP order's USD notional (size × mid price) at the moment it
 * opens, since QuickNode's TWAP dataset gives executedNtl (real USD) but that's still 0 at
 * activation — there's nothing else to size the order by yet. Resets on restart like every
 * other in-memory tracker in this codebase (RecentIdDedup, etc.) — acceptable since a fresh
 * price arrives within seconds of reconnecting.
 */
export class MidPriceCache {
  private readonly prices = new Map<string, number>();

  createAllMidsHandler(logger: Logger): (raw: unknown) => void {
    return (raw: unknown) => {
      const parsed = wsAllMidsMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ issues: parsed.error.issues }, "allMids message failed validation");
        return;
      }
      for (const [coin, price] of Object.entries(parsed.data.mids)) {
        const numeric = Number(price);
        if (Number.isFinite(numeric)) this.prices.set(coin, numeric);
      }
    };
  }

  get(coin: string): number | undefined {
    return this.prices.get(coin);
  }
}
