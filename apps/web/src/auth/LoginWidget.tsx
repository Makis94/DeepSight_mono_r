import type { Session } from "@hypertracker/shared/auth/session";
import { useEffect, useRef } from "react";
import { authenticateWithLoginWidget } from "../lib/api.js";

declare global {
  interface Window {
    onDeepSightTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}

interface LoginWidgetProps {
  onAuthenticated: (session: Session) => void;
}

export function LoginWidget({ onAuthenticated }: LoginWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.onDeepSightTelegramAuth = (user) => {
      const payload: Record<string, string> = {};
      for (const [key, value] of Object.entries(user)) {
        payload[key] = String(value);
      }
      // apps/api sets the session as an httpOnly cookie on this response (see auth/routes.ts)
      // — there's no token here for the client to hold onto, deliberately.
      authenticateWithLoginWidget(payload)
        .then((session) => {
          onAuthenticated(session);
        })
        .catch((err: unknown) => {
          console.error("login widget auth failed", err);
        });
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", import.meta.env.VITE_BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onDeepSightTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    const container = containerRef.current;
    container?.appendChild(script);

    return () => {
      delete window.onDeepSightTelegramAuth;
      // Without this, React 18 StrictMode's dev-mode double-invoke (mount → cleanup →
      // mount) leaves the first run's <script> (and the iframe telegram-widget.js injects
      // next to it) in the DOM alongside a second one — two overlapping widget instances
      // whose iframe↔parent postMessage wiring breaks data-onauth entirely, silently.
      container?.replaceChildren();
    };
  }, [onAuthenticated]);

  return <div ref={containerRef} />;
}
