import type { EventPayload } from "@hypertracker/shared/schemas/events";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";

const POSITION_FIELD_TYPES = new Set([
  "wallet_open_long",
  "wallet_open_short",
  "wallet_close_position",
  "wallet_large_position_change",
]);

// dir (Hyperliquid's own human label, e.g. "Open Long") and closedPnl/startPosition (the
// position's size before this fill) only exist on these 4 payload types — not on
// wallet_twap/deposit/withdrawal/funding, which still land in the same whale feed.
export function hasPositionFields(payload: EventPayload): payload is Extract<
  EventPayload,
  {
    type:
      | "wallet_open_long"
      | "wallet_open_short"
      | "wallet_close_position"
      | "wallet_large_position_change";
  }
> {
  return POSITION_FIELD_TYPES.has(payload.type);
}

export function isMarketTrade(
  payload: EventPayload,
): payload is Extract<EventPayload, { type: "market_trade" }> {
  return payload.type === "market_trade";
}

export function isMarketTwap(
  payload: EventPayload,
): payload is Extract<EventPayload, { type: "market_twap" }> {
  return payload.type === "market_twap";
}

export function isGlobalDeposit(
  payload: EventPayload,
): payload is Extract<EventPayload, { type: "global_deposit" }> {
  return payload.type === "global_deposit";
}

export type Tone = "long" | "short" | "neutral";

export interface Activity {
  label: string;
  tone: Tone;
}

// Only present for source: "precise" fills (a real Hyperliquid WsFill.dir) — source:
// "common" fills (apps/worker/src/common-wallet-tracker, matched off the public trades feed
// rather than a private per-user subscription) have no such native label, so fall back to
// a label synthesized from `type` — our own classification, already computed either way.
const FALLBACK_LABELS: Record<string, string> = {
  wallet_open_long: "Open Long",
  wallet_open_short: "Open Short",
  wallet_close_position: "Close Position",
  wallet_large_position_change: "Position Change",
};

// Every whale-feed row reduces to one label + a bullish/bearish/neutral tone for the row
// tint — long-side action reads green, short-side reads red, regardless of open vs close,
// matching the convention of trading-terminal whale trackers.
export function getActivity(event: RealtimeEvent): Activity {
  const payload = event.payload;
  if (hasPositionFields(payload)) {
    let tone: Tone;
    if (payload.dir) {
      tone = payload.dir.includes("Short")
        ? "short"
        : payload.dir.includes("Long")
          ? "long"
          : "neutral";
    } else {
      // No native dir (source: "common") — derive long/short from our own classification:
      // open_long/open_short already say it directly; close/large-change fall back to the
      // sign of the position size *before* this trade (startPosition), which we do track
      // (see wallet_position_state / common-wallet-tracker/classify.ts).
      const prevPosition = Number(payload.startPosition);
      tone =
        payload.type === "wallet_open_long" || prevPosition > 0
          ? "long"
          : payload.type === "wallet_open_short" || prevPosition < 0
            ? "short"
            : "neutral";
    }
    const label = payload.dir ?? FALLBACK_LABELS[payload.type] ?? payload.type;
    return { label, tone };
  }
  switch (payload.type) {
    case "wallet_twap":
      return { label: `TWAP ${payload.status}`, tone: "neutral" };
    case "wallet_twap_slice_fill":
      return {
        label: `TWAP fill ${payload.size} @ ${payload.price}`,
        tone: payload.side === "buy" ? "long" : "short",
      };
    case "wallet_deposit":
      return { label: "Deposit", tone: "long" };
    case "wallet_withdrawal":
      return { label: "Withdrawal", tone: "short" };
    case "wallet_funding":
      return { label: "Funding", tone: "neutral" };
    default:
      return { label: event.type, tone: "neutral" };
  }
}

const TONE_RGB: Record<Tone, string> = {
  long: "57,255,176",
  short: "255,47,94",
  neutral: "236,235,255",
};

// Row tint encodes real information (trade magnitude), not pure decoration — intensity
// scales with this event's share of the largest position value currently on screen.
export function rowTint(
  tone: Tone,
  amountUsd: string | null,
  maxAmount: number,
): React.CSSProperties {
  const amount = amountUsd ? Math.abs(Number(amountUsd)) : 0;
  const share = maxAmount > 0 ? amount / maxAmount : 0;
  const alpha = tone === "neutral" ? 0.04 : 0.08 + share * 0.32;
  return { background: `linear-gradient(90deg, rgba(${TONE_RGB[tone]},${alpha}), transparent)` };
}

export function toneClass(tone: Tone): string {
  return tone === "long" ? "ht-long" : tone === "short" ? "ht-short" : "ht-muted";
}
