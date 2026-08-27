import { Fragment, useState } from "react";
import { fetchTwapSliceFills } from "../../../lib/api.js";
import { formatCompactUsd, formatPrice, formatTime } from "../../../lib/format.js";
import type { TwapSliceFill } from "@hypertracker/shared/schemas/market-twaps";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";
import { isMarketTwap, rowTint } from "../lib/activity.js";
import { AddressCell } from "./AddressCell.js";
import { CollapsibleHeading } from "./CollapsibleHeading.js";
import { RowDeleteButton } from "./RowDeleteButton.js";

interface MarketTwapsTableProps {
  // Renders without its own card/heading chrome — used when nested inside
  // TwapThresholdPicker's own card instead of standing as a separate one (see
  // WhaleActivityTable's `bare` for the same pattern).
  bare?: boolean;
  // False when the user has turned market-wide TWAP notifications off (TwapThresholdPicker's
  // "Off" button) — see TopTradesTable's equivalent prop doc.
  enabled?: boolean;
  events: RealtimeEvent[];
  walletColors: Map<string, string>;
  walletEmojis: Map<string, string>;
  trackedAddresses: Set<string>;
  trackingAddress: string | null;
  onTrack: (address: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  activated: "🆕 Opened",
  finished: "✅ Finished",
  terminated: "⛔ Terminated",
};

type SliceFillsState = "loading" | "error" | TwapSliceFill[];

// Every row here is a real Hyperliquid TWAP order transition, sourced directly from
// QuickNode's HyperCore TWAP dataset (see marketTwapPayloadSchema) — no pattern-matching or
// guessing, unlike the heuristic this table replaced (formerly LikelyTwapsTable). A twapId
// appears as two rows over its lifetime: once at "activated" (target size, estimated
// notional — nothing has executed yet) and once more at "finished"/"terminated" (real
// executed size/notional). Clicking a row fetches that specific order's real suborder fills
// on demand (see fetchTwapSliceFills) rather than preloading them for every row.
export function MarketTwapsTable({
  bare = false,
  enabled = true,
  events,
  walletColors,
  walletEmojis,
  trackedAddresses,
  trackingAddress,
  onTrack,
}: MarketTwapsTableProps) {
  const [collapsed, setCollapsed] = useState(false);
  // Visual-only dismissal — hides rows from this table's own view without touching stored
  // events, the realtime feed, or any server-side alert setting (see RowDeleteButton doc).
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [expandedEventId, setExpandedEventId] = useState<number | null>(null);
  const [sliceFillsByEventId, setSliceFillsByEventId] = useState<Map<number, SliceFillsState>>(
    new Map(),
  );

  const visibleEvents = events.filter((event) => !dismissedIds.has(event.id));
  const maxAmount = Math.max(
    0,
    ...visibleEvents.map((event) => (event.amountUsd ? Math.abs(Number(event.amountUsd)) : 0)),
  );
  const Wrapper = bare ? "div" : "section";

  async function toggleExpand(event: RealtimeEvent): Promise<void> {
    if (expandedEventId === event.id) {
      setExpandedEventId(null);
      return;
    }
    setExpandedEventId(event.id);
    if (sliceFillsByEventId.has(event.id) || !isMarketTwap(event.payload)) return;

    const { twapId, address } = event.payload;
    setSliceFillsByEventId((prev) => new Map(prev).set(event.id, "loading"));
    try {
      const fills = await fetchTwapSliceFills(twapId, address);
      setSliceFillsByEventId((prev) => new Map(prev).set(event.id, fills));
    } catch {
      setSliceFillsByEventId((prev) => new Map(prev).set(event.id, "error"));
    }
  }

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
          Real Hyperliquid TWAP orders, exchange-wide. Click a row for suborders.
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
                <th>Status</th>
                <th>Asset</th>
                <th>Side</th>
                <th>Notional</th>
                <th className="ht-col-secondary">Size (exec/target)</th>
                <th className="ht-col-secondary">Duration</th>
                <th className="ht-col-address">Address</th>
                <th>Time</th>
                <th className="ht-col-action"></th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((event) => {
                if (!isMarketTwap(event.payload)) return null;
                const payload = event.payload;
                const isExpanded = expandedEventId === event.id;
                const sliceFills = sliceFillsByEventId.get(event.id);

                return (
                  <Fragment key={event.id}>
                    <tr
                      className="ht-row-clickable"
                      onClick={() => void toggleExpand(event)}
                      style={rowTint(
                        payload.side === "buy" ? "long" : "short",
                        event.amountUsd,
                        maxAmount,
                      )}
                    >
                      <td>{STATUS_LABEL[payload.status] ?? payload.status}</td>
                      <td>{payload.coin}</td>
                      <td className={payload.side === "buy" ? "ht-long" : "ht-short"}>
                        {payload.side}
                      </td>
                      <td>
                        {event.amountUsd ? formatCompactUsd(event.amountUsd) : "—"}
                        {payload.status === "activated" && <span className="ht-muted"> est.</span>}
                      </td>
                      <td className="ht-col-secondary">
                        {payload.executedSize}/{payload.size}
                        {payload.reduceOnly && <span title="Reduce-only"> · RO</span>}
                        {payload.randomize && <span title="Randomized"> · RND</span>}
                      </td>
                      <td className="ht-col-secondary">{payload.minutes}min</td>
                      <td className="ht-col-address" onClick={(e) => e.stopPropagation()}>
                        <AddressCell
                          address={payload.address}
                          isTracked={trackedAddresses.has(payload.address.toLowerCase())}
                          isTracking={trackingAddress === payload.address}
                          onTrack={onTrack}
                          color={walletColors.get(payload.address.toLowerCase())}
                          emoji={walletEmojis.get(payload.address.toLowerCase())}
                        />
                      </td>
                      <td className="ht-muted">{formatTime(event.occurredAt)}</td>
                      <td className="ht-col-action" onClick={(e) => e.stopPropagation()}>
                        <RowDeleteButton
                          label="Dismiss row"
                          onClick={() => setDismissedIds((prev) => new Set(prev).add(event.id))}
                        />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${event.id}-fills`}>
                        <td colSpan={9} className="ht-subrow">
                          {sliceFills === "loading" && (
                            <p className="ht-muted">Loading suborders…</p>
                          )}
                          {sliceFills === "error" && (
                            <p className="ht-empty">Failed to load suborders.</p>
                          )}
                          {Array.isArray(sliceFills) && sliceFills.length === 0 && (
                            <p className="ht-empty">No suborder fills recorded yet.</p>
                          )}
                          {Array.isArray(sliceFills) && sliceFills.length > 0 && (
                            <table className="ht-table ht-table-nested">
                              <thead>
                                <tr>
                                  <th>Time</th>
                                  <th>Side</th>
                                  <th>Price</th>
                                  <th>Size</th>
                                  <th>Notional</th>
                                  <th>Order id</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sliceFills.map((fill) => (
                                  <tr key={fill.oid}>
                                    <td>{new Date(fill.time).toLocaleTimeString()}</td>
                                    <td className={fill.side === "buy" ? "ht-long" : "ht-short"}>
                                      {fill.side}
                                    </td>
                                    <td>{formatPrice(fill.price)}</td>
                                    <td>{fill.size}</td>
                                    <td>{formatCompactUsd(fill.notionalUsd)}</td>
                                    <td className="ht-muted">{fill.oid}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Wrapper>
  );
}
