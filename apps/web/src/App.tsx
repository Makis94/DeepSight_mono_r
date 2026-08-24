import { useCallback, useEffect, useState } from "react";
import { LoginWidget } from "./auth/LoginWidget.js";
import { clearToken, decodeSessionToken, getStoredToken } from "./auth/session.js";
import { useMiniAppAuth } from "./auth/useMiniAppAuth.js";
import { Header } from "./components/Header.js";
import { FeedPage } from "./features/feed/FeedPage.js";
import { SubscriptionGate } from "./features/subscription/SubscriptionGate.js";
import { SubscriptionPopup } from "./features/subscription/SubscriptionPopup.js";
import { useSubscription } from "./features/subscription/useSubscription.js";
import { logout } from "./lib/api.js";
import { onSessionExpired } from "./lib/session-events.js";
import { isMiniApp } from "./telegram/context.js";

export function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const handleAuthenticated = useCallback((newToken: string) => {
    setToken(newToken);
  }, []);
  // Signing out only clears the local session — the watchlist (now up to
  // MAX_WATCHED_WALLETS addresses) is a saved list, not session-scoped state, so it must
  // survive a sign-out/sign-back-in the same way the rest of a user's settings do.
  //
  // Also revokes the session server-side (best-effort — see api.ts's logout) so this isn't
  // just a local UI reset: without that, the token this device is discarding would still work
  // for anyone holding a copy of it, for up to SESSION_TTL. Safe to call even when the token
  // is already invalid (e.g. triggered by onSessionExpired below, not a manual click) — the
  // server just no-ops on a jti it can't find or that's already revoked.
  const handleSignOut = useCallback(() => {
    if (token) void logout(token);
    clearToken();
    setToken(null);
  }, [token]);

  // Any authenticated request coming back 401 (expired/invalid session, OR this session
  // having been superseded by a newer login elsewhere under the same telegram_id — see
  // apps/api's one-active-session-per-user policy in session-store.ts) bounces the user back
  // to signed-out state via the same path as a manual sign-out, instead of getting stuck on a
  // generic "couldn't check subscription status" error forever (see api.ts's
  // authFetch/session-events.ts).
  useEffect(() => onSessionExpired(handleSignOut), [handleSignOut]);

  useMiniAppAuth(token, handleAuthenticated);
  // Called unconditionally (token can be null pre-login) — see useSubscription's doc comment.
  // This is the client-side reflection of apps/api's requireActiveSubscription guard: the
  // dashboard (FeedPage) only ever mounts while status is "trial"/"active", same condition
  // the server enforces on every route it calls.
  const subscription = useSubscription(token);

  if (token) {
    const session = decodeSessionToken(token);
    const hasAccess = subscription.status === "trial" || subscription.status === "active";
    return (
      <>
        {session && (
          <Header
            session={session}
            token={token}
            onSignOut={handleSignOut}
            onOpenSubscription={() => setIsSubscriptionOpen(true)}
          />
        )}
        {subscription.status === "loading" && <p className="ht-signing-in">Loading…</p>}
        {hasAccess && <FeedPage token={token} />}
        {subscription.status === "none" && <SubscriptionGate subscription={subscription} />}
        {subscription.status === "error" && (
          <p className="ht-signing-in">
            Couldn't check subscription status — check your connection and reload.
          </p>
        )}
        {isSubscriptionOpen && (
          <SubscriptionPopup
            subscription={subscription}
            onClose={() => setIsSubscriptionOpen(false)}
          />
        )}
      </>
    );
  }

  if (isMiniApp()) {
    return <p className="ht-signing-in">Signing in…</p>;
  }

  return (
    <main className="ht-login">
      <h1>DeepSight</h1>
      <p>Sign in with Telegram to see your live feed.</p>
      <LoginWidget onAuthenticated={handleAuthenticated} />
    </main>
  );
}
