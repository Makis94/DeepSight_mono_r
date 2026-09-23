import type { Session } from "@hypertracker/shared/auth/session";
import { isMiniApp } from "../../telegram/context.js";
import { useMiniAppBackButton } from "../guide/useMiniAppBackButton.js";
import { AccountLinkCard } from "./components/AccountLinkCard.js";
import { LeaderboardTable } from "./components/LeaderboardTable.js";
import { RiskLimitsForm } from "./components/RiskLimitsForm.js";
import { TradesTable } from "./components/TradesTable.js";
import { useLeaderboard } from "./useLeaderboard.js";
import { useRiskLimits } from "./useRiskLimits.js";
import { useTradingAccount } from "./useTradingAccount.js";
import { useTrades } from "./useTrades.js";
import "./trading.css";

interface TradingPageProps {
  session: Session;
  onClose: () => void;
}

// The single unified trading page (CLAUDE.md, 2026-09-22 decision): leaderboard + this
// user's own account/linking + risk settings + trade history, all in one place rather than
// split across routes. Reuses GuidePage's full-page-overlay + useMiniAppBackButton pattern
// (App.tsx renders this instead of FeedPage while open, same as isGuideOpen).
export function TradingPage({ session, onClose }: TradingPageProps) {
  useMiniAppBackButton(onClose, true);

  const account = useTradingAccount(session);
  const riskLimits = useRiskLimits(account.linked);
  const leaderboard = useLeaderboard(session);
  const trades = useTrades(session);

  return (
    <main className="ht-page ht-trading-page">
      {!isMiniApp() && (
        <button type="button" className="ht-guide-back" onClick={onClose}>
          ← Back
        </button>
      )}
      <h2>Auto-trading</h2>

      <div className="ht-trading-banner">
        <strong>Paper mode.</strong> Every trade below is simulated — no real orders reach
        Hyperliquid yet, and nothing here risks real funds.
      </div>

      <div className="ht-column">
        <AccountLinkCard account={account} />
        {account.linked && <RiskLimitsForm riskLimits={riskLimits} />}
        <LeaderboardTable leaderboard={leaderboard} />
        {account.linked && <TradesTable trades={trades} />}
      </div>
    </main>
  );
}
