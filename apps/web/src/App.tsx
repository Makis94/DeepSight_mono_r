import { useCallback, useState } from "react";
import { LoginWidget } from "./auth/LoginWidget.js";
import { clearToken, decodeSessionToken, getStoredToken } from "./auth/session.js";
import { useMiniAppAuth } from "./auth/useMiniAppAuth.js";
import { Header } from "./components/Header.js";
import { FeedPage } from "./features/feed/FeedPage.js";
import { SubscriptionGate } from "./features/subscription/SubscriptionGate.js";
import { SubscriptionPopup } from "./features/subscription/SubscriptionPopup.js";
import { useSubscription } from "./features/subscription/useSubscription.js";
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
  const handleSignOut = useCallback(() => {
    clearToken();
    setToken(null);
  }, []);

  useMiniAppAuth(handleAuthenticated);
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
