import type { Session } from "@hypertracker/shared/auth/session";
import { useEffect } from "react";
import { authenticateWithMiniApp } from "../lib/api.js";
import { setMiniAppToken } from "../lib/mini-app-session.js";
import { getTelegramWebApp, isMiniApp } from "../telegram/context.js";

// Re-runs whenever session is null while inside a Mini App — covers both the initial mount
// (session starts null) and a forced sign-out after a 401 (see onSessionExpired in App.tsx),
// so an expired session gets silently refreshed from Telegram's initData instead of
// stranding the user on the "Signing in…" screen. The resulting token is held in memory only
// (mini-app-session.ts) — never localStorage/sessionStorage — since Telegram's Mini App
// WebView/iframe embedding makes Web Storage/cookie persistence unreliable across platforms,
// and re-authenticating silently on every fresh mount costs nothing the user can perceive.
export function useMiniAppAuth(
  session: Session | null,
  onAuthenticated: (session: Session) => void,
): void {
  useEffect(() => {
    if (session || !isMiniApp()) return;

    const webApp = getTelegramWebApp();
    if (!webApp) return;
    webApp.ready();

    let cancelled = false;
    authenticateWithMiniApp(webApp.initData)
      .then(({ token, session: newSession }) => {
        if (cancelled) return;
        setMiniAppToken(token);
        onAuthenticated(newSession);
      })
      .catch((err: unknown) => {
        console.error("mini-app auth failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [session, onAuthenticated]);
}
