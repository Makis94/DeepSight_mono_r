import type { WatchedWallet } from "../../../lib/api.js";
import { truncateAddress } from "../../../lib/format.js";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";
import { LiveBadge } from "./LiveBadge.js";
import { WhaleActivityTable } from "./WhaleActivityTable.js";

interface PreciseWalletPanelProps {
  // At most one — Hyperliquid's own per-user WS subscription cap (see
  // apps/api precise-slots.ts requestPreciseSlot: promoting a second wallet auto-demotes
  // the first) means this table can never hold more than a single row.
  wallet: WatchedWallet | undefined;
  color: string | undefined;
  // Second identifying cue alongside color — see wallet-emoji.ts / CommonWalletsPanel's
  // equivalent prop doc.
  emoji: string | undefined;
  onUntrack: (address: string) => void;
  untrackingAddress: string | null;
  // Releases the slot back to the pseudo tracker (and auto-promotes whoever is next in the
  // shared platform-wide queue into it) — see apps/api precise-slots.ts releasePreciseSlot.
  onStopLive: (walletId: number) => void;
  togglingWalletId: number | null;
  // This wallet's own activity feed (see FeedPage's preciseWalletEvents split), rendered
  // nested at the bottom of this same card via WhaleActivityTable's `bare` mode — only
  // meaningful once a wallet is actually live-tracked, so it's omitted otherwise.
  activityEvents: RealtimeEvent[];
  walletLabels: Map<string, string>;
  walletColors: Map<string, string>;
  walletEmojis: Map<string, string>;
  trackedAddresses: Set<string>;
  trackingAddress: string | null;
  onTrackAddress: (address: string) => void;
}

export function PreciseWalletPanel({
  wallet,
  color,
  emoji,
  onUntrack,
  untrackingAddress,
  onStopLive,
  togglingWalletId,
  activityEvents,
  walletLabels,
  walletColors,
  walletEmojis,
  trackedAddresses,
  trackingAddress,
  onTrackAddress,
}: PreciseWalletPanelProps) {
  return (
    <section className="ht-section">
      <h2>Live tracker (Hyperliquid)</h2>
      <p className="ht-hint">
        Full-fidelity native subscription — one of a handful of slots shared across every user on
        this IP. Promote a wallet here from the filtered tracker above.
      </p>

      {!wallet && <p className="ht-empty">No wallet on live tracking yet.</p>}

      {wallet && (
        <div
          className="ht-tracked-wallet"
          style={color ? { borderColor: color, boxShadow: `0 0 10px ${color}66` } : undefined}
        >
          <div className="ht-tracked-wallet-header">
            <span className="ht-mono" title={wallet.address} style={color ? { color } : undefined}>
              {emoji && (
                <span className="ht-wallet-emoji" aria-hidden="true">
                  {emoji}
                </span>
              )}
              {wallet.label ?? (
                <>
                  <span className="ht-addr-short">{truncateAddress(wallet.address)}</span>
                  <span className="ht-addr-full">{wallet.address}</span>
                </>
              )}
            </span>
            <LiveBadge />
          </div>
          <div className="ht-tracked-wallet-actions">
            <button
              type="button"
              className="ht-btn ht-btn-toggle ht-btn-toggle-stop"
              title="Release this slot back to filtered (public-feed) tracking"
              disabled={togglingWalletId === wallet.id}
              onClick={() => onStopLive(wallet.id)}
            >
              {togglingWalletId === wallet.id ? "…" : "Stop live tracking"}
            </button>
            <button
              type="button"
              className="ht-btn ht-btn-untrack"
              disabled={untrackingAddress === wallet.address}
              onClick={() => onUntrack(wallet.address)}
            >
              {untrackingAddress === wallet.address ? "Untracking…" : "Untrack"}
            </button>
          </div>
        </div>
      )}

      {wallet && (
        <WhaleActivityTable
          bare
          title="Live tracker activity"
          events={activityEvents}
          walletLabels={walletLabels}
          walletColors={walletColors}
          walletEmojis={walletEmojis}
          trackedAddresses={trackedAddresses}
          trackingAddress={trackingAddress}
          onTrack={onTrackAddress}
        />
      )}
    </section>
  );
}
