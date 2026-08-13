import { z } from "zod";

// Shapes verified against hyperliquid-docs MCP
// (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions),
// verified: 2026-07-27.

export const wsFillSchema = z.object({
  coin: z.string(),
  px: z.string(),
  sz: z.string(),
  side: z.string(),
  time: z.number(),
  startPosition: z.string(),
  // Hyperliquid's own human-readable direction, e.g. "Open Long", "Close Short" — this is
  // what wallet-watcher's classifier keys off of instead of re-deriving direction itself.
  dir: z.string(),
  closedPnl: z.string(),
  hash: z.string(),
  oid: z.number(),
  crossed: z.boolean(),
  fee: z.string(),
  tid: z.number(),
  feeToken: z.string(),
});
export type WsFill = z.infer<typeof wsFillSchema>;

// `userFills` (not `userEvents`) is used deliberately: its messages carry a `user` field,
// so multiple watched addresses can share one WS connection and still be routed correctly.
// `userEvents`' data format has no such field (its channel is also oddly named "user", not
// "userEvents") which would make demuxing multiple addresses on one connection ambiguous.
export const wsUserFillsMessageSchema = z.object({
  isSnapshot: z.boolean().optional(),
  user: z.string(),
  fills: z.array(wsFillSchema),
});
export type WsUserFillsMessage = z.infer<typeof wsUserFillsMessageSchema>;

export const twapStatusSchema = z.enum(["activated", "terminated", "finished", "error"]);
export type TwapStatus = z.infer<typeof twapStatusSchema>;

// sz/executedSz/executedNtl verified against a live `userTwapHistory` WS message
// (2026-07-28) to be decimal STRINGS ("0.1256", "21.30204", ...) — the docs' TypeScript
// interface pseudocode annotates them as `number`, which does not match the real wire
// format. Trust the observed payload over the docs' type annotation here.
export const twapStateSchema = z.object({
  coin: z.string(),
  user: z.string(),
  side: z.string(),
  sz: z.string(),
  executedSz: z.string(),
  executedNtl: z.string(),
  minutes: z.number(),
  reduceOnly: z.boolean(),
  randomize: z.boolean(),
  timestamp: z.number(),
});
export type TwapState = z.infer<typeof twapStateSchema>;

export const wsTwapHistoryEntrySchema = z.object({
  state: twapStateSchema,
  // `description` does not actually appear in live messages (only `status` does) despite
  // being in the docs' example — verified 2026-07-28, made optional rather than assumed.
  status: z.object({ status: twapStatusSchema, description: z.string().optional() }),
  time: z.number(),
});
export type WsTwapHistoryEntry = z.infer<typeof wsTwapHistoryEntrySchema>;

export const wsUserTwapHistoryMessageSchema = z.object({
  isSnapshot: z.boolean().optional(),
  user: z.string(),
  history: z.array(wsTwapHistoryEntrySchema),
});
export type WsUserTwapHistoryMessage = z.infer<typeof wsUserTwapHistoryMessageSchema>;

export const wsTradeSchema = z.object({
  coin: z.string(),
  side: z.string(),
  px: z.string(),
  sz: z.string(),
  hash: z.string(),
  time: z.number(),
  tid: z.number(),
  users: z.tuple([z.string(), z.string()]),
});
export type WsTrade = z.infer<typeof wsTradeSchema>;

// The `trades` channel's `data` field is a bare WsTrade[] (not wrapped in an object like
// userFills/userTwapHistory) — source: hyperliquid-docs MCP (websocket/subscriptions page),
// verified: 2026-07-31.
export const wsTradesMessageSchema = z.array(wsTradeSchema);
export type WsTradesMessage = z.infer<typeof wsTradesMessageSchema>;

// interface AllMids { mids: Record<string, string> } — one shared subscription for every
// coin's current mid price (decimal string), not user-specific, so it doesn't count against
// the 10-unique-user WS cap the way userFills/userTwapHistory subscriptions do. `dex` is
// optional — omitted here since this project only trades perps on the default/first dex.
// source: hyperliquid-docs MCP (websocket/subscriptions page), verified: 2026-08-11.
export const wsAllMidsMessageSchema = z.object({
  mids: z.record(z.string(), z.string()),
});
export type WsAllMidsMessage = z.infer<typeof wsAllMidsMessageSchema>;

export type HyperliquidSubscription =
  | { type: "userFills"; user: string; aggregateByTime?: boolean }
  | { type: "userTwapHistory"; user: string }
  | { type: "trades"; coin: string }
  | { type: "allMids"; dex?: string };

export const wsEnvelopeSchema = z.object({
  channel: z.string(),
  data: z.unknown(),
});

// source: hyperliquid-docs MCP (info-endpoint/perpetuals — clearinghouseState response
// example), verified: 2026-07-28, fields extended (entryPx/liquidationPx/positionValue/
// returnOnEquity/unrealizedPnl/szi/maxLeverage) verified: 2026-07-31 for the open-positions
// table. cumFunding is still dropped — nothing consumes it yet.
export const positionLeverageSchema = z.object({
  type: z.enum(["cross", "isolated"]),
  value: z.number().int().positive(),
});

export const assetPositionSchema = z.object({
  position: z.object({
    coin: z.string(),
    leverage: positionLeverageSchema,
    // decimal string — USD margin currently held against this position.
    marginUsed: z.string(),
    entryPx: z.string(),
    // Absent when the position can't be liquidated in isolation (fully cross-collateralized
    // in some account states) — docs' own example always has it, but not documented as
    // always-present, so treat as optional rather than assume.
    liquidationPx: z.string().nullable().optional(),
    positionValue: z.string(),
    returnOnEquity: z.string(),
    unrealizedPnl: z.string(),
    // Signed size — positive for long, negative for short (see notation page).
    szi: z.string(),
    maxLeverage: z.number().int().positive(),
  }),
});

export const clearinghouseStateSchema = z.object({
  assetPositions: z.array(assetPositionSchema),
});
export type ClearinghouseState = z.infer<typeof clearinghouseStateSchema>;
