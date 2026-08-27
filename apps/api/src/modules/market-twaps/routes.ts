import { HYPERLIQUID_REST_URLS, getUserTwapSliceFills } from "@hypertracker/hyperliquid-sdk";
import { marketTwapSliceFillsResponseSchema, walletAddressSchema } from "@hypertracker/shared";
import type { Database } from "@hypertracker/db";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireActiveSubscription } from "../subscription/guard.js";

const paramsSchema = z.object({ twapId: z.coerce.number().int() });
const querySchema = z.object({ address: walletAddressSchema });

const network = process.env["HYPERLIQUID_NETWORK"] === "testnet" ? "testnet" : "mainnet";

/**
 * On-demand "view suborders" drill-down for a market_twap row (apps/web's market-twaps
 * table) — a thin pass-through over Hyperliquid's own userTwapSliceFills REST endpoint,
 * filtered to the requested twapId server-side. Deliberately not backed by any of our own
 * storage: Hyperliquid's REST response is already the source of truth for a specific
 * address's TWAP fills, and duplicating it into our DB would just be a second, staler copy
 * of the same ~2000-fill window. See packages/shared market-twaps.ts doc comment.
 */
export function marketTwapsRoutes(app: FastifyInstance, db: Database): void {
  app.get("/market-twaps/:twapId/slice-fills", async (request, reply) => {
    const session = await requireActiveSubscription(request, reply, db);
    if (!session) return;

    const params = paramsSchema.safeParse(request.params);
    const query = querySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      await reply.status(400).send({ error: "invalid twapId or address" });
      return;
    }

    let sliceFills: Awaited<ReturnType<typeof getUserTwapSliceFills>>;
    try {
      sliceFills = await getUserTwapSliceFills(HYPERLIQUID_REST_URLS[network], query.data.address);
    } catch (err) {
      request.log.error({ err, twapId: params.data.twapId }, "userTwapSliceFills lookup failed");
      await reply.status(502).send({ error: "failed to fetch slice fills from Hyperliquid" });
      return;
    }

    const matching = sliceFills.filter((entry) => entry.twapId === params.data.twapId);

    return marketTwapSliceFillsResponseSchema.parse({
      fills: matching.map(({ fill }) => ({
        coin: fill.coin,
        side: fill.side === "B" ? "buy" : "sell",
        price: fill.px,
        size: fill.sz,
        notionalUsd: Math.abs(Number(fill.px) * Number(fill.sz)).toString(),
        time: fill.time,
        oid: fill.oid,
      })),
    });
  });
}
