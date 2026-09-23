import { useEffect, useState } from "react";
import type { RiskLimitsState } from "../useRiskLimits.js";

interface RiskLimitsFormProps {
  riskLimits: RiskLimitsState;
}

export function RiskLimitsForm({ riskLimits }: RiskLimitsFormProps) {
  const { limits, loading, saving, error, save } = riskLimits;
  const [baseSizeUsd, setBaseSizeUsd] = useState("");
  const [maxPositionUsd, setMaxPositionUsd] = useState("");
  const [maxDailyLossUsd, setMaxDailyLossUsd] = useState("");
  const [saved, setSaved] = useState(false);

  // Seeds the form once the server values arrive — a plain useEffect rather than deriving
  // render-time (uncontrolled -> controlled inputs need an explicit initial value, and the
  // user may have already started typing by the time a slow load resolves, which this only
  // overwrites once).
  useEffect(() => {
    if (!limits) return;
    setBaseSizeUsd(limits.baseSizeUsd);
    setMaxPositionUsd(limits.maxPositionUsd);
    setMaxDailyLossUsd(limits.maxDailyLossUsd);
  }, [limits]);

  if (loading) {
    return (
      <section className="ht-section">
        <p className="ht-trading-muted">Loading risk settings…</p>
      </section>
    );
  }

  return (
    <section className="ht-section">
      <h3>Risk settings</h3>
      <form
        className="ht-trading-risk-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ baseSizeUsd, maxPositionUsd, maxDailyLossUsd }).then((ok) => {
            setSaved(ok);
            if (ok) setTimeout(() => setSaved(false), 2000);
          });
        }}
      >
        <label>
          <span>Base size per signal (USD)</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="decimal"
            value={baseSizeUsd}
            onChange={(e) => setBaseSizeUsd(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Max position size (USD)</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="decimal"
            value={maxPositionUsd}
            onChange={(e) => setMaxPositionUsd(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Max daily loss before pausing new trades (USD)</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="decimal"
            value={maxDailyLossUsd}
            onChange={(e) => setMaxDailyLossUsd(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="ht-btn" disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
        {error && <p className="ht-trading-error">{error}</p>}
      </form>
    </section>
  );
}
