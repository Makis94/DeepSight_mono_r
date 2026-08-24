import type { Session } from "@hypertracker/shared/auth/session";
import { useCallback, useEffect, useState } from "react";
import {
  createSubscriptionInvoice,
  getSubscription,
  startTrial as startTrialRequest,
  TrialAlreadyUsedError,
} from "../../lib/api.js";
import { openExternalLink } from "../../telegram/context.js";

// "error" is distinct from "none" — "none" is a confirmed server answer ("you have no active
// subscription"), "error" means we couldn't ask at all (network/parse failure). Collapsing
// the two used to show a confident "trial already used" on a plain fetch failure.
export type SubscriptionStatus = "loading" | "trial" | "active" | "none" | "error";

export interface SubscriptionState {
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  trialAvailable: boolean;
  isBusy: boolean;
  error: string | null;
  startTrial: () => Promise<void>;
  subscribe: () => Promise<void>;
}

// The dashboard itself is only ever rendered while status is "trial"/"active" (see App.tsx),
// so this poll is what actually pulls a lapsed trial/subscription back to the gated screen
// mid-session, not just a cosmetic status refresh — the server-side guard (apps/api
// requireActiveSubscription) is the real enforcement, this just keeps the client from sitting
// on a stale "you have access" view for longer than POLL_INTERVAL_MS after it stops being true.
const POLL_INTERVAL_MS = 60_000;

// session is nullable so this can be called unconditionally at the top of App (React's rules
// of hooks forbid calling it only inside the "logged in" branch) — with no session, it just
// sits at "loading" and never fetches, which is fine since nothing renders off it in that
// case. Only its presence/absence matters here — auth itself is attached automatically by
// lib/api.ts (cookie for the standalone site, in-memory bearer token for the Mini App).
export function useSubscription(session: Session | null): SubscriptionState {
  const [status, setStatus] = useState<SubscriptionStatus>("loading");
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [trialAvailable, setTrialAvailable] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!session) return;
    try {
      const sub = await getSubscription();
      setTrialEndsAt(sub.trialEndsAt);
      setCurrentPeriodEnd(sub.currentPeriodEnd);
      setTrialAvailable(sub.trialAvailable);
      setStatus(sub.status === "trial" ? "trial" : sub.status === "active" ? "active" : "none");
    } catch (err) {
      console.error("failed to load subscription", err);
      setStatus("error");
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [session, refresh]);

  async function startTrial(): Promise<void> {
    if (!session) return;
    setIsBusy(true);
    setError(null);
    try {
      await startTrialRequest();
      await refresh();
    } catch (err) {
      if (err instanceof TrialAlreadyUsedError) {
        setTrialAvailable(false);
        setError("Trial already used on this account.");
      } else {
        setError(err instanceof Error ? err.message : "failed to start trial");
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function subscribe(): Promise<void> {
    if (!session) return;
    setIsBusy(true);
    setError(null);
    try {
      const invoice = await createSubscriptionInvoice();
      openExternalLink(invoice.invoiceUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create invoice");
    } finally {
      setIsBusy(false);
    }
  }

  return {
    status,
    trialEndsAt,
    currentPeriodEnd,
    trialAvailable,
    isBusy,
    error,
    startTrial,
    subscribe,
  };
}
