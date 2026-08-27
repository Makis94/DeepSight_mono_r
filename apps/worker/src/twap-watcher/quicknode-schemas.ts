import { z } from "zod";

// Wire shapes for QuickNode's HyperCore "TWAP" data stream (quicknode.com/docs/hyperliquid/
// datasets/twap), reached over WSS via `{"method":"hl_subscribe","params":{"streamType":
// "twap"}}`. This is a THIRD-PARTY product wrapping Hyperliquid's data — the CLAUDE.md
// hyperliquid-docs MCP verification rule doesn't apply to QuickNode's own docs.
//
// The OUTER envelope and INNER per-order event shape are both now CONFIRMED against a live
// connection (2026-08-27):
//   { "type": "data", "stream": "hl.twap_orders",
//     "block": { "local_time", "block_time", "block_number",
//       "events": [ { "time", "twap_id", "state": {...}, "status": "activated" | ... } ] } }
// (blocks are almost always empty — most captured blocks show `events: []` — so this only
// populates on an actual TWAP status transition, matching QuickNode's own docs description.)
//
// `status` on a successful order is a bare string ("activated"/"finished"/"terminated"), but
// two other variants have also been observed live:
//  - a failed-to-place order: `status` is an OBJECT, `{"error": "Insufficient margin to
//    place order."}`, not the plain enum. Mirrors Hyperliquid's own native TwapStatus enum
//    (packages/hyperliquid-sdk twapStatusSchema) having a 4th "error" value, just reshaped by
//    QuickNode into `{error: message}` instead of `{status:"error", description: message}`.
//  - a trigger/conditional order not yet live: `status: "waitingForTrigger"`, alongside a
//    non-null `state.trigger`/`state.stopPx` (both null on a normal TWAP) — sz/executedSz/
//    executedNtl are all still 0 at this point, nothing has opened yet.
// Both are treated as their own status below with nothing to notify on yet — twap-watcher/
// index.ts skips them (no notional check, no publish) rather than forcing them through the
// activated/finished/terminated schema.
//
// extractTwapEvents still logs+skips (never throws) any block entry that matches neither
// shape, so a future new variant is visible in logs rather than silently dropped.
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

// See module doc comment — a failed-to-place order reports `status` as `{error: message}`
// instead of a bare string; normalized to the literal "error" here so callers only ever
// switch on a flat string.
const quicknodeTwapStatusSchema = z.union([
  z.enum(["activated", "finished", "terminated", "waitingForTrigger"]),
  z.object({ error: z.string() }).transform(() => "error" as const),
]);

export const quicknodeTwapEventSchema = z.object({
  twap_id: z.number(),
  status: quicknodeTwapStatusSchema,
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
