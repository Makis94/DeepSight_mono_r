import { getUserTwapSliceFills, type WsTwapSliceFill } from "@hypertracker/hyperliquid-sdk";
import type { MarketTwapSuspectedPayload } from "@hypertracker/shared";
import type { Logger } from "pino";
import { tradeSide } from "./classify.js";
import type { TwapCandidate } from "./twap-heuristic.js";

// The heuristic's firstSeenAt/lastSeenAt bound only the *public trades* it happened to
// observe, not the real TWAP order's actual start/end (suborders can miss the trades feed's
// own matching, or the order can still be running past the streak's most recent observation)
// — this pad gives real slice-fill matching some slack around that window instead of
// requiring an exact bound match.
const MATCH_WINDOW_PAD_MS = 5 * 60_000;

// A single matching real slice fill isn't strong enough evidence on its own — the address
// could coincidentally be running an unrelated small real TWAP on the same coin/side that
// happens to land inside the padded window, while what the heuristic actually flagged was
// ordinary (non-TWAP) trading. Requiring at least 2 real fills under the same twapId is a
// cheap extra guard against attaching one candidate's data to a different real TWAP order.
const MIN_CONFIRMED_SLICE_FILLS = 2;

export type TwapConfirmResult =
  // A matching real TWAP was found — publish immediately and call detector.markReported.
  | { status: "confirmed"; payload: MarketTwapSuspectedPayload }
  // No confirmed match (yet) — either the REST lookup found nothing matching, or the lookup
  // itself failed (network/parse error). Either way, this is NOT published: we don't guess.
  // A "not_yet" from a real TWAP whose fills simply haven't landed in Hyperliquid's history by
  // this check, or from a transient API error, gets a fresh look on the next tick as long as
  // the streak stays alive; once it goes stale without ever confirming, twap-heuristic.ts
  // prunes it silently. Most candidates that land here are not TWAPs at all (an active
  // trader/market-maker repeating similar-sized trades looks identical to a TWAP on the public
  // trades tape alone) — they simply have no matching entries in that address's real TWAP
  // slice-fill history and never will, so they age out unpublished.
  | { status: "not_yet" };

/**
 * Confirms (or rejects) a heuristic candidate against Hyperliquid's own real TWAP slice-fill
 * history for that specific address (`getUserTwapSliceFills`, a one-off REST call — not a WS
 * subscription, so it doesn't touch the 10-unique-user cap and can be called for any address).
 * See `marketTwapSuspectedPayloadSchema`'s doc comment: nothing is ever published without a
 * real, verified match — the pattern-match in twap-heuristic.ts only decides which addresses
 * are worth spending a REST call to check, it never on its own justifies showing anything.
 */
export async function confirmTwapCandidate(
  restBaseUrl: string,
  candidate: TwapCandidate,
  logger: Logger,
): Promise<TwapConfirmResult> {
  let sliceFills: WsTwapSliceFill[];
  try {
    sliceFills = await getUserTwapSliceFills(restBaseUrl, candidate.address);
  } catch (err) {
    logger.warn(
      { err, address: candidate.address, coin: candidate.coin },
      "userTwapSliceFills lookup failed — not publishing, will retry on a later tick",
    );
    return { status: "not_yet" };
  }

  const windowStart = candidate.firstSeenAt - MATCH_WINDOW_PAD_MS;
  const windowEnd = candidate.lastSeenAt + MATCH_WINDOW_PAD_MS;
  const matching = sliceFills.filter(
    ({ fill }) =>
      fill.coin === candidate.coin &&
      tradeSide(fill.side) === candidate.side &&
      fill.time >= windowStart &&
      fill.time <= windowEnd,
  );
  if (matching.length === 0) return { status: "not_yet" };

  // Two distinct TWAP orders on the same coin/side can overlap this window (e.g. back-to-back
  // TWAPs) — group by twapId and treat the largest group as the real counterpart of this
  // candidate streak, rather than merging unrelated orders into one inflated event.
  const byTwapId = new Map<number, WsTwapSliceFill[]>();
  for (const entry of matching) {
    const group = byTwapId.get(entry.twapId);
    if (group) group.push(entry);
    else byTwapId.set(entry.twapId, [entry]);
  }
  let bestTwapId: number | undefined;
  let bestGroup: WsTwapSliceFill[] = [];
  for (const [twapId, group] of byTwapId) {
    if (group.length > bestGroup.length) {
      bestTwapId = twapId;
      bestGroup = group;
    }
  }
  if (bestTwapId === undefined || bestGroup.length < MIN_CONFIRMED_SLICE_FILLS) {
    return { status: "not_yet" };
  }

  const notionalUsd = bestGroup.reduce(
    (sum, { fill }) => sum + Number(fill.px) * Number(fill.sz),
    0,
  );
  const avgPrice = bestGroup.reduce((sum, { fill }) => sum + Number(fill.px), 0) / bestGroup.length;
  const times = bestGroup.map(({ fill }) => fill.time);

  return {
    status: "confirmed",
    payload: {
      type: "market_twap_suspected",
      coin: candidate.coin,
      side: candidate.side,
      address: candidate.address,
      notionalUsd: notionalUsd.toString(),
      avgPrice: avgPrice.toString(),
      occurrences: bestGroup.length,
      firstSeenAt: Math.min(...times),
      lastSeenAt: Math.max(...times),
      twapId: bestTwapId,
    },
  };
}
