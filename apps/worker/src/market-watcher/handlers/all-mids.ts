import { coinPrices, type Database } from "@hypertracker/db";
import { wsAllMidsMessageSchema } from "@hypertracker/hyperliquid-sdk";
import { HEADER_TICKER_COINS } from "@hypertracker/shared";
import type { Logger } from "pino";

const TICKER_COINS = new Set<string>(HEADER_TICKER_COINS);

// allMids pushes on (roughly) every block — far more often than the header ticker needs.
// Throttled per coin instead of per message so a slow coin never blocks a fast one, and so
// coin_prices sees at most one write per coin per this interval regardless of how often
// Hyperliquid pushes.
const MIN_WRITE_INTERVAL_MS = 2_000;

export function createAllMidsHandler(db: Database, logger: Logger): (raw: unknown) => void {
  const lastWrittenAt = new Map<string, number>();

  return (raw: unknown) => {
    void handle(raw).catch((err: unknown) => {
      logger.error({ err }, "unhandled error processing allMids message");
    });
  };

  async function handle(raw: unknown): Promise<void> {
    const parsed = wsAllMidsMessageSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, "allMids message failed validation");
      return;
    }

    const now = Date.now();
    for (const coin of TICKER_COINS) {
      const midPrice = parsed.data.mids[coin];
      if (midPrice === undefined) continue;

      const lastWrite = lastWrittenAt.get(coin) ?? 0;
      if (now - lastWrite < MIN_WRITE_INTERVAL_MS) continue;
      lastWrittenAt.set(coin, now);

      await db
        .insert(coinPrices)
        .values({ symbol: coin, midPrice })
        .onConflictDoUpdate({
          target: coinPrices.symbol,
          set: { midPrice, updatedAt: new Date() },
        });
    }
  }
}
