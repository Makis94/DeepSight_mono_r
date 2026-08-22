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

// Every row here is a REAL Hyperliquid TWAP: market-watcher first pattern-matches the public
// trades feed to find candidate addresses (there is no market-wide TWAP feed to draw from
// directly), then REST-confirms each one against that specific address's actual Hyperliquid
// TWAP fill history (see twap-confirm.ts) before it's ever published — a candidate the lookup
// doesn't confirm is dropped upstream and never reaches this table (see
// marketTwapSuspectedPayloadSchema in packages/shared for the full rationale). No "likely"/
// unconfirmed rows exist here; do not reintroduce that without also reintroducing a way to
// mark them as such — testing showed unconfirmed pattern-matches are wrong more often than
// not (they mostly catch active traders/market-makers, not real TWAPs).
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
        title="TWAPs"
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
          Confirmed via real Hyperliquid TWAP fills for each address, not guessed.
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
