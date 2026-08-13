import { useState } from "react";
import { formatCompactUsd, formatPrice, formatTime } from "../../../lib/format.js";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";
import { isMarketTrade, rowTint } from "../lib/activity.js";
import type { MarketTradePayload } from "@hypertracker/shared/schemas/events";
import { AddressCell } from "./AddressCell.js";
import { CollapsibleHeading } from "./CollapsibleHeading.js";

// The taker/executor side — a sell print's mover is the seller, a buy print's is the buyer.
// Showing both parties every row was redundant: the other side is just whoever happened to
// be resting on the book, not who made this trade happen.
function takerAddress(payload: MarketTradePayload, side: string): string {
  return side === "sell" ? payload.sellerAddress : payload.buyerAddress;
}

interface TopTradesTableProps {
  // Renders without its own card/heading chrome — used when nested inside ThresholdPicker's
  // own card instead of standing as a separate one (see WhaleActivityTable's `bare` for the
  // same pattern).
  bare?: boolean;
  // False when the user has turned large-trade notifications off (ThresholdPicker's "Off"
  // button) — shows a distinct empty state instead of "Waiting for events…", which would
  // otherwise imply matches are still expected.
  enabled?: boolean;
  events: RealtimeEvent[];
  walletColors: Map<string, string>;
  walletEmojis: Map<string, string>;
  trackedAddresses: Set<string>;
  trackingAddress: string | null;
  onTrack: (address: string) => void;
}

export function TopTradesTable({
  bare = false,
  enabled = true,
  events,
  walletColors,
  walletEmojis,
  trackedAddresses,
  trackingAddress,
  onTrack,
}: TopTradesTableProps) {
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
        title="Large trades"
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
      {!collapsed && !enabled && <p className="ht-empty">Notifications are off.</p>}
      {!collapsed && enabled && events.length === 0 && (
        <p className="ht-empty">Waiting for events…</p>
      )}
      {!collapsed && enabled && events.length > 0 && (
        <div className="ht-table-scroll">
          <table className="ht-table">
            <thead>
              <tr>
                <th>Assets</th>
                <th>Side</th>
                <th>Size</th>
                <th className="ht-col-secondary">Price</th>
                <th className="ht-col-address">Address</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const address = isMarketTrade(event.payload)
                  ? takerAddress(event.payload, event.side ?? "")
                  : null;
                return (
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
                      {isMarketTrade(event.payload) ? formatPrice(event.payload.price) : "—"}
                    </td>
                    <td>
                      {address && (
                        <AddressCell
                          address={address}
                          isTracked={trackedAddresses.has(address.toLowerCase())}
                          isTracking={trackingAddress === address}
                          onTrack={onTrack}
                          color={walletColors.get(address.toLowerCase())}
                          emoji={walletEmojis.get(address.toLowerCase())}
                        />
                      )}
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
