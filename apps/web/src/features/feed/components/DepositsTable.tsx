import { useState } from "react";
import { formatCompactUsd, formatTime, truncateAddress } from "../../../lib/format.js";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";
import { isGlobalDeposit, rowTint } from "../lib/activity.js";
import { AddressCell } from "./AddressCell.js";
import { CollapsibleHeading } from "./CollapsibleHeading.js";
import { RowDeleteButton } from "./RowDeleteButton.js";

interface DepositsTableProps {
  // Renders without its own card/heading chrome — used when nested inside
  // DepositThresholdPicker's own card instead of standing as a separate one (see
  // WhaleActivityTable's `bare` for the same pattern).
  bare?: boolean;
  // False when the user has turned deposit notifications off (DepositThresholdPicker's
  // "Off" button) — see TopTradesTable's equivalent prop doc.
  enabled?: boolean;
  events: RealtimeEvent[];
  walletColors: Map<string, string>;
  walletEmojis: Map<string, string>;
  trackedAddresses: Set<string>;
  trackingAddress: string | null;
  onTrack: (address: string) => void;
}

// Global deposit monitoring (module 1) — detected on the Arbitrum Bridge2 contract, not tied
// to a watched wallet, so every row's address can be promoted into tracking just like the
// large-trades/likely-TWAPs tables (see globalDepositPayloadSchema).
export function DepositsTable({
  bare = false,
  enabled = true,
  events,
  walletColors,
  walletEmojis,
  trackedAddresses,
  trackingAddress,
  onTrack,
}: DepositsTableProps) {
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
        title="Deposits"
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
      {!collapsed && !enabled && <p className="ht-empty">Notifications are off.</p>}
      {!collapsed && enabled && visibleEvents.length === 0 && (
        <p className="ht-empty">Waiting for events…</p>
      )}
      {!collapsed && enabled && visibleEvents.length > 0 && (
        <div className="ht-table-scroll">
          <table className="ht-table">
            <thead>
              <tr>
                <th className="ht-col-address">Address</th>
                <th>Amount</th>
                <th className="ht-col-secondary">Tx</th>
                <th>Time</th>
                <th className="ht-col-action"></th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((event) => (
                <tr key={event.id} style={rowTint("long", event.amountUsd, maxAmount)}>
                  <td>
                    {isGlobalDeposit(event.payload) && (
                      <AddressCell
                        address={event.payload.depositorAddress}
                        isTracked={trackedAddresses.has(
                          event.payload.depositorAddress.toLowerCase(),
                        )}
                        isTracking={trackingAddress === event.payload.depositorAddress}
                        onTrack={onTrack}
                        color={walletColors.get(event.payload.depositorAddress.toLowerCase())}
                        emoji={walletEmojis.get(event.payload.depositorAddress.toLowerCase())}
                      />
                    )}
                  </td>
                  <td className="ht-long">
                    {event.amountUsd ? formatCompactUsd(event.amountUsd) : "—"}
                  </td>
                  <td
                    className="ht-col-secondary ht-muted"
                    title={isGlobalDeposit(event.payload) ? event.payload.txHash : undefined}
                  >
                    {isGlobalDeposit(event.payload) ? truncateAddress(event.payload.txHash) : "—"}
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
