import type { Session } from "@hypertracker/shared/auth/session";
import { useCallback, useEffect, useState } from "react";
import { LoginWidget } from "./auth/LoginWidget.js";
import { useMiniAppAuth } from "./auth/useMiniAppAuth.js";
import { Header } from "./components/Header.js";
import { FeedPage } from "./features/feed/FeedPage.js";
import { SubscriptionGate } from "./features/subscription/SubscriptionGate.js";
import { SubscriptionPopup } from "./features/subscription/SubscriptionPopup.js";
import { useSubscription } from "./features/subscription/useSubscription.js";
import { getSession, logout } from "./lib/api.js";
import { setMiniAppToken } from "./lib/mini-app-session.js";
import { onSessionExpired } from "./lib/session-events.js";
import { isMiniApp } from "./telegram/context.js";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  // Standalone site only: true until the initial GET /auth/session bootstrap resolves — JS
  // can't read the httpOnly cookie to know up front whether one is already present. The Mini
  // App path doesn't need this: useMiniAppAuth's own "Signing in…" branch below covers it.
  const [isBootstrapping, setIsBootstrapping] = useState(!isMiniApp());
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const handleAuthenticated = useCallback((newSession: Session) => {
    setSession(newSession);
  }, []);
  // Signing out only clears the local session — the watchlist (now up to
  // MAX_WATCHED_WALLETS addresses) is a saved list, not session-scoped state, so it must
  // survive a sign-out/sign-back-in the same way the rest of a user's settings do.
  //
  // Also revokes the session server-side (best-effort — see api.ts's logout) so this isn't
  // just a local UI reset: without that, the session being discarded here would still work
  // for anyone holding a copy of its token, for up to SESSION_TTL. Safe to call even when
  // already signed out (e.g. triggered by onSessionExpired below, not a manual click) — the
  // server just no-ops on a token it can't find or that's already revoked.
  const handleSignOut = useCallback(() => {
    void logout();
    setMiniAppToken(null);
    setSession(null);
  }, []);

  // Any authenticated request coming back 401 (expired/invalid session, OR this session
  // having been superseded by a newer login elsewhere under the same telegram_id — see
  // apps/api's one-active-session-per-user policy in session-store.ts) bounces the user back
  // to signed-out state via the same path as a manual sign-out, instead of getting stuck on a
  // generic "couldn't check subscription status" error forever (see api.ts's
  // authFetch/session-events.ts).
  useEffect(() => onSessionExpired(handleSignOut), [handleSignOut]);

  useMiniAppAuth(session, handleAuthenticated);

  // Standalone site only: ask the server who (if anyone) the httpOnly cookie belongs to.
  // Skipped entirely in Mini App context — useMiniAppAuth above owns that path, and this
  // endpoint doesn't apply to it (there's no cookie to bootstrap from).
  useEffect(() => {
    if (isMiniApp()) return;
    let cancelled = false;
    getSession()
      .then((s) => {
        if (cancelled) return;
        setSession(s);
      })
      .catch((err: unknown) => {
        console.error("failed to load session", err);
      })
      .finally(() => {
        if (!cancelled) setIsBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Called unconditionally (session can be null pre-login) — see useSubscription's doc
  // comment. This is the client-side reflection of apps/api's requireActiveSubscription guard:
  // the dashboard (FeedPage) only ever mounts while status is "trial"/"active", same condition
  // the server enforces on every route it calls.
  const subscription = useSubscription(session);

  if (isBootstrapping) {
    return <p className="ht-signing-in">Loading…</p>;
  }

  if (session) {
    const hasAccess = subscription.status === "trial" || subscription.status === "active";
    return (
      <>
        <Header
          session={session}
          onSignOut={handleSignOut}
          onOpenSubscription={() => setIsSubscriptionOpen(true)}
        />
        {subscription.status === "loading" && <p className="ht-signing-in">Loading…</p>}
        {hasAccess && <FeedPage />}
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
