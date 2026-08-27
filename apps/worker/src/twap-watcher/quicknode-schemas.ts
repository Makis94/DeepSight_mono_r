import { z } from "zod";

// Wire shapes for QuickNode's HyperCore "TWAP" data stream (quicknode.com/docs/hyperliquid/
// datasets/twap), reached over WSS via `{"method":"hl_subscribe","params":{"streamType":
// "twap"}}`. This is a THIRD-PARTY product wrapping Hyperliquid's data — the CLAUDE.md
// hyperliquid-docs MCP verification rule doesn't apply to QuickNode's own docs.
//
// The OUTER envelope below is CONFIRMED against a live connection (2026-08-27):
//   { "type": "data", "stream": "hl.twap_orders",
//     "block": { "local_time", "block_time", "block_number", "events": [] } }
// (blocks are almost always empty — see collectCandidates-era doc history — so a live
// capture so far has only ever shown `events: []`.)
//
// The INNER per-order event shape (twap_id/status/state when `events` is non-empty) is
// still this module's best inference from QuickNode's docs prose, NOT yet confirmed from a
// live populated array — extractTwapEvents logs+skips (never throws) any block whose
// `events` entries don't match quicknodeTwapEventSchema, so a real TWAP activation that
// doesn't parse is visible in logs rather than silently dropped. Once one is observed live,
// correct quicknodeTwapEventSchema/quicknodeTwapStateSchema below to match and remove this
// comment.
export const quicknodeTwapStateSchema = z.object({
  coin: z.string(),
  user: z.string(),
  side: z.string(),
  sz: z.string(),
  executedSz: z.string(),
  executedNtl: z.string(),
  minutes: z.number(),
  reduceOnly: z.boolean(),
  randomize: z.boolean(),
  timestamp: z.number().optional(),
});
export type QuicknodeTwapState = z.infer<typeof quicknodeTwapStateSchema>;

export const quicknodeTwapEventSchema = z.object({
  twap_id: z.number(),
  status: z.enum(["activated", "finished", "terminated"]),
  state: quicknodeTwapStateSchema,
});
export type QuicknodeTwapEvent = z.infer<typeof quicknodeTwapEventSchema>;

// Confirmed live (2026-08-27) — see module doc comment.
const quicknodeBlockMessageSchema = z.object({
  type: z.literal("data"),
  stream: z.string(),
  block: z.object({
    local_time: z.string(),
    block_time: z.string(),
    block_number: z.number(),
    events: z.array(z.unknown()),
  }),
});

export interface ExtractedTwapEvents {
  events: QuicknodeTwapEvent[];
  // Raw entries from `block.events` that failed to parse against quicknodeTwapEventSchema —
  // surfaced (not just counted) so the caller can log their actual content for visibility
  // while that inner shape is still unconfirmed from a live populated block (see module doc
  // comment), instead of silently dropping a real TWAP activation that doesn't match our
  // best-guess shape.
  unparsed: unknown[];
}

/**
 * Extracts TWAP order events from a raw parsed WS message. Returns `null` (not a throw) if
 * the message doesn't match the confirmed block envelope at all — callers should treat that
 * as "not a TWAP-events frame" (e.g. a subscribe ack), not an error.
 */
export function extractTwapEvents(raw: unknown): ExtractedTwapEvents | null {
  const block = quicknodeBlockMessageSchema.safeParse(raw);
  if (!block.success) return null;

  const events: QuicknodeTwapEvent[] = [];
  const unparsed: unknown[] = [];
  for (const entry of block.data.block.events) {
    const parsed = quicknodeTwapEventSchema.safeParse(entry);
    if (parsed.success) events.push(parsed.data);
    else unparsed.push(entry);
  }
  return { events, unparsed };
}
