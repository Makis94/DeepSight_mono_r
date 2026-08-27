import { MAX_WATCHED_WALLETS } from "@hypertracker/shared/schemas/watched-wallet";
import type { WatchedWallet } from "../../../lib/api.js";
import { truncateAddress } from "../../../lib/format.js";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";
import { LiveBadge } from "./LiveBadge.js";
import { WhaleActivityTable } from "./WhaleActivityTable.js";

interface CommonWalletsPanelProps {
  // The full watched-wallet list (both trackingMode values) — a wallet promoted to
  // "precise" still shows up here (with a "Stop live tracking" action instead of "Live
  // tracking") rather than disappearing from the overview just because it also has a row in
  // PreciseWalletPanel. It does stop being matched against the public trades feed once
  // precise, though — apps/worker's CommonWalletRegistry only polls trackingMode="common"
  // rows, so this row is a pure list-visibility choice, not a claim that both pipelines are
  // running for it at once (that would double-publish the same trade under two sources).
  wallets: WatchedWallet[];
  // The cap (MAX_WATCHED_WALLETS) is per-user across BOTH tables combined, not just this
  // one — see apps/api watched-wallets/routes.ts POST handler — so the "Add wallet"
  // form needs the true total, not wallets.length.
  totalCount: number;
  walletColors: Map<string, string>;
  // Second identifying cue alongside color (see wallet-emoji.ts) — colors alone repeat once
  // wallet count nears MAX_WATCHED_WALLETS, making rows hard to tell apart at a glance.
  walletEmojis: Map<string, string>;
  addressInput: string;
  onAddressInputChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isSubmitting: boolean;
  onUntrack: (address: string) => void;
  untrackingAddress: string | null;
  formError: string | null;
  // Requests this wallet's one shot at a live Hyperliquid slot (or, if already queued,
  // cancels that request) — see apps/api precise-slots.ts for the 1-slot-per-user /
  // shared-FIFO-queue rules this triggers server-side.
  onGoLive: (walletId: number) => void;
  togglingWalletId: number | null;
  // This tracker's own activity feed (see FeedPage's pseudoWhaleEvents split), rendered
  // nested at the bottom of this same card via WhaleActivityTable's `bare` mode.
  activityEvents: RealtimeEvent[];
  walletLabels: Map<string, string>;
  trackedAddresses: Set<string>;
  trackingAddress: string | null;
  onTrackAddress: (address: string) => void;
}

export function CommonWalletsPanel({
  wallets,
  totalCount,
  walletColors,
  walletEmojis,
  addressInput,
  onAddressInputChange,
  onSubmit,
  isSubmitting,
  onUntrack,
  untrackingAddress,
  formError,
  onGoLive,
  togglingWalletId,
  activityEvents,
  walletLabels,
  trackedAddresses,
  trackingAddress,
  onTrackAddress,
}: CommonWalletsPanelProps) {
  const isAtLimit = totalCount >= MAX_WATCHED_WALLETS;

  return (
    <section className="ht-section">
      <h2>
        Filtered tracker ({totalCount}/{MAX_WATCHED_WALLETS})
      </h2>
      <p className="ht-hint">
        Matched against the public trade feed — add addresses here, or click one in Large trades /
        TWAPs below.
      </p>

      {wallets.length === 0 && <p className="ht-empty">Not tracking a wallet yet.</p>}

      {wallets.map((wallet) => {
        const color = walletColors.get(wallet.address.toLowerCase());
        const emoji = walletEmojis.get(wallet.address.toLowerCase());
        const isUntracking = untrackingAddress === wallet.address;
        const isToggling = togglingWalletId === wallet.id;
        const isLive = wallet.trackingMode === "precise";
        const isQueued = !isLive && wallet.queuePosition !== undefined;
        const buttonLabel = isToggling
          ? "…"
          : isLive
            ? "Stop live tracking"
            : isQueued
              ? `Queued #${wallet.queuePosition} — cancel`
              : "Live tracking";
        const buttonTitle = isLive
          ? "Release this slot back to filtered (public-feed) tracking"
          : isQueued
            ? "Waiting for a live slot to free up — click to cancel"
            : "Promote to full-fidelity Hyperliquid tracking (1 slot per user)";
        // Green = "clicking this goes live" (a positive/"go" action), red = "clicking this
        // leaves live" (stopping, or cancelling a pending queue request) — both read as
        // "undoing toward normal" the same way.
        const toggleToneClass = isLive || isQueued ? "ht-btn-toggle-stop" : "ht-btn-toggle-live";
        return (
          <div
            key={wallet.id}
            className="ht-tracked-wallet"
            style={color ? { borderColor: color, boxShadow: `0 0 10px ${color}66` } : undefined}
          >
            <div className="ht-tracked-wallet-header">
              <span
                className="ht-mono"
                title={wallet.address}
                style={color ? { color } : undefined}
              >
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
              {isLive && <LiveBadge />}
            </div>
            <div className="ht-tracked-wallet-actions">
              <button
                type="button"
                className={`ht-btn ht-btn-toggle ${toggleToneClass}`}
                title={buttonTitle}
                disabled={isToggling}
                onClick={() => onGoLive(wallet.id)}
              >
                {buttonLabel}
              </button>
              <button
                type="button"
                className="ht-btn ht-btn-untrack"
                disabled={isUntracking}
                onClick={() => onUntrack(wallet.address)}
              >
                {isUntracking ? "Untracking…" : "Untrack"}
              </button>
            </div>
          </div>
        );
      })}

      <form onSubmit={onSubmit}>
        <input
          type="text"
          className="ht-input"
          value={addressInput}
          onChange={(e) => onAddressInputChange(e.target.value)}
          placeholder={isAtLimit ? "Untrack a wallet to add another" : "0x..."}
          pattern="^0x[a-fA-F0-9]{40}$"
          required
          disabled={isSubmitting || isAtLimit}
        />
        <button
          type="submit"
          className="ht-btn"
          disabled={isSubmitting || isAtLimit || addressInput.trim().length === 0}
        >
          {isSubmitting ? "Saving…" : "Add wallet"}
        </button>
      </form>
      {formError && (
        <p role="alert" className="ht-short">
          {formError}
        </p>
      )}

      <WhaleActivityTable
        bare
        title="Latest whale activity"
        events={activityEvents}
        walletLabels={walletLabels}
        walletColors={walletColors}
        walletEmojis={walletEmojis}
        trackedAddresses={trackedAddresses}
        trackingAddress={trackingAddress}
        onTrack={onTrackAddress}
      />
    </section>
  );
}
