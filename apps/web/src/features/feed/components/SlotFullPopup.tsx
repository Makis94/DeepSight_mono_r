import { MAX_WATCHED_WALLETS } from "@hypertracker/shared/schemas/watched-wallet";

interface SlotFullPopupProps {
  onClose: () => void;
}

export function SlotFullPopup({ onClose }: SlotFullPopupProps) {
  return (
    <div className="ht-popup-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ht-popup"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ht-popup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="ht-popup-title">All {MAX_WATCHED_WALLETS} slots are full</h3>
        <p>Untrack a wallet to free up a slot before adding another.</p>
        <button type="button" className="ht-btn" onClick={onClose} autoFocus>
          Got it
        </button>
      </div>
    </div>
  );
}
