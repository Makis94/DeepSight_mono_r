import type { TwapTier } from "@hypertracker/shared";

// PLACEHOLDER — NOT CONFIRMED BY THE CUSTOMER. CLAUDE.md spec §2 gives only two worked
// examples per tier (Tier A: "ZEC, HYPE and similar"; Tier B: "ARB, UNI and similar") and
// explicitly leaves the full membership of each tier as an open question ("Dev task:
// implement a threshold-normalization formula... not a fixed number for all assets in the
// tier" — the FORMULA is packages/trading-core's tier-thresholds.ts, already built; this
// list of WHICH coins get normalized against WHICH tier's base is a separate, still-open
// product decision). Every coin not listed here falls through to `DEFAULT_TIER` below rather
// than being silently skipped — see classifyCoin()'s doc comment for why that default was
// chosen. Extend this list (do not restructure it) once the customer confirms the full
// membership.
const TIER_A_COINS = new Set(["ZEC", "HYPE"]);
const TIER_B_COINS = new Set(["ARB", "UNI"]);

// Falls back to the stricter tier ($500k/5min-equivalent) for any coin not explicitly
// classified — spec §2's two tiers exist to let LESS liquid assets trigger at a LOWER bar,
// not to give unlisted coins a free pass at the lower bar by default. An unclassified coin
// still gets evaluated (via tier-thresholds.ts's own volume-based normalization off Tier A's
// base), just never favored with Tier B's easier threshold until it's explicitly confirmed
// as belonging there.
const DEFAULT_TIER: TwapTier = "A";

export interface TierBaseConfigInput {
  tier: TwapTier;
  baseCoin: string;
  // Decimal string — money (CLAUDE.md). baseWindowMinutes stays `number`, it's a duration.
  baseThresholdUsd: string;
  baseWindowMinutes: number;
}

// Spec §2's own worked numbers (CLAUDE.md, verified against the spec text, not calibrated
// beyond what the customer actually wrote): Tier A base = ZEC >= $500,000/5min, Tier B base
// = ARB >= $300,000/5min. baseDayNtlVlm is intentionally absent here — it's live market
// data, fetched by market-data-cache.ts and merged in at evaluation time, not configuration.
export const TIER_BASES: Record<TwapTier, TierBaseConfigInput> = {
  A: { tier: "A", baseCoin: "ZEC", baseThresholdUsd: "500000", baseWindowMinutes: 5 },
  B: { tier: "B", baseCoin: "ARB", baseThresholdUsd: "300000", baseWindowMinutes: 5 },
};

export function classifyCoin(coin: string): TwapTier {
  if (TIER_A_COINS.has(coin)) return "A";
  if (TIER_B_COINS.has(coin)) return "B";
  return DEFAULT_TIER;
}
