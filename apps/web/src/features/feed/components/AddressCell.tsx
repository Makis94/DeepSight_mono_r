import { useEffect, useRef, useState } from "react";
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
  // any table row (Large trades, TWAPs, Deposits, whale activity), not just the
  // tracker panel where it's assigned.
  emoji?: string | undefined;
  // "menu" (default) — click reveals an inline Copy/Track choice, used on the market-wide
  // tables (Large trades, TWAPs, Deposits) where a row's address is very likely new.
  // "copy" — click copies straight away, used on the whale-activity tables: every row there
  // is already a tracked wallet by construction (RealtimeHub only ever forwards wallet-tied
  // events for addresses this user already watches), so a "Track" choice would never do
  // anything.
  variant?: "menu" | "copy";
}

async function copyAddress(address: string): Promise<void> {
  await navigator.clipboard.writeText(address);
}

export function AddressCell({
  address,
  label,
  isTracked,
  isTracking,
  onTrack,
  color,
  emoji,
  variant = "menu",
}: AddressCellProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Closes the inline Copy/Track choice on an outside click — same pattern as CoinFilter's
  // dropdown.
  useEffect(() => {
    if (!isMenuOpen) return;
    function handlePointerDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isMenuOpen]);

  function handleCopy(): void {
    copyAddress(address)
      .then(() => {
        setJustCopied(true);
        setIsMenuOpen(false);
        setTimeout(() => setJustCopied(false), 1200);
      })
      .catch((err: unknown) => {
        console.error("failed to copy address", err);
      });
  }

  const emojiSlot = (
    <span className="ht-wallet-emoji-slot" aria-hidden="true">
      {isTracked && emoji ? emoji : null}
    </span>
  );
  const displayLabel = justCopied ? "Copied!" : (label ?? truncateAddress(address));

  if (variant === "copy") {
    return (
      <button
        type="button"
        className="ht-addr"
        title={justCopied ? "Copied!" : `Copy ${address}`}
        onClick={handleCopy}
        style={color ? { color } : undefined}
      >
        {emojiSlot}
        {displayLabel}
      </button>
    );
  }

  return (
    <div className="ht-addr-cell" ref={rootRef}>
      {!isMenuOpen ? (
        <button
          type="button"
          className="ht-addr"
          title={address}
          onClick={() => setIsMenuOpen(true)}
          style={isTracked && color ? { color } : undefined}
        >
          {emojiSlot}
          {displayLabel}
        </button>
      ) : (
        <span className="ht-addr-actions">
          <button type="button" className="ht-addr-action ht-addr-action-copy" onClick={handleCopy}>
            Copy
          </button>
          <button
            type="button"
            className="ht-addr-action ht-addr-action-track"
            disabled={isTracked || isTracking}
            onClick={() => {
              onTrack(address);
              setIsMenuOpen(false);
            }}
          >
            {isTracked ? "Tracked" : isTracking ? "…" : "Track"}
          </button>
        </span>
      )}
    </div>
  );
}
