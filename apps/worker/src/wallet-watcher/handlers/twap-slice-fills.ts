import type { Database, NewEvent } from "@hypertracker/db";
import { wsUserTwapSliceFillsMessageSchema } from "@hypertracker/hyperliquid-sdk";
import type { WalletTwapSlicePayload } from "@hypertracker/shared";
import type { Logger } from "pino";
import { publishEvent } from "../../shared/publish-event.js";
import { fillSide, isPerpFill } from "../classify.js";
import type { RecentIdDedup } from "../dedup.js";
import type { SubscriptionManager } from "../subscription-manager.js";

/**
 * Real per-suborder TWAP fills for precise-mode watched wallets (userTwapSliceFills) —
 * distinct from twap.ts's userTwapHistory handler, which only tracks the overall order's
 * status transitions. Each message here is one actually-executed suborder with a real
 * price/size/oid, grouped by twapId.
 */
export function createTwapSliceFillsHandler(
  db: Database,
  dedup: RecentIdDedup,
  subscriptions: SubscriptionManager,
  logger: Logger,
): (raw: unknown) => void {
  return (raw: unknown) => {
    void handle(raw).catch((err: unknown) => {
      logger.error({ err }, "unhandled error processing userTwapSliceFills message");
    });
  };

  async function handle(raw: unknown): Promise<void> {
    const parsed = wsUserTwapSliceFillsMessageSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, "userTwapSliceFills message failed validation");
      return;
    }

    const address = parsed.data.user.toLowerCase();
    const threshold = subscriptions.getMinTradeAmountUsd(address);
    if (threshold === undefined) return; // no longer watched (race with unsubscribe)

    for (const { fill, twapId } of parsed.data.twapSliceFills) {
      if (dedup.hasSeen(address, fill.tid)) continue;
      dedup.markSeen(address, fill.tid);

      if (!isPerpFill(fill)) continue;
      if (!subscriptions.isCoinActive(fill.coin)) continue;

      const notionalUsd = Math.abs(Number(fill.px) * Number(fill.sz));
      if (notionalUsd < threshold) continue;

      const payload: WalletTwapSlicePayload = {
        type: "wallet_twap_slice_fill",
        coin: fill.coin,
        side: fillSide(fill.side),
        price: fill.px,
        size: fill.sz,
        twapId,
        oid: fill.oid,
      };

      const event: Omit<NewEvent, "id" | "createdAt"> = {
        type: "wallet_twap_slice_fill",
        walletAddress: address,
        coin: fill.coin,
        side: payload.side,
        amountUsd: notionalUsd.toString(),
        payload,
        occurredAt: new Date(fill.time),
        // Same tid-scoped-by-address reasoning as fills.ts's externalId — tid alone is
        // Hyperliquid's globally unique fill id, but scoping by address keeps this
        // producer's externalId space visibly distinct from fills.ts's "fill:" ids.
        externalId: `twap-slice:${address}:${fill.tid}`,
      };

      try {
        await publishEvent(db, event);
      } catch (err) {
        logger.error(
          { err, address, tid: fill.tid },
          "failed to publish wallet twap slice fill event",
        );
      }
    }
  }
}
