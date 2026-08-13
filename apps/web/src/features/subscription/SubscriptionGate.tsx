import type { SubscriptionState } from "./useSubscription.js";
import "./subscription-gate.css";

interface SubscriptionGateProps {
  subscription: SubscriptionState;
}

// Rendered instead of FeedPage whenever useSubscription's status isn't "trial"/"active" (see
// App.tsx) — this is the client-side UX for the same rule apps/api's requireActiveSubscription
// guard enforces server-side. The real access control is the 402 on every dashboard route;
// this screen just means a user without a subscription never even issues those requests, and
// never sees a broken/empty dashboard instead of a clear explanation.
// Only ever mounted once App.tsx has confirmed status is "none" — a still-"loading" status
// gets its own lightweight placeholder there instead, so this never flashes "subscribe now"
// before the real check comes back.
export function SubscriptionGate({ subscription }: SubscriptionGateProps) {
  const { trialAvailable, isBusy, error, startTrial, subscribe } = subscription;

  return (
    <main className="ht-subscription-gate">
      <h1>🔒 Subscription required</h1>
      <p>
        {trialAvailable
          ? "Start your free 3-day trial or subscribe to unlock the live dashboard and alerts."
          : "Your trial has already been used on this account — subscribe to unlock the live dashboard and alerts."}
      </p>

      <div className="ht-subscription-gate-actions">
        {trialAvailable && (
          <button
            type="button"
            className="ht-btn"
            disabled={isBusy}
            onClick={() => void startTrial()}
          >
            Start 3-day free trial
          </button>
        )}
        <button type="button" className="ht-btn" disabled={isBusy} onClick={() => void subscribe()}>
          Subscribe
        </button>
      </div>

      {error && <p className="ht-subscription-error">{error}</p>}
    </main>
  );
}
