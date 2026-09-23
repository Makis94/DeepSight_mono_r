import type { TradingAccountState } from "../useTradingAccount.js";
import { hasInjectedWallet } from "../../../lib/wallet.js";
import { isMiniApp } from "../../../telegram/context.js";
import { truncateAddress } from "../../../lib/format.js";

interface AccountLinkCardProps {
  account: TradingAccountState;
}

const STEP_LABEL: Record<string, string> = {
  connecting: "Connecting wallet…",
  "awaiting-signature": "Waiting for your signature…",
  confirming: "Confirming with Hyperliquid…",
};

export function AccountLinkCard({ account }: AccountLinkCardProps) {
  const {
    loading,
    linked,
    linkStatus,
    walletAddress,
    agentExpiresAt,
    tradingEnabled,
    error,
    linkStep,
    linkWallet,
    setTradingEnabled,
  } = account;

  if (loading) {
    return (
      <section className="ht-section ht-trading-account">
        <p className="ht-trading-muted">Loading account…</p>
      </section>
    );
  }

  // Wallet-connect (window.ethereum) only works in a real browser — a Telegram Mini App
  // WebView doesn't inject it (see lib/wallet.ts's own doc comment). Tell the user plainly
  // instead of showing a "Connect wallet" button that would silently do nothing. Checked
  // before the "pending" branch too — a Mini App user can't finish signing there either.
  if (isMiniApp() && !linked) {
    return (
      <section className="ht-section ht-trading-account">
        <h3>Link your Hyperliquid wallet</h3>
        <p className="ht-trading-muted">
          Wallet linking needs a browser wallet extension (MetaMask, Rabby, …) — open this site
          outside Telegram in a desktop or mobile browser to connect and sign.
        </p>
      </section>
    );
  }

  // MUST come before the generic `!linked` branch below — `linked` (useTradingAccount) is
  // `linkStatus === "linked"`, so it's also false while `linkStatus === "pending"`. Checking
  // `!linked` first would make this dead code (code-review, 2026-09-23): a user who called
  // /trading/link/start but never finished /trading/link/confirm (wallet rejected the
  // signature, tab closed mid-sign) always saw the generic first-time copy instead of this
  // resume message.
  if (linkStatus === "pending") {
    return (
      <section className="ht-section ht-trading-account">
        <h3>Link your Hyperliquid wallet</h3>
        <p className="ht-trading-muted">
          Approval started but not confirmed yet — try connecting again to finish signing.
        </p>
        <button
          type="button"
          className="ht-btn"
          disabled={linkStep !== "idle"}
          onClick={() => void linkWallet()}
        >
          {linkStep === "idle" ? "Finish linking" : STEP_LABEL[linkStep]}
        </button>
        {error && <p className="ht-trading-error">{error}</p>}
      </section>
    );
  }

  if (!linked) {
    return (
      <section className="ht-section ht-trading-account">
        <h3>Link your Hyperliquid wallet</h3>
        <p className="ht-trading-muted">
          You approve a trading agent with your own wallet — we generate the agent, you sign the
          approval, we never see or hold your private key. The agent can only place trades, it
          cannot withdraw funds.
        </p>
        {!hasInjectedWallet() && (
          <p className="ht-trading-warning">
            No browser wallet detected — install MetaMask, Rabby, or a similar extension first.
          </p>
        )}
        <button
          type="button"
          className="ht-btn"
          disabled={linkStep !== "idle"}
          onClick={() => void linkWallet()}
        >
          {linkStep === "idle" ? "Connect wallet & approve" : STEP_LABEL[linkStep]}
        </button>
        {error && <p className="ht-trading-error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="ht-section ht-trading-account">
      <h3>Your account</h3>
      <dl className="ht-trading-account-facts">
        <div>
          <dt>Wallet</dt>
          <dd>{walletAddress ? truncateAddress(walletAddress) : "—"}</dd>
        </div>
        <div>
          <dt>Agent approval</dt>
          <dd>{agentExpiresAt ? `until ${new Date(agentExpiresAt).toLocaleDateString()}` : "—"}</dd>
        </div>
      </dl>

      <label className="ht-trading-toggle">
        <input
          type="checkbox"
          checked={tradingEnabled}
          onChange={(e) => void setTradingEnabled(e.target.checked)}
        />
        <span>
          {tradingEnabled
            ? "Auto-trading is ON — new signals will open trades"
            : "Auto-trading is OFF — no new trades will open"}
        </span>
      </label>
      <p className="ht-trading-muted">
        Turning this off never closes an already-open trade — it only stops new ones from opening.
        Existing trades keep running to their own take-profit/stop-loss.
      </p>
      {error && <p className="ht-trading-error">{error}</p>}
    </section>
  );
}
