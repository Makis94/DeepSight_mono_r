import type { RiskLimitsResponse } from "@hypertracker/shared/schemas/trading";
import { useCallback, useEffect, useState } from "react";
import { getRiskLimits, updateRiskLimits } from "../../lib/api.js";

export interface RiskLimitsState {
  limits: RiskLimitsResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: (values: {
    baseSizeUsd: string;
    maxPositionUsd: string;
    maxDailyLossUsd: string;
    ignoredCoins: string[];
  }) => Promise<boolean>;
}

// Only fetched once linked — apps/api 404s /trading/risk-limits until /trading/link/confirm
// has actually run (the row is seeded there, see routes.ts), so this hook is only meaningful
// after useTradingAccount reports linked=true.
export function useRiskLimits(linked: boolean): RiskLimitsState {
  const [limits, setLimits] = useState<RiskLimitsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!linked) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    getRiskLimits()
      .then((result) => {
        if (!cancelled) setLimits(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error("failed to load risk limits", err);
          setError(err instanceof Error ? err.message : "failed to load risk limits");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [linked]);

  const save = useCallback(
    async (values: {
      baseSizeUsd: string;
      maxPositionUsd: string;
      maxDailyLossUsd: string;
      ignoredCoins: string[];
    }): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        await updateRiskLimits(values);
        setLimits(values);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "failed to save risk limits");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  return { limits, loading, saving, error, save };
}
