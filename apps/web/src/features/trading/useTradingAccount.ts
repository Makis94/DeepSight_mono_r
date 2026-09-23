import type { Session } from "@hypertracker/shared/auth/session";
import { useCallback, useEffect, useState } from "react";
import {
  confirmTradingLink,
  getTradingAccount,
  startTradingLink,
  updateTradingStatus,
} from "../../lib/api.js";
import { connectWallet, hasInjectedWallet, signTypedData, WalletError } from "../../lib/wallet.js";

export type LinkStep = "idle" | "connecting" | "awaiting-signature" | "confirming";

export interface TradingAccountState {
  loading: boolean;
  linked: boolean;
  linkStatus: "pending" | "linked" | "revoked" | undefined;
  walletAddress: string | null;
  agentExpiresAt: string | null;
  tradingEnabled: boolean;
  error: string | null;
  linkStep: LinkStep;
  /** Full connect-wallet → sign → confirm flow, standalone site only (see lib/wallet.ts). */
  linkWallet: () => Promise<void>;
  setTradingEnabled: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

// session is nullable so this can be called unconditionally at the top of TradingPage, same
// convention as useSubscription — with no session, it just never fetches.
export function useTradingAccount(session: Session | null): TradingAccountState {
  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState(false);
  const [linkStatus, setLinkStatus] = useState<TradingAccountState["linkStatus"]>(undefined);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [agentExpiresAt, setAgentExpiresAt] = useState<string | null>(null);
  const [tradingEnabled, setTradingEnabledState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkStep, setLinkStep] = useState<LinkStep>("idle");

  const refresh = useCallback(async (): Promise<void> => {
    if (!session) return;
    try {
      const account = await getTradingAccount();
      setLinked(account.linked);
      setLinkStatus(account.linkStatus);
      setWalletAddress(account.walletAddress ?? null);
      setAgentExpiresAt(account.agentExpiresAt ?? null);
      setTradingEnabledState(account.tradingEnabled ?? false);
    } catch (err) {
      console.error("failed to load trading account", err);
      setError(err instanceof Error ? err.message : "failed to load trading account");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const linkWallet = useCallback(async (): Promise<void> => {
    setError(null);
    if (!hasInjectedWallet()) {
      setError(
        "No browser wallet found. Open this page in a browser with MetaMask, Rabby, or a similar extension installed.",
      );
      return;
    }
    try {
      setLinkStep("connecting");
      const address = await connectWallet();

      setLinkStep("awaiting-signature");
      const { nonce, typedData } = await startTradingLink(address);
      // nonce isn't used directly here — it's embedded inside typedData.message by the
      // server (packages/hyperliquid-sdk signing.ts) and round-trips through the signature
      // itself; kept in the destructure for clarity on what startTradingLink returns.
      void nonce;
      const signature = await signTypedData(address, typedData);

      setLinkStep("confirming");
      await confirmTradingLink(signature);

      await refresh();
    } catch (err) {
      if (err instanceof WalletError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "failed to link wallet");
      }
    } finally {
      setLinkStep("idle");
    }
  }, [refresh]);

  const setTradingEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    setError(null);
    // Optimistic — the toggle is a soft, instantly-reversible setting (CLAUDE.md,
    // 2026-09-22 decision), not a destructive action worth waiting on round-trip latency
    // for. Reverted below if the request actually fails.
    setTradingEnabledState(enabled);
    try {
      await updateTradingStatus(enabled);
    } catch (err) {
      setTradingEnabledState(!enabled);
      setError(err instanceof Error ? err.message : "failed to update trading status");
    }
  }, []);

  return {
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
    refresh,
  };
}
