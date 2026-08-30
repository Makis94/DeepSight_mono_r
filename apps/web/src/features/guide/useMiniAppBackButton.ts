import { useEffect } from "react";
import { getTelegramWebApp, isMiniApp } from "../../telegram/context.js";

// Dual-context nav rule (CLAUDE.md): inside the Mini App, back navigation must use
// Telegram's native BackButton instead of an in-page control — GuidePage only renders its
// own "← Back" link in the standalone-site branch, this covers the Mini App one.
export function useMiniAppBackButton(onBack: () => void, active: boolean): void {
  useEffect(() => {
    if (!active || !isMiniApp()) return;
    const backButton = getTelegramWebApp()?.BackButton;
    if (!backButton) return;

    backButton.onClick(onBack);
    backButton.show();
    return () => {
      backButton.offClick(onBack);
      backButton.hide();
    };
  }, [active, onBack]);
}
