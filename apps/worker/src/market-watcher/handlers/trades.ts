import type { Database, NewEvent } from "@hypertracker/db";
import { wsTradesMessageSchema } from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";
import { publishEvent } from "../../shared/publish-event.js";
import { classifyTrade, isPerpTrade } from "../classify.js";
import type { RecentIdDedup } from "../dedup.js";

export function createTradesHandler(
  db: Database,
  dedup: RecentIdDedup,
  minNotionalUsd: number,
  logger: Logger,
): (raw: unknown) => void {
  return (raw: unknown) => {
    void handle(raw).catch((err: unknown) => {
      logger.error({ err }, "unhandled error processing trades message");
    });
  };

  async function handle(raw: unknown): Promise<void> {
    const parsed = wsTradesMessageSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, "trades message failed validation");
      return;
    }

    for (const trade of parsed.data) {
      if (dedup.hasSeen(trade.coin, trade.tid)) continue;
      dedup.markSeen(trade.coin, trade.tid);

      if (!isPerpTrade(trade)) continue;

      const classified = classifyTrade(trade);

      if (classified.notionalUsd < minNotionalUsd) continue;

      const event: Omit<NewEvent, "id" | "createdAt"> = {
        type: "market_trade",
        walletAddress: null,
        coin: trade.coin,
        side: classified.payload.side,
        amountUsd: classified.notionalUsd.toString(),
        payload: classified.payload,
        occurredAt: new Date(trade.time),
        // (block_time, coin, tid) is Hyperliquid's own globally-unique trade identity per
        // the WsTrade docs comment — coin + tid is enough here since dedup is per-coin
        // anyway and tid collisions across different coins are not a concern for the
        // externalId's uniqueness (it's scoped by coin in the string itself).
        externalId: `trade:${trade.coin}:${trade.tid}`,
      };

      try {
        await publishEvent(db, event);
      } catch (err) {
        logger.error(
          { err, coin: trade.coin, tid: trade.tid },
          "failed to publish market trade event",
        );
      }
    }
  }
}
