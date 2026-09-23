import type { TrustScoreEventType } from "@hypertracker/shared";
import type { TwapSignal } from "@hypertracker/trading-core";

/**
 * Maps a terminal TwapSignal to spec §3's three Trust Score event types, or null if this
 * status shouldn't be scored at all.
 *
 * - "finished": the TWAP ran its natural course (never cancelled) -> fully_executed,
 *   regardless of whether it fully caught up to its target size — Hyperliquid's own docs
 *   (hyperliquid-docs MCP, "Order types", verified 2026-09-20) note a TWAP "may not fully
 *   catch up to the total size by the end" even when it finishes normally; that's a market-
 *   conditions outcome, not the wallet choosing to cancel, which is what spec §3 actually
 *   scores.
 * - "terminated": cancelled or otherwise ended before its window completed. executedSize=0
 *   -> cancelled_before_execution (spec: "large penalty"); executedSize>0 ->
 *   cancelled_mid_execution (spec: "smaller penalty").
 * - "stopped": ended because its OWN configured stopPx boundary was crossed — this is the
 *   wallet's own risk control doing its job, not a behavior worth penalizing, so it is
 *   deliberately NOT scored (null). Semantics per apps/worker/src/twap-watcher/
 *   quicknode-schemas.ts's doc comment, which is QuickNode's own product vocabulary
 *   (quicknode.com/docs/hyperliquid) — NOT covered by the hyperliquid-docs MCP verification
 *   rule (CLAUDE.md), and hyperliquid-api-reviewer confirmed it could not independently
 *   verify this specific meaning through its own tools (2026-09-22). Hyperliquid's own docs
 *   do confirm the underlying native concept exists ("Order types" page: a TWAP's "Max/Min
 *   Price... will be terminated when the mark price reaches the stop price set") — that
 *   makes the story plausible but does not itself confirm QuickNode's wire status string or
 *   its 1:1 mapping onto that concept. Re-confirm directly against QuickNode's own docs (or
 *   a live TWAP with non-null state.stopPx reaching "stopped") before trusting this for a
 *   live/Phase B scoring decision.
 * - "error": never actually placed (e.g. insufficient margin) — nothing to score, no
 *   execution behavior happened at all (null).
 * - "activated": not terminal, never reaches this function from the caller.
 */
export function classifyTrustScoreEvent(signal: TwapSignal): TrustScoreEventType | null {
  if (signal.status === "finished") return "fully_executed";
  if (signal.status === "terminated") {
    return Number(signal.executedSize) > 0
      ? "cancelled_mid_execution"
      : "cancelled_before_execution";
  }
  return null;
}
