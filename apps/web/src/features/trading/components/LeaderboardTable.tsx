import type { LeaderboardState } from "../useLeaderboard.js";
import { truncateAddress } from "../../../lib/format.js";

interface LeaderboardTableProps {
  leaderboard: LeaderboardState;
}

// Ranked by effectiveScore (confidence-adjusted), not the raw score column — see
// packages/trading-core evaluateWalletTrust's doc comment: a same-day burst of fake-looking
// good behavior must not be able to buy the top spot here either. apps/api's
// GET /trading/leaderboard already orders by effectiveScore server-side; this just renders
// what comes back.
export function LeaderboardTable({ leaderboard }: LeaderboardTableProps) {
  const { entries, loading, error } = leaderboard;

  return (
    <section className="ht-section">
      <h3>Top TWAP wallets</h3>
      <p className="ht-trading-muted">
        External Hyperliquid wallets ranked by Trust Score — how reliably their large TWAP orders
        run to completion. This drives how much weight their signals get, not who we follow (every
        threshold-passing TWAP is considered; this score only sizes it).
      </p>
      {loading && <p className="ht-trading-muted">Loading…</p>}
      {error && <p className="ht-trading-error">{error}</p>}
      {!loading && entries.length === 0 && (
        <p className="ht-trading-muted">No scored wallets yet.</p>
      )}
      {entries.length > 0 && (
        <div className="ht-table-scroll">
          <table className="ht-table">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Score</th>
                <th>Confidence</th>
                <th>Executed</th>
                <th>Cancelled</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.walletAddress}>
                  <td>{truncateAddress(entry.walletAddress)}</td>
                  <td>{Number(entry.effectiveScore).toFixed(1)}</td>
                  <td>{(Number(entry.confidence) * 100).toFixed(0)}%</td>
                  <td>{entry.fullyExecutedCount}</td>
                  <td>{entry.cancelledCount}</td>
                  <td>
                    {entry.blocked ? (
                      <span className="ht-trading-badge ht-trading-badge-blocked">Blocked</span>
                    ) : (
                      <span className="ht-trading-badge ht-trading-badge-ok">Tracked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
