// Fired by api.ts's authFetch helper whenever ANY authenticated request comes back 401
// (expired/invalid session — see SESSION_TTL in apps/api's jwt.ts). App.tsx subscribes once
// and bounces the user back to signed-out state, rather than every call site across the app
// needing its own 401 handling.
const target = new EventTarget();
const SESSION_EXPIRED = "session-expired";

export function notifySessionExpired(): void {
  target.dispatchEvent(new Event(SESSION_EXPIRED));
}

export function onSessionExpired(handler: () => void): () => void {
  target.addEventListener(SESSION_EXPIRED, handler);
  return () => target.removeEventListener(SESSION_EXPIRED, handler);
}
