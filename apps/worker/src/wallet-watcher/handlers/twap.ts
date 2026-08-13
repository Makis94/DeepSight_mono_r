import type { Database, NewEvent } from "@hypertracker/db";
import {
  findPositionLeverageAndMargin,
  getClearinghouseState,
  wsUserTwapHistoryMessageSchema,
} from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";
import { publishEvent } from "../../shared/publish-event.js";
import { fillSide } from "../classify.js";
import type { RecentIdDedup } from "../dedup.js";
import type { SubscriptionManager } from "../subscription-manager.js";

export function createTwapHandler(
  db: Database,
  dedup: RecentIdDedup,
  subscriptions: SubscriptionManager,
  logger: Logger,
  restBaseUrl: string,
): (raw: unknown) => void {
  return (raw: unknown) => {
    void handle(raw).catch((err: unknown) => {
      logger.error({ err }, "unhandled error processing userTwapHistory message");
    });
  };

  async function handle(raw: unknown): Promise<void> {
    const parsed = wsUserTwapHistoryMessageSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, "userTwapHistory message failed validation");
      return;
    }

    const address = parsed.data.user.toLowerCase();
    const threshold = subscriptions.getMinTradeAmountUsd(address);
    if (threshold === undefined) return;

    for (const entry of parsed.data.history) {
      const { state, status } = entry;
      // Hyperliquid's response has no explicit TWAP id — (coin, timestamp, status) is the
      // best available composite key to dedup a specific TWAP order's status transitions.
      const dedupKey = `${state.coin}:${state.timestamp}:${status.status}`;
      if (dedup.hasSeen(address, dedupKey)) continue;
      dedup.markSeen(address, dedupKey);

      if (!subscriptions.isCoinActive(state.coin)) continue;

      // executedNtl is the only field here already denominated in USD — sz/executedSz are
      // base-asset quantity (e.g. ETH), not comparable to a USD threshold.
      const notionalUsd = Math.abs(Number(state.executedNtl));
      if (notionalUsd < threshold) continue;

      const side = fillSide(state.side);

      let payload = {
        type: "wallet_twap" as const,
        coin: state.coin,
        side,
        size: state.sz,
        executedSize: state.executedSz,
        minutes: state.minutes,
        status: status.status,
      };
      try {
        const dexSeparatorIndex = state.coin.indexOf(":");
        const dex = dexSeparatorIndex === -1 ? undefined : state.coin.slice(0, dexSeparatorIndex);
        const clearinghouseState = await getClearinghouseState(restBaseUrl, address, dex);
        const leverageAndMargin = findPositionLeverageAndMargin(clearinghouseState, state.coin);
        if (leverageAndMargin) {
          payload = { ...payload, ...leverageAndMargin };
        }
      } catch (err) {
        logger.warn(
          { err, address, coin: state.coin },
          "failed to fetch leverage/margin for twap update — publishing without it",
        );
      }

      const event: Omit<NewEvent, "id" | "createdAt"> = {
        type: "wallet_twap",
        walletAddress: address,
        coin: state.coin,
        side,
        amountUsd: notionalUsd.toString(),
        payload,
        // `entry.time` is Unix SECONDS (verified against a live message, 2026-07-28) —
        // `state.timestamp` is the millisecond form of the same instant; using entry.time
        // directly here previously produced dates near the 1970 epoch.
        occurredAt: new Date(state.timestamp),
        externalId: `twap:${address}:${dedupKey}`,
      };

      try {
        await publishEvent(db, event);
      } catch (err) {
        logger.error({ err, address, dedupKey }, "failed to publish wallet twap event");
      }
    }
  }
}
