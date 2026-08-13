import { useState } from "react";
import { formatCompactUsd, formatPrice, formatTime } from "../../../lib/format.js";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";
import { isMarketTwapSuspected, rowTint } from "../lib/activity.js";
import { AddressCell } from "./AddressCell.js";
import { CollapsibleHeading } from "./CollapsibleHeading.js";
import { RowDeleteButton } from "./RowDeleteButton.js";

interface LikelyTwapsTableProps {
  // Renders without its own card/heading chrome — used when nested inside
  // TwapThresholdPicker's own card instead of standing as a separate one (see
  // WhaleActivityTable's `bare` for the same pattern).
  bare?: boolean;
  // False when the user has turned likely-TWAP notifications off (TwapThresholdPicker's
  // "Off" button) — see TopTradesTable's equivalent prop doc.
  enabled?: boolean;
  events: RealtimeEvent[];
  walletColors: Map<string, string>;
  walletEmojis: Map<string, string>;
  trackedAddresses: Set<string>;
  trackingAddress: string | null;
  onTrack: (address: string) => void;
}

// Deliberately not called "Large TWAPs" — this is a heuristic pattern match over the public
// trades feed (same address, same side, similar suborder sizes, within a bounded time gap),
// not confirmed Hyperliquid TWAP data. Hyperliquid's own TWAP data (userTwapHistory,
// userTwapSliceFills) is per-address only; there is no market-wide TWAP feed to draw from
// (see marketTwapSuspectedPayloadSchema in packages/shared for the full rationale). The
// "Likely" framing and occurrences/window columns are here to keep that honest in the UI.
export function LikelyTwapsTable({
  bare = false,
  enabled = true,
  events,
  walletColors,
  walletEmojis,
  trackedAddresses,
  trackingAddress,
  onTrack,
}: LikelyTwapsTableProps) {
  const [collapsed, setCollapsed] = useState(false);
  // Visual-only dismissal — hides rows from this table's own view without touching stored
  // events, the realtime feed, or any server-side alert setting (see RowDeleteButton doc).
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const visibleEvents = events.filter((event) => !dismissedIds.has(event.id));
  const maxAmount = Math.max(
    0,
    ...visibleEvents.map((event) => (event.amountUsd ? Math.abs(Number(event.amountUsd)) : 0)),
  );
  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper className={bare ? "ht-subsection" : "ht-section"}>
      <CollapsibleHeading
        level={bare ? "h3" : "h2"}
        title="Likely TWAPs"
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onClearAll={
          visibleEvents.length > 0
            ? () =>
                setDismissedIds(
                  (prev) => new Set([...prev, ...visibleEvents.map((event) => event.id)]),
                )
            : undefined
        }
      />
      {!collapsed && enabled && (
        <p className="ht-muted">
          Pattern-matched from public trade data — treat as a lead, not a fact.
        </p>
      )}
      {!collapsed && !enabled && <p className="ht-empty">Notifications are off.</p>}
      {!collapsed && enabled && visibleEvents.length === 0 && (
        <p className="ht-empty">Waiting for events…</p>
      )}
      {!collapsed && enabled && visibleEvents.length > 0 && (
        <div className="ht-table-scroll">
          <table className="ht-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Side</th>
                <th>Est. size</th>
                <th className="ht-col-secondary">Avg price</th>
                <th className="ht-col-address">Address</th>
                <th className="ht-col-secondary">Suborders</th>
                <th>Last seen</th>
                <th className="ht-col-action"></th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((event) => (
                <tr
                  key={event.id}
                  style={rowTint(
                    event.side === "buy" ? "long" : "short",
                    event.amountUsd,
                    maxAmount,
                  )}
                >
                  <td>{event.coin}</td>
                  <td className={event.side === "buy" ? "ht-long" : "ht-short"}>{event.side}</td>
                  <td>{event.amountUsd ? formatCompactUsd(event.amountUsd) : "—"}</td>
                  <td className="ht-col-secondary">
                    {isMarketTwapSuspected(event.payload)
                      ? formatPrice(event.payload.avgPrice)
                      : "—"}
                  </td>
                  <td>
                    {isMarketTwapSuspected(event.payload) && (
                      <AddressCell
                        address={event.payload.address}
                        isTracked={trackedAddresses.has(event.payload.address.toLowerCase())}
                        isTracking={trackingAddress === event.payload.address}
                        onTrack={onTrack}
                        color={walletColors.get(event.payload.address.toLowerCase())}
                        emoji={walletEmojis.get(event.payload.address.toLowerCase())}
                      />
                    )}
                  </td>
                  <td className="ht-col-secondary">
                    {isMarketTwapSuspected(event.payload) ? event.payload.occurrences : "—"}
                  </td>
                  <td className="ht-muted">{formatTime(event.occurredAt)}</td>
                  <td className="ht-col-action">
                    <RowDeleteButton
                      label="Dismiss row"
                      onClick={() => setDismissedIds((prev) => new Set(prev).add(event.id))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Wrapper>
  );
}
