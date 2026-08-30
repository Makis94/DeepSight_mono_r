export interface TelegramWebApp {
  initData: string;
  ready: () => void;
  expand: () => void;
  themeParams: Record<string, string | undefined>;
  colorScheme: "light" | "dark";
  // Telegram's in-app webview blocks plain window.open/target=_blank for external URLs —
  // this is the documented way to hand off to the system browser from inside a Mini App.
  openLink?: (url: string) => void;
  // Native back-navigation chrome — see CLAUDE.md's dual-context rule: in-page "back"
  // controls (GuidePage's own "← Back" link) are for the standalone site only, this is the
  // Mini App equivalent (useMiniAppBackButton.ts).
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

/**
 * `telegram-web-app.js` defines `window.Telegram.WebApp` as an object even in a plain
 * browser tab (the script loads unconditionally) — `initData` is only ever a non-empty
 * string when actually launched inside Telegram, so that's the real signal, not just the
 * object's presence.
 */
export function isMiniApp(): boolean {
  return Boolean(getTelegramWebApp()?.initData);
}

// Dual-context external link handoff — see CLAUDE.md's Mini App/standalone-site branching
// rule. Inside the Mini App webview, window.open silently does nothing for external
// origins; outside it, openLink doesn't exist at all.
export function openExternalLink(url: string): void {
  const webApp = getTelegramWebApp();
  if (isMiniApp() && webApp?.openLink) {
    webApp.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
