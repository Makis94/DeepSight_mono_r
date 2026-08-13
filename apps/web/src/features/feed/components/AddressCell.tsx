import { truncateAddress } from "../../../lib/format.js";

interface AddressCellProps {
  address: string;
  label?: string | undefined;
  isTracked: boolean;
  isTracking: boolean;
  onTrack: (address: string) => void;
  // The tracked wallet's assigned color (see wallet-colors.ts) — set only when isTracked,
  // so rows belonging to different watched wallets stay visually distinguishable at a glance
  // instead of all collapsing to the same muted "already tracked, can't re-track" gray.
  color?: string | undefined;
  // Second identifying cue alongside color (see wallet-emoji.ts) — colors alone repeat once
  // wallet count nears MAX_WATCHED_WALLETS, so this lets a tracked wallet be recognized in
  // any table row (Large trades, Likely TWAPs, Deposits, whale activity), not just the
  // tracker panel where it's assigned.
  emoji?: string | undefined;
}

export function AddressCell({
  address,
  label,
  isTracked,
  isTracking,
  onTrack,
  color,
  emoji,
}: AddressCellProps) {
  return (
    <button
      type="button"
      className="ht-addr"
      disabled={isTracked || isTracking}
      title={isTracked ? address : `Track ${address}`}
      onClick={() => onTrack(address)}
      style={isTracked && color ? { color } : undefined}
    >
      {/* Fixed-width slot rendered for every row, emoji or not — otherwise rows with a
          tracked (emoji'd) address push their text right of untracked rows, so the address
          column no longer lines up (see feed.css .ht-wallet-emoji-slot). */}
      <span className="ht-wallet-emoji-slot" aria-hidden="true">
        {isTracked && emoji ? emoji : null}
      </span>
      {label ?? truncateAddress(address)}
    </button>
  );
}
