import { z } from "zod";
import { decimalString, tradeSide } from "@hypertracker/shared";

// Exchange-agnostic normalized TWAP signal. An implementation pairs this with its own
// ExecutionAdapter (see execution-adapter.ts) and maps that exchange's own wire format onto
// this shape — trading-core itself never sees Hyperliquid's "B"/"A" side letters, QuickNode's
// twap_id, or any other exchange-specific field name. See CLAUDE.md's "Hyperliquid-only for
// v1, multi-exchange-ready architecture" decision (2026-09-22).
export const twapSignalStatusSchema = z.enum([
  "activated",
  "finished",
  "stopped",
  "terminated",
  "error",
]);
export type TwapSignalStatus = z.infer<typeof twapSignalStatusSchema>;
// Deliberately excludes "waitingForTrigger" (QuickNode TWAP dataset status, verified
// 2026-09-20) — an order that hasn't started executing yet carries no price-impact/
// trust-score-worthy signal. A SignalSource implementation must not emit a TwapSignal for it.

export const twapSignalSchema = z.object({
  exchange: z.string(),
  // The signal source's own TWAP identifier, stringified (QuickNode's twap_id today).
  externalId: z.string(),
  wallet: z.string(),
  coin: z.string(),
  side: tradeSide,
  status: twapSignalStatusSchema,
  totalSize: decimalString,
  executedSize: decimalString,
  executedNotionalUsd: decimalString,
  durationMinutes: z.number().int().positive(),
  // Closes an existing position rather than expressing fresh directional intent. Per
  // CLAUDE.md's 2026-09-22 decision: NOT a trigger candidate, but still counted in
  // parallel-flow.ts's aggregation (its volume is still real market pressure).
  reduceOnly: z.boolean(),
  // When the underlying TWAP order was created (state.timestamp equivalent) — used for
  // trust-score.ts's decay and parallel-flow.ts's activatedAt.
  createdAt: z.date(),
  // When THIS particular status event happened (may differ from createdAt for every status
  // after "activated").
  occurredAt: z.date(),
});
export type TwapSignal = z.infer<typeof twapSignalSchema>;

// One implementation per exchange (e.g. packages/hyperliquid-sdk's QuickNode-backed one).
// apps/worker/src/auto-trader only ever talks to this interface, never an exchange SDK
// directly.
export interface SignalSource {
  readonly exchange: string;
  start(onSignal: (signal: TwapSignal) => void): void;
  stop(): void;
}
