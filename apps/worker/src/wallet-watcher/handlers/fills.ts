import type { Database, NewEvent } from "@hypertracker/db";
import {
  findPositionLeverageAndMargin,
  getClearinghouseState,
  wsUserFillsMessageSchema,
} from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";
import { publishEvent } from "../../shared/publish-event.js";
import { classifyFill, isPerpFill } from "../classify.js";
import type { RecentIdDedup } from "../dedup.js";
import type { SubscriptionManager } from "../subscription-manager.js";

export function createFillsHandler(
  db: Database,
  dedup: RecentIdDedup,
  subscriptions: SubscriptionManager,
  logger: Logger,
  restBaseUrl: string,
): (raw: unknown) => void {
  return (raw: unknown) => {
    void handle(raw).catch((err: unknown) => {
      logger.error({ err }, "unhandled error processing userFills message");
    });
  };

  async function handle(raw: unknown): Promise<void> {
    const parsed = wsUserFillsMessageSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, "userFills message failed validation");
      return;
    }

    const address = parsed.data.user.toLowerCase();
    const threshold = subscriptions.getMinTradeAmountUsd(address);
    if (threshold === undefined) return; // no longer watched (race with unsubscribe)

    for (const fill of parsed.data.fills) {
      if (dedup.hasSeen(address, fill.tid)) continue;
      dedup.markSeen(address, fill.tid);

      if (!isPerpFill(fill)) continue;
      if (!subscriptions.isCoinActive(fill.coin)) continue;

      const classified = classifyFill(fill);
      if (classified.notionalUsd < threshold) continue;

      // A fill carries neither leverage nor margin — both belong to the position, not the
      // trade — so fetch the position snapshot separately. Best-effort: if the position no
      // longer exists (typical for a full close) or the request fails, publish the event
      // without these fields rather than dropping it.
      // HIP-3 builder-deployed perps format `coin` as "{dex}:{coin}" (e.g. "xyz:XYZ100") —
      // clearinghouseState defaults to the first/default dex, so that dex must be passed
      // explicitly or the position lookup always misses for these assets.
      const dexSeparatorIndex = fill.coin.indexOf(":");
      const dex = dexSeparatorIndex === -1 ? undefined : fill.coin.slice(0, dexSeparatorIndex);

      let payload = classified.payload;
      try {
        const state = await getClearinghouseState(restBaseUrl, address, dex);
        const leverageAndMargin = findPositionLeverageAndMargin(state, fill.coin);
        if (leverageAndMargin) {
          payload = { ...payload, ...leverageAndMargin };
        }
      } catch (err) {
        logger.warn(
          { err, address, coin: fill.coin },
          "failed to fetch leverage/margin for fill — publishing without it",
        );
      }

      const event: Omit<NewEvent, "id" | "createdAt"> = {
        type: payload.type,
        walletAddress: address,
        coin: fill.coin,
        side: payload.side,
        amountUsd: classified.notionalUsd.toString(),
        payload,
        occurredAt: new Date(fill.time),
        // tid is Hyperliquid's own unique trade id, but the same trade produces a fill on
        // both counterparties' userFills streams — scope by address too so two watched
        // wallets on opposite sides of one trade don't collide on the same externalId.
        externalId: `fill:${address}:${fill.tid}`,
      };

      try {
        await publishEvent(db, event);
      } catch (err) {
        logger.error({ err, address, tid: fill.tid }, "failed to publish wallet fill event");
      }
    }
  }
}
