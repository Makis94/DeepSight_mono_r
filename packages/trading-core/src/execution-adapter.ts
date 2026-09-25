import { z } from "zod";
import { decimalString, tradeSide } from "@hypertracker/shared";

export const openPositionRequestSchema = z.object({
  // Our own trading_accounts.id (packages/db), never a raw exchange wallet address — the
  // adapter implementation is the only thing that resolves this to signing material.
  accountId: z.string(),
  coin: z.string(),
  side: tradeSide,
  sizeUsd: decimalString,
  // The touch price (best ask for a buy, best bid for a sell) the SL/TP levels below were
  // derived from. ONE price reference for the whole bracket: a paper adapter fills exactly
  // here; a live adapter would use it to anchor its limit price / slippage guard. Never a
  // separately-sourced (e.g. cached mid) price — two references is what produced brackets
  // born on the wrong side of their own entry (2026-09-25 audit).
  referencePx: decimalString,
  stopLossPx: decimalString,
  takeProfitPx: decimalString,
});
export type OpenPositionRequest = z.infer<typeof openPositionRequestSchema>;

export const openPositionResultSchema = z.object({
  externalOrderId: z.string(),
  entryPx: decimalString,
  filledSize: decimalString,
  stopLossOrderId: z.string().nullable(),
  takeProfitOrderId: z.string().nullable(),
});
export type OpenPositionResult = z.infer<typeof openPositionResultSchema>;

export const positionSnapshotSchema = z.object({
  coin: z.string(),
  side: tradeSide,
  // Base-asset quantity (e.g. BTC, not USD) — same unit as OpenPositionResult.filledSize
  // above, not the position's notional/dollar size. (code-review, 2026-09-23: an earlier
  // PaperExecutionAdapter.getPosition() returned sizeUsd here instead, silently mismatching
  // this field's own unit.)
  size: decimalString,
  entryPx: decimalString,
  unrealizedPnlUsd: decimalString,
  isOpen: z.boolean(),
});
export type PositionSnapshot = z.infer<typeof positionSnapshotSchema>;

// One implementation per exchange — e.g. packages/hyperliquid-sdk's live adapter (Phase B,
// not built yet) and apps/worker/src/auto-trader's PaperExecutionAdapter (Phase A, simulates
// fills/PnL without touching a real exchange). The trigger pipeline in
// apps/worker/src/auto-trader only ever calls this interface, never an exchange SDK
// directly, so promoting an account from paper to live (CLAUDE.md, 2026-09-22 decision) is a
// matter of swapping which adapter instance it's wired to, not a pipeline rewrite.
export interface ExecutionAdapter {
  readonly exchange: string;
  openPosition(request: OpenPositionRequest): Promise<OpenPositionResult>;
  closePosition(accountId: string, coin: string): Promise<void>;
  getPosition(accountId: string, coin: string): Promise<PositionSnapshot | null>;
}
