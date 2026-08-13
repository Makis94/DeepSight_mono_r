import { useEffect, useState } from "react";
import { authenticateWithMiniApp } from "../lib/api.js";
import { getTelegramWebApp, isMiniApp } from "../telegram/context.js";
import { storeToken } from "./session.js";

export function useMiniAppAuth(onAuthenticated: (token: string) => void): void {
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (attempted || !isMiniApp()) return;
    setAttempted(true);

    const webApp = getTelegramWebApp();
    if (!webApp) return;
    webApp.ready();

    authenticateWithMiniApp(webApp.initData)
      .then((token) => {
        storeToken(token);
        onAuthenticated(token);
      })
      .catch((err: unknown) => {
        console.error("mini-app auth failed", err);
      });
  }, [attempted, onAuthenticated]);
}
