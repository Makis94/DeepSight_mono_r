import { useEffect } from "react";
import { authenticateWithMiniApp } from "../lib/api.js";
import { getTelegramWebApp, isMiniApp } from "../telegram/context.js";
import { storeToken } from "./session.js";

// Re-runs whenever token is null while inside a Mini App — covers both the initial mount
// (token starts null) and a forced sign-out after a 401 (see onSessionExpired in App.tsx),
// so an expired session gets silently refreshed from Telegram's initData instead of
// stranding the user on the "Signing in…" screen.
export function useMiniAppAuth(
  token: string | null,
  onAuthenticated: (token: string) => void,
): void {
  useEffect(() => {
    if (token || !isMiniApp()) return;

    const webApp = getTelegramWebApp();
    if (!webApp) return;
    webApp.ready();

    let cancelled = false;
    authenticateWithMiniApp(webApp.initData)
      .then((newToken) => {
        if (cancelled) return;
        storeToken(newToken);
        onAuthenticated(newToken);
      })
      .catch((err: unknown) => {
        console.error("mini-app auth failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [token, onAuthenticated]);
}
