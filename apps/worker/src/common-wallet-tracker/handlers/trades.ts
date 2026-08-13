import type { Database, NewEvent } from "@hypertracker/db";
import {
  findPositionLeverageAndMargin,
  getClearinghouseState,
  wsTradesMessageSchema,
} from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";
import { publishEvent } from "../../shared/publish-event.js";
import { classifyTrade, isPerpTrade } from "../classify.js";
import type { RecentIdDedup } from "../dedup.js";
import { applyPositionDelta } from "../position-state.js";
import type { CommonWalletRegistry } from "../wallet-registry.js";

export function createTradesHandler(
  db: Database,
  dedup: RecentIdDedup,
  registry: CommonWalletRegistry,
  logger: Logger,
  restBaseUrl: string,
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
      if (!isPerpTrade(trade)) continue;

      const [buyerAddress, sellerAddress] = trade.users;
      const sides: Array<{ address: string; isBuyer: boolean }> = [
        { address: buyerAddress.toLowerCase(), isBuyer: true },
        { address: sellerAddress.toLowerCase(), isBuyer: false },
      ];

      for (const { address, isBuyer } of sides) {
        const threshold = registry.getMinTradeAmountUsd(address);
        if (threshold === undefined) continue; // not a common-mode watched wallet

        if (dedup.hasSeen(address, trade.tid)) continue;
        dedup.markSeen(address, trade.tid);

        const size = Number(trade.sz);
        const delta = isBuyer ? size : -size;

        let update;
        try {
          update = await applyPositionDelta(db, address, trade.coin, delta);
        } catch (err) {
          logger.error(
            { err, address, coin: trade.coin },
            "failed to update wallet_position_state",
          );
          continue;
        }

        const classified = classifyTrade(trade, isBuyer, update);
        if (classified.notionalUsd < threshold) continue;

        // Same HIP-3 dex-scoping as wallet-watcher's fills handler — clearinghouseState
        // defaults to the first/default dex unless told otherwise.
        const dexSeparatorIndex = trade.coin.indexOf(":");
        const dex = dexSeparatorIndex === -1 ? undefined : trade.coin.slice(0, dexSeparatorIndex);

        let payload = classified.payload;
        try {
          const state = await getClearinghouseState(restBaseUrl, address, dex);
          const leverageAndMargin = findPositionLeverageAndMargin(state, trade.coin);
          if (leverageAndMargin) {
            payload = { ...payload, ...leverageAndMargin };
          }
        } catch (err) {
          logger.warn(
            { err, address, coin: trade.coin },
            "failed to fetch leverage/margin for common-tracked trade — publishing without it",
          );
        }

        const event: Omit<NewEvent, "id" | "createdAt"> = {
          type: payload.type,
          walletAddress: address,
          coin: trade.coin,
          side: payload.side,
          amountUsd: classified.notionalUsd.toString(),
          payload,
          occurredAt: new Date(trade.time),
          // Distinct prefix from wallet-watcher's `fill:` externalIds — different
          // derivation path (public trades, not a private userFills stream) even though
          // both can in principle reference the same underlying trade.
          externalId: `common-trade:${address}:${trade.tid}`,
        };

        try {
          await publishEvent(db, event);
        } catch (err) {
          logger.error(
            { err, address, tid: trade.tid },
            "failed to publish common wallet trade event",
          );
        }
      }
    }
  }
}
