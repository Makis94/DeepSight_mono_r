import type { TradesState } from "../useTrades.js";
import { formatCompactUsd, formatPrice, formatTime } from "../../../lib/format.js";

interface TradesTableProps {
  trades: TradesState;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  closed_tp: "Closed (TP)",
  closed_sl: "Closed (SL)",
  closed_manual: "Closed",
  error: "Error",
};

export function TradesTable({ trades }: TradesTableProps) {
  const { trades: rows, loading, error } = trades;

  return (
    <section className="ht-section">
      <h3>Your trades</h3>
      <p className="ht-trading-muted">
        Every mode here is <strong>paper</strong> — simulated fills, no real orders reach
        Hyperliquid yet.
      </p>
      {loading && <p className="ht-trading-muted">Loading…</p>}
      {error && <p className="ht-trading-error">{error}</p>}
      {!loading && rows.length === 0 && <p className="ht-trading-muted">No trades yet.</p>}
      {rows.length > 0 && (
        <div className="ht-table-scroll">
          <table className="ht-table">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Side</th>
                <th>Size</th>
                <th>Entry</th>
                <th>SL / TP</th>
                <th>Status</th>
                <th>PnL</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((trade) => (
                <tr key={trade.id}>
                  <td>{trade.coin}</td>
                  <td className={trade.side === "buy" ? "ht-trading-long" : "ht-trading-short"}>
                    {trade.side === "buy" ? "Long" : "Short"}
                  </td>
                  <td>{formatCompactUsd(trade.sizeUsd)}</td>
                  <td>{trade.entryPx ? formatPrice(trade.entryPx) : "—"}</td>
                  <td>
                    {formatPrice(trade.stopLossPx)} / {formatPrice(trade.takeProfitPx)}
                  </td>
                  <td>{STATUS_LABEL[trade.status] ?? trade.status}</td>
                  <td
                    className={
                      trade.realizedPnlUsd === null
                        ? undefined
                        : Number(trade.realizedPnlUsd) >= 0
                          ? "ht-trading-long"
                          : "ht-trading-short"
                    }
                  >
                    {trade.realizedPnlUsd ? formatCompactUsd(trade.realizedPnlUsd) : "—"}
                  </td>
                  <td>{formatTime(trade.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
