import { useEffect, useState } from "react";
import { listTradingCoins } from "../../lib/api.js";

// Options for the ignored-coins tag picker. A failed load just leaves the picker with no
// options (already-saved tags still render) — it must never block editing the rest of the
// risk form, so errors are logged, not surfaced.
export function useTradingCoins(enabled: boolean): string[] {
  const [coins, setCoins] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listTradingCoins()
      .then((result) => {
        if (!cancelled) setCoins(result);
      })
      .catch((err: unknown) => {
        console.error("failed to load trading coins", err);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return coins;
}
