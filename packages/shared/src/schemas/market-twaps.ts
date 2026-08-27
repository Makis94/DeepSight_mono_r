import { z } from "zod";
import { decimalString, tradeSide } from "./events.js";

// One real executed suborder of a market-wide TWAP order, returned on demand by
// GET /market-twaps/:twapId/slice-fills (apps/api) — which itself is a thin pass-through over
// Hyperliquid's own userTwapSliceFills REST endpoint (packages/hyperliquid-sdk
// getUserTwapSliceFills), filtered to the requested twapId. Not persisted anywhere — fetched
// fresh each time a user expands a market_twap row in the web table, since Hyperliquid's own
// API is already the source of truth and there is no need to duplicate its ~2000-fill window
// into our own storage.
export const twapSliceFillSchema = z.object({
  coin: z.string(),
  side: tradeSide,
  price: decimalString,
  size: decimalString,
  notionalUsd: decimalString,
  time: z.number(),
  oid: z.number(),
});
export type TwapSliceFill = z.infer<typeof twapSliceFillSchema>;

export const marketTwapSliceFillsResponseSchema = z.object({
  fills: z.array(twapSliceFillSchema),
});
export type MarketTwapSliceFillsResponse = z.infer<typeof marketTwapSliceFillsResponseSchema>;
