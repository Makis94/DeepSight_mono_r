import { useEffect, useState } from "react";
import { CoinFilter } from "../../feed/components/CoinFilter.js";
import type { RiskLimitsState } from "../useRiskLimits.js";
import { useTradingCoins } from "../useTradingCoins.js";

// One-tap suggestions, not defaults: on liquid majors the predicted impact yields brackets of a
// few bps, smaller than the ~6 bps round-trip fee, so paper trades there cannot profit
// (2026-09-25 audit). Nothing is pre-selected — the user opts in.
const QUICK_IGNORE_COINS = ["BTC", "ETH", "SOL"] as const;

interface RiskLimitsFormProps {
  riskLimits: RiskLimitsState;
}

export function RiskLimitsForm({ riskLimits }: RiskLimitsFormProps) {
  const { limits, loading, saving, error, save } = riskLimits;
  const [baseSizeUsd, setBaseSizeUsd] = useState("");
  const [maxPositionUsd, setMaxPositionUsd] = useState("");
  const [maxDailyLossUsd, setMaxDailyLossUsd] = useState("");
  const [ignoredCoins, setIgnoredCoins] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const coinOptions = useTradingCoins(limits !== null);
  // Saved tags must stay selectable/visible even if a coin isn't in the fetched options.
  const allCoins = [...new Set([...coinOptions, ...ignoredCoins])].sort();

  // Seeds the form once the server values arrive — a plain useEffect rather than deriving
  // render-time (uncontrolled -> controlled inputs need an explicit initial value, and the
  // user may have already started typing by the time a slow load resolves, which this only
  // overwrites once).
  useEffect(() => {
    if (!limits) return;
    setBaseSizeUsd(limits.baseSizeUsd);
    setMaxPositionUsd(limits.maxPositionUsd);
    setMaxDailyLossUsd(limits.maxDailyLossUsd);
    setIgnoredCoins(limits.ignoredCoins);
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
          void save({ baseSizeUsd, maxPositionUsd, maxDailyLossUsd, ignoredCoins }).then((ok) => {
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
        <div className="ht-trading-ignored">
          <span className="ht-trading-ignored-title">Ignored coins</span>
          <p className="ht-trading-muted">
            No new trades on these coins. Open trades keep running to their own TP/SL.
          </p>
          <CoinFilter
            coins={allCoins}
            selected={ignoredCoins}
            onAdd={(coin) =>
              setIgnoredCoins((prev) => (prev.includes(coin) ? prev : [...prev, coin]))
            }
            onRemove={(coin) => setIgnoredCoins((prev) => prev.filter((c) => c !== coin))}
          />
          <div className="ht-trading-quick-ignore">
            {QUICK_IGNORE_COINS.filter((coin) => !ignoredCoins.includes(coin)).map((coin) => (
              <button
                key={coin}
                type="button"
                className="ht-btn"
                onClick={() => setIgnoredCoins((prev) => [...prev, coin])}
              >
                + {coin}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" className="ht-btn" disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
        {error && <p className="ht-trading-error">{error}</p>}
      </form>
    </section>
  );
}
