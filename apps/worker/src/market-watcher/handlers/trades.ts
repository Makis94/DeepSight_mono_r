import type { Database, NewEvent } from "@hypertracker/db";
import { wsTradesMessageSchema } from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";
import { publishEvent } from "../../shared/publish-event.js";
import { classifyTrade, isPerpTrade } from "../classify.js";
import type { RecentIdDedup } from "../dedup.js";
import type { TwapPatternDetector } from "../twap-heuristic.js";

export function createTradesHandler(
  db: Database,
  dedup: RecentIdDedup,
  minNotionalUsd: number,
  twapDetector: TwapPatternDetector,
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
      const price = Number(trade.px);
      const size = Number(trade.sz);

      // Fed with EVERY perp trade regardless of notional — deliberately ahead of the
      // minNotionalUsd filter below. A real TWAP suborder is typically far smaller than any
      // single-trade large-trade threshold (e.g. a $10k/1h TWAP is ~$83 suborders), so
      // filtering first would make the detector blind to exactly what it needs to see.
      // Always observe both sides — using `??` here would short-circuit the seller
      // observation whenever the buyer side already produced a detection, silently dropping
      // that trade from the seller's streak.
      const buyDetection = twapDetector.observe({
        coin: trade.coin,
        side: "buy",
        address: classified.payload.buyerAddress,
        price,
        size,
        time: trade.time,
      });
      const sellDetection = twapDetector.observe({
        coin: trade.coin,
        side: "sell",
        address: classified.payload.sellerAddress,
        price,
        size,
        time: trade.time,
      });
      const twapDetection = buyDetection ?? sellDetection;

      if (twapDetection) {
        const twapEvent: Omit<NewEvent, "id" | "createdAt"> = {
          type: "market_twap_suspected",
          walletAddress: null,
          coin: twapDetection.coin,
          side: twapDetection.side,
          amountUsd: twapDetection.notionalUsd,
          payload: twapDetection,
          occurredAt: new Date(twapDetection.lastSeenAt),
          externalId: `twap-heuristic:${twapDetection.coin}:${twapDetection.address}:${twapDetection.side}:${twapDetection.firstSeenAt}`,
        };
        try {
          await publishEvent(db, twapEvent);
        } catch (err) {
          logger.error(
            { err, coin: twapDetection.coin, address: twapDetection.address },
            "failed to publish market_twap_suspected event",
          );
        }
      }

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
