import { useState } from "react";
import { formatCompactUsd, formatPrice, formatTime } from "../../../lib/format.js";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";
import { getActivity, hasPositionFields, rowTint, toneClass } from "../lib/activity.js";
import { AddressCell } from "./AddressCell.js";
import { CollapsibleHeading } from "./CollapsibleHeading.js";

interface WhaleActivityTableProps {
  // Reused as-is for the live-tracker wallet's own activity feed (see FeedPage) — same
  // table, different heading, so the two aren't visually interchangeable at a glance.
  title?: string;
  // Renders without its own card/heading chrome — used when a tracker's activity table is
  // nested inside that tracker's own management panel (CommonWalletsPanel/
  // PreciseWalletPanel) instead of standing as a separate card.
  bare?: boolean;
  events: RealtimeEvent[];
  walletLabels: Map<string, string>;
  walletColors: Map<string, string>;
  walletEmojis: Map<string, string>;
  trackedAddresses: Set<string>;
  trackingAddress: string | null;
  onTrack: (address: string) => void;
}

export function WhaleActivityTable({
  title = "Latest whale activity",
  bare = false,
  events,
  walletLabels,
  walletColors,
  walletEmojis,
  trackedAddresses,
  trackingAddress,
  onTrack,
}: WhaleActivityTableProps) {
  const [collapsed, setCollapsed] = useState(false);
  const maxAmount = Math.max(
    0,
    ...events.map((event) => (event.amountUsd ? Math.abs(Number(event.amountUsd)) : 0)),
  );
  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper className={bare ? "ht-subsection" : "ht-section"}>
      <CollapsibleHeading
        level={bare ? "h3" : "h2"}
        title={title}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
      {!collapsed && events.length === 0 && <p className="ht-empty">Waiting for events…</p>}
      {!collapsed && events.length > 0 && (
        <div className="ht-table-scroll">
          <table className="ht-table">
            <thead>
              <tr>
                <th className="ht-col-address">Address</th>
                <th>Assets</th>
                <th>Activity</th>
                <th>Position</th>
                <th className="ht-col-secondary">Leverage</th>
                <th className="ht-col-secondary">PnL</th>
                <th className="ht-col-secondary">Price</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const activity = getActivity(event);
                const address = event.walletAddress;
                return (
                  <tr key={event.id} style={rowTint(activity.tone, event.amountUsd, maxAmount)}>
                    <td>
                      {address ? (
                        <AddressCell
                          address={address}
                          label={walletLabels.get(address.toLowerCase())}
                          isTracked={trackedAddresses.has(address.toLowerCase())}
                          isTracking={trackingAddress === address}
                          onTrack={onTrack}
                          color={walletColors.get(address.toLowerCase())}
                          emoji={walletEmojis.get(address.toLowerCase())}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{event.coin ?? "—"}</td>
                    <td className={toneClass(activity.tone)}>{activity.label}</td>
                    <td>{event.amountUsd ? formatCompactUsd(event.amountUsd) : "—"}</td>
                    <td
                      className="ht-col-secondary ht-muted"
                      // Hyperliquid's own per-position setting (clearinghouseState), not
                      // something derived here — absent when the lookup failed or the
                      // position no longer existed by the time it ran (see
                      // findPositionLeverageAndMargin in packages/hyperliquid-sdk).
                      title={
                        hasPositionFields(event.payload) &&
                        event.payload.marginUsedUsd !== undefined
                          ? `Margin used: ${formatCompactUsd(event.payload.marginUsedUsd)}`
                          : undefined
                      }
                    >
                      {hasPositionFields(event.payload) && event.payload.leverageValue !== undefined
                        ? `${event.payload.leverageValue}x ${event.payload.leverageType ?? ""}`.trim()
                        : "—"}
                    </td>
                    <td
                      className={`ht-col-secondary ${
                        hasPositionFields(event.payload) && event.payload.closedPnl !== undefined
                          ? toneClass(Number(event.payload.closedPnl) < 0 ? "short" : "long")
                          : "ht-muted"
                      }`}
                      // closedPnl is a Hyperliquid-native figure (source: "precise" only) —
                      // common-tracker fills have no cost-basis tracking to compute it from,
                      // so it's honestly absent rather than guessed at.
                      title={
                        hasPositionFields(event.payload) && event.payload.closedPnl === undefined
                          ? "Not available for common-tracked wallets"
                          : undefined
                      }
                    >
                      {hasPositionFields(event.payload) && event.payload.closedPnl !== undefined
                        ? formatCompactUsd(event.payload.closedPnl)
                        : "—"}
                    </td>
                    <td className="ht-col-secondary">
                      {hasPositionFields(event.payload) ? formatPrice(event.payload.price) : "—"}
                    </td>
                    <td className="ht-muted">{formatTime(event.occurredAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Wrapper>
  );
}
