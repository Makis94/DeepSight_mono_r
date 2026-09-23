import { Decimal, money } from "./money.js";

// Combines every multiplier from spec §5/§7 into the final position size, then clamps to the
// account's own risk limit (packages/db risk-limits.maxPositionUsd) as the last, unconditional
// step — enforced again independently by apps/worker's risk-guard before any live order
// (defense in depth, not a substitute for it).
export interface PositionSizingInputs {
  // Decimal strings (CLAUDE.md: money is never number/float) — trustMultiplier/
  // counterFlowMultiplier stay plain `number` since they're dimensionless ratios, not money.
  baseSizeUsd: string;
  // trust-score.ts's scoreToSizeMultiplier() output for the signalling wallet.
  trustMultiplier: number;
  // parallel-flow.ts's computeCounterFlowAdjustment() output's sizeMultiplier.
  counterFlowMultiplier: number;
  maxPositionUsd: string;
}

export function computePositionSizeUsd(inputs: PositionSizingInputs): string {
  const raw = money(inputs.baseSizeUsd)
    .times(inputs.trustMultiplier)
    .times(inputs.counterFlowMultiplier);
  const clamped = Decimal.max(0, Decimal.min(raw, money(inputs.maxPositionUsd)));
  return clamped.toString();
}
