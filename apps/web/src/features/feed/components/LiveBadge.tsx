// Twitch/YouTube-style "on air" cue for a wallet holding the one live (precise) Hyperliquid
// slot — a pulsing dot next to plain button text is otherwise easy to miss at a glance.
export function LiveBadge() {
  return (
    <span className="ht-live-badge" title="Full-fidelity live tracking active">
      <span className="ht-live-dot" />
      LIVE
    </span>
  );
}
