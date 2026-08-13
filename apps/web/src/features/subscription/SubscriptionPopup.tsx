import type { SubscriptionState } from "./useSubscription.js";
import "./subscription-popup.css";

interface SubscriptionPopupProps {
  subscription: SubscriptionState;
  onClose: () => void;
}

function daysLeft(isoDate: string): number {
  const ms = new Date(isoDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString();
}

// Reached from the account menu (Header's avatar dropdown) — see SlotFullPopup for the same
// .ht-popup-backdrop/.ht-popup pattern this reuses. State comes from App's single
// useSubscription instance (see App.tsx) rather than fetching its own, so this stays in sync
// with the gate screen that decides whether FeedPage renders at all.
export function SubscriptionPopup({ subscription, onClose }: SubscriptionPopupProps) {
  const {
    status,
    trialEndsAt,
    currentPeriodEnd,
    trialAvailable,
    isBusy,
    error,
    startTrial,
    subscribe,
  } = subscription;

  return (
    <div className="ht-popup-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ht-popup ht-subscription-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ht-subscription-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="ht-subscription-title">Subscription</h3>

        {status === "loading" && <p>Loading…</p>}
        {status === "trial" && trialEndsAt && (
          <p className="ht-subscription-status ht-subscription-status-trial">
            🎁 Trial active — {daysLeft(trialEndsAt)} day{daysLeft(trialEndsAt) === 1 ? "" : "s"}{" "}
            left
            <br />
            <span className="ht-subscription-status-detail">until {formatDate(trialEndsAt)}</span>
          </p>
        )}
        {status === "active" && currentPeriodEnd && (
          <p className="ht-subscription-status ht-subscription-status-active">
            ✅ Subscription active — {daysLeft(currentPeriodEnd)} day
            {daysLeft(currentPeriodEnd) === 1 ? "" : "s"} left
            <br />
            <span className="ht-subscription-status-detail">
              until {formatDate(currentPeriodEnd)}
            </span>
          </p>
        )}
        {status === "none" && (
          <p className="ht-subscription-status">
            ❌ No active subscription.
            <br />
            <span className="ht-subscription-status-detail">
              {trialAvailable
                ? "Start your free trial or subscribe to unlock alerts."
                : "Your trial has already been used — subscribe to unlock alerts."}
            </span>
          </p>
        )}

        <div className="ht-subscription-actions">
          {status === "none" && trialAvailable && (
            <button
              type="button"
              className="ht-btn"
              disabled={isBusy}
              onClick={() => void startTrial()}
            >
              Start 3-day free trial
            </button>
          )}
          {status !== "active" && (
            <button
              type="button"
              className="ht-btn"
              disabled={isBusy}
              onClick={() => void subscribe()}
            >
              Subscribe
            </button>
          )}
        </div>

        {error && <p className="ht-subscription-error">{error}</p>}

        <button type="button" className="ht-btn ht-popup-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
