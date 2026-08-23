import { getUserTwapSliceFills, type WsTwapSliceFill } from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";
import { tradeSide } from "./classify.js";
import type { TwapCandidate } from "./twap-heuristic.js";

// The heuristic's firstSeenAt/lastSeenAt bound only the *public trades* it happened to
// observe so far, not the real TWAP order's actual start/end (suborders can miss the trades
// feed's own matching, or the order can still be running past the streak's most recent
// observation) — this pad gives real slice-fill matching some slack around that window. This
// window is used ONLY to identify which real twapId a candidate corresponds to (see
// identifyTwapId) — once a twapId is known, pollTwapId below aggregates that twapId's full
// slice-fill history with no time bound, so a genuinely large/long-running TWAP is never
// truncated to whatever happened to land in this narrow identification window.
const MATCH_WINDOW_PAD_MS = 5 * 60_000;

// A single matching real slice fill isn't strong evidence on its own — the address could
// coincidentally be running an unrelated small real TWAP on the same coin/side that happens to
// land inside the padded window, while what the heuristic actually flagged was ordinary
// (non-TWAP) trading. Requiring at least 2 real fills under the same twapId is a cheap extra
// guard against attaching one candidate's data to a different real TWAP order.
const MIN_CONFIRMED_SLICE_FILLS = 2;

export type TwapIdentifyResult =
  // A matching real TWAP order was found — its twapId is now known and can be tracked by
  // pollTwapId going forward. lastFillTime seeds the "still running" grace check.
  | { status: "identified"; twapId: number; lastFillTime: number }
  // No confirmed match (yet) — either the REST lookup found nothing matching, or the lookup
  // itself failed (network/parse error). A "not_yet" from a real TWAP whose fills simply
  // haven't landed in Hyperliquid's history by this check, or from a transient API error, gets
  // a fresh look on the next tick as long as the streak stays alive; once it goes stale without
  // ever identifying a real twapId, twap-heuristic.ts prunes it silently. Most candidates that
  // land here are not TWAPs at all (an active trader/market-maker repeating similar-sized
  // trades looks identical to a TWAP on the public trades tape alone) — they simply have no
  // matching entries in that address's real TWAP slice-fill history and never will.
  | { status: "not_yet" };

/**
 * Identifies (or rejects) which real Hyperliquid TWAP order, if any, a heuristic candidate
 * corresponds to, by checking that address's real TWAP slice-fill history
 * (`getUserTwapSliceFills`, a one-off REST call — not a WS subscription, so it doesn't touch
 * the 10-unique-user cap and can be called for any address). This only identifies the twapId —
 * it deliberately does NOT compute a notional total to publish, because at identification time
 * the order may be nowhere near finished; see pollTwapId for that.
 */
export async function identifyTwapId(
  restBaseUrl: string,
  candidate: TwapCandidate,
  logger: Logger,
): Promise<TwapIdentifyResult> {
  let sliceFills: WsTwapSliceFill[];
  try {
    sliceFills = await getUserTwapSliceFills(restBaseUrl, candidate.address);
  } catch (err) {
    logger.warn(
      { err, address: candidate.address, coin: candidate.coin },
      "userTwapSliceFills lookup failed — not identifying, will retry on a later tick",
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

  const lastFillTime = Math.max(...bestGroup.map(({ fill }) => fill.time));
  return { status: "identified", twapId: bestTwapId, lastFillTime };
}

export interface TwapPollUpdate {
  notionalUsd: number;
  avgPrice: number;
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

/**
 * Re-aggregates a known-real twapId's full slice-fill history — no time window, unlike
 * identifyTwapId — so a TWAP that keeps running long after it was first identified is reflected
 * at its true accumulated size, not the fraction that happened to exist at identification time.
 * Returns null on lookup failure (caller retries on a later tick, same as identifyTwapId).
 */
export async function pollTwapId(
  restBaseUrl: string,
  address: string,
  twapId: number,
  logger: Logger,
): Promise<TwapPollUpdate | null> {
  let sliceFills: WsTwapSliceFill[];
  try {
    sliceFills = await getUserTwapSliceFills(restBaseUrl, address);
  } catch (err) {
    logger.warn(
      { err, address, twapId },
      "userTwapSliceFills lookup failed while polling active twap — will retry on a later tick",
    );
    return null;
  }

  const group = sliceFills.filter((entry) => entry.twapId === twapId);
  if (group.length === 0) {
    // Nothing found this time (e.g. fell out of the API's most-recent-2000 window) — leave the
    // tracked entry's existing totals untouched rather than zeroing them out.
    return null;
  }

  const notionalUsd = group.reduce((sum, { fill }) => sum + Number(fill.px) * Number(fill.sz), 0);
  const avgPrice = group.reduce((sum, { fill }) => sum + Number(fill.px), 0) / group.length;
  const times = group.map(({ fill }) => fill.time);

  return {
    notionalUsd,
    avgPrice,
    occurrences: group.length,
    firstSeenAt: Math.min(...times),
    lastSeenAt: Math.max(...times),
  };
}
