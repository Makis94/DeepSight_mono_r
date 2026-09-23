import type { Session } from "@hypertracker/shared/auth/session";
import type { LeaderboardEntry } from "@hypertracker/shared/schemas/trading";
import { useEffect, useState } from "react";
import { getTradingLeaderboard } from "../../lib/api.js";

const POLL_INTERVAL_MS = 60_000;

export interface LeaderboardState {
  entries: LeaderboardEntry[];
  loading: boolean;
  error: string | null;
}

export function useLeaderboard(session: Session | null): LeaderboardState {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const result = await getTradingLeaderboard();
        if (!cancelled) setEntries(result);
      } catch (err) {
        if (!cancelled) {
          console.error("failed to load leaderboard", err);
          setError(err instanceof Error ? err.message : "failed to load leaderboard");
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

  return { entries, loading, error };
}
