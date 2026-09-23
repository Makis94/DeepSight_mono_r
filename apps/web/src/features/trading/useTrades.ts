import type { Session } from "@hypertracker/shared/auth/session";
import type { AutoTradeResponse } from "@hypertracker/shared/schemas/trading";
import { useEffect, useState } from "react";
import { getTradingTrades } from "../../lib/api.js";

const POLL_INTERVAL_MS = 15_000;

export interface TradesState {
  trades: AutoTradeResponse[];
  loading: boolean;
  error: string | null;
}

// Polled far more often than the leaderboard (15s vs 60s) — an open paper trade's status
// (open -> closed_tp/closed_sl) is the closest thing this page has to "live" data, and
// there's no realtime-channel wiring for it yet (see CLAUDE.md's realtime-channel section —
// that's scoped to the existing feed event pipeline, trading has its own poll for now).
export function useTrades(session: Session | null): TradesState {
  const [trades, setTrades] = useState<AutoTradeResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const result = await getTradingTrades();
        if (!cancelled) setTrades(result);
      } catch (err) {
        if (!cancelled) {
          console.error("failed to load trades", err);
          setError(err instanceof Error ? err.message : "failed to load trades");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session]);

  return { trades, loading, error };
}
