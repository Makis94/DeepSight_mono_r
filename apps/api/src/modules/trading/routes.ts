import {
  autoTrades,
  riskLimits,
  tradingAccounts,
  trustScores,
  type Database,
} from "@hypertracker/db";
import {
  buildApproveAgentAction,
  buildApproveAgentTypedData,
  generateAgentWallet,
  HYPERLIQUID_REST_URLS,
  HyperliquidExchangeError,
  submitSignedAction,
} from "@hypertracker/hyperliquid-sdk";
import {
  confirmLinkBodySchema,
  startLinkBodySchema,
  updateRiskLimitsBodySchema,
  updateTradingStatusBodySchema,
} from "@hypertracker/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../../env.js";
import { requireSession } from "../auth/guard.js";
import { encryptAgentKey } from "./crypto.js";

const EXCHANGE = "hyperliquid";
// Seeded on first successful link — a trading_accounts row with no risk_limits row is
// invisible to apps/worker's risk-guard.ts (inner join), so these can never be skipped.
// PLACEHOLDER defaults, not customer-specified — small enough to be a reasonable "try it
// out" starting point for paper mode.
const DEFAULT_BASE_SIZE_USD = "50";
const DEFAULT_MAX_POSITION_USD = "200";
const DEFAULT_MAX_DAILY_LOSS_USD = "100";

// Reads the zod-validated env.HYPERLIQUID_NETWORK (default "testnet" — fails toward the
// SAFER side), not raw process.env — code-review (2026-09-23) caught that a typo'd or
// unset var must never silently resolve to mainnet here, since this feeds a REAL signed
// action submitted to Hyperliquid (unlike the read-only process.env.HYPERLIQUID_NETWORK
// pattern used elsewhere in this codebase, e.g. market-twaps/routes.ts, where the
// downside of a wrong guess is just fetching the wrong network's read-only data).
function isMainnet(): boolean {
  return env.HYPERLIQUID_NETWORK === "mainnet";
}

/**
 * The wallet-linking + account-settings + leaderboard routes behind CLAUDE.md's unified
 * apps/web trading page (2026-09-22 decision). Idle (routes never registered) unless
 * AUTO_TRADER_LINKING_ENABLED is explicitly turned on — same "off by default" shape as
 * apps/worker's USE_REAL_* flags, since this is the one path in the whole feature that talks
 * to a real user wallet and (on confirm) submits a real signed action to Hyperliquid.
 *
 * signatureChainId (packages/hyperliquid-sdk/src/signing.ts) was an OPEN VERIFICATION ITEM
 * until a real testnet approveAgent round-trip on 2026-09-24 confirmed it correct — see that
 * file's own doc comment for what was checked and how. Still testnet-only in practice: this
 * stays gated behind AUTO_TRADER_LINKING_ENABLED regardless, and enabling it against mainnet
 * is a separate decision from the chainId question this comment used to be about.
 */
export function tradingRoutes(app: FastifyInstance, db: Database): void {
  if (!env.AUTO_TRADER_LINKING_ENABLED) {
    app.log.warn("trading routes idle — AUTO_TRADER_LINKING_ENABLED is false");
    return;
  }
  if (!env.AGENT_KEY_ENCRYPTION_KEY) {
    throw new Error(
      "AUTO_TRADER_LINKING_ENABLED is true but AGENT_KEY_ENCRYPTION_KEY is unset — refusing to start rather than generate agent keys with nowhere safe to put them",
    );
  }
  const encryptionKey = env.AGENT_KEY_ENCRYPTION_KEY;

  app.get("/trading/account", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    const [account] = await db
      .select()
      .from(tradingAccounts)
      .where(
        and(
          eq(tradingAccounts.telegramId, session.telegramId),
          eq(tradingAccounts.exchange, EXCHANGE),
        ),
      )
      .limit(1);

    if (!account) return { linked: false };

    return {
      linked: account.linkStatus === "linked",
      linkStatus: account.linkStatus,
      walletAddress: account.walletAddress,
      agentExpiresAt: account.agentExpiresAt?.toISOString() ?? null,
      tradingEnabled: account.tradingEnabled,
      mode: account.mode,
    };
  });

  // Step 1 of linking: generate an agent keypair server-side and hand back the EIP-712
  // payload for the FRONTEND's own connected wallet to sign — we never see the user's
  // private key. See packages/hyperliquid-sdk signing.ts for exactly what gets built.
  app.post("/trading/link/start", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    const body = startLinkBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid wallet address" });
      return;
    }

    // A row with linkStatus "linked" holds the only copy of a real, already-approved agent's
    // private key — the onConflictDoUpdate below is only safe to run over a "pending" (never
    // approved) or absent row (code-review, 2026-09-23: this route previously overwrote a
    // linked row unconditionally, generating a fresh agent and destroying the encrypted key
    // for the agent Hyperliquid still has approved, making it permanently uncontrollable).
    const [existing] = await db
      .select({ linkStatus: tradingAccounts.linkStatus })
      .from(tradingAccounts)
      .where(
        and(
          eq(tradingAccounts.telegramId, session.telegramId),
          eq(tradingAccounts.exchange, EXCHANGE),
        ),
      )
      .limit(1);
    if (existing?.linkStatus === "linked") {
      await reply
        .status(409)
        .send({ error: "account already linked — unlink before starting a new link" });
      return;
    }

    const agent = generateAgentWallet();
    const nonce = Date.now();
    const action = buildApproveAgentAction(agent.address, nonce, isMainnet());
    const typedData = buildApproveAgentTypedData(action);
    const agentPrivateKeyEncrypted = encryptAgentKey(agent.privateKeyHex, encryptionKey);

    // Re-starting a link (e.g. the user picked a different wallet, or abandoned a previous
    // attempt) replaces the pending agent outright — the old agent's key is simply
    // overwritten and never gets approved, harmless since it was never anything but a
    // freshly generated keypair with no funds or approval behind it.
    await db
      .insert(tradingAccounts)
      .values({
        telegramId: session.telegramId,
        exchange: EXCHANGE,
        walletAddress: body.data.walletAddress,
        agentAddress: agent.address,
        agentPrivateKeyEncrypted,
        linkStatus: "pending",
        pendingNonce: nonce,
      })
      .onConflictDoUpdate({
        target: [tradingAccounts.telegramId, tradingAccounts.exchange],
        set: {
          walletAddress: body.data.walletAddress,
          agentAddress: agent.address,
          agentPrivateKeyEncrypted,
          linkStatus: "pending",
          pendingNonce: nonce,
          updatedAt: new Date(),
        },
      });

    return { agentAddress: agent.address, nonce, typedData };
  });

  // Step 2: the frontend posts back the {r,s,v} its wallet produced signing the exact
  // typedData from /trading/link/start. This route reconstructs the byte-identical action
  // (same agentAddress + pendingNonce) and submits it to Hyperliquid's real /exchange —
  // the first point in this whole feature where anything reaches Hyperliquid.
  app.post("/trading/link/confirm", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    const body = confirmLinkBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid signature" });
      return;
    }

    const [account] = await db
      .select()
      .from(tradingAccounts)
      .where(
        and(
          eq(tradingAccounts.telegramId, session.telegramId),
          eq(tradingAccounts.exchange, EXCHANGE),
        ),
      )
      .limit(1);

    if (!account || account.linkStatus !== "pending" || account.pendingNonce === null) {
      await reply.status(409).send({ error: "no pending link — call /trading/link/start first" });
      return;
    }

    const network = isMainnet() ? "mainnet" : "testnet";
    const action = buildApproveAgentAction(account.agentAddress, account.pendingNonce, isMainnet());

    try {
      await submitSignedAction(
        HYPERLIQUID_REST_URLS[network],
        action,
        account.pendingNonce,
        body.data.signature,
      );
    } catch (err) {
      if (err instanceof HyperliquidExchangeError) {
        request.log.warn(
          { err: err.message, telegramId: session.telegramId },
          "approveAgent rejected by Hyperliquid",
        );
        await reply
          .status(502)
          .send({ error: `Hyperliquid rejected the approval: ${err.message}` });
        return;
      }
      throw err;
    }

    // Hyperliquid caps agent expiry at 180 days from approval (nonces-and-api-wallets docs,
    // verified 2026-09-20) — recorded here rather than read back, since there's no documented
    // info request that returns it directly for a given agent address.
    const agentExpiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    await db
      .update(tradingAccounts)
      .set({ linkStatus: "linked", agentExpiresAt, pendingNonce: null, updatedAt: new Date() })
      .where(eq(tradingAccounts.id, account.id));

    await db
      .insert(riskLimits)
      .values({
        tradingAccountId: account.id,
        baseSizeUsd: DEFAULT_BASE_SIZE_USD,
        maxPositionUsd: DEFAULT_MAX_POSITION_USD,
        maxDailyLossUsd: DEFAULT_MAX_DAILY_LOSS_USD,
      })
      .onConflictDoNothing({ target: riskLimits.tradingAccountId });

    return { linked: true };
  });

  // The single checkbox from CLAUDE.md's unified apps/web page decision (2026-09-22):
  // checked = tradingEnabled true, unchecked = soft stop. Gates only NEW entries —
  // apps/worker/src/auto-trader's position-monitor keeps managing already-open trades
  // regardless of this flag.
  app.patch("/trading/account/status", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    const body = updateTradingStatusBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid body" });
      return;
    }

    const [account] = await db
      .select({ id: tradingAccounts.id, linkStatus: tradingAccounts.linkStatus })
      .from(tradingAccounts)
      .where(
        and(
          eq(tradingAccounts.telegramId, session.telegramId),
          eq(tradingAccounts.exchange, EXCHANGE),
        ),
      )
      .limit(1);
    if (!account || account.linkStatus !== "linked") {
      await reply.status(409).send({ error: "wallet not linked" });
      return;
    }

    await db
      .update(tradingAccounts)
      .set({ tradingEnabled: body.data.tradingEnabled, updatedAt: new Date() })
      .where(eq(tradingAccounts.id, account.id));

    return { tradingEnabled: body.data.tradingEnabled };
  });

  app.get("/trading/risk-limits", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    const [row] = await db
      .select({
        baseSizeUsd: riskLimits.baseSizeUsd,
        maxPositionUsd: riskLimits.maxPositionUsd,
        maxDailyLossUsd: riskLimits.maxDailyLossUsd,
      })
      .from(riskLimits)
      .innerJoin(tradingAccounts, eq(tradingAccounts.id, riskLimits.tradingAccountId))
      .where(
        and(
          eq(tradingAccounts.telegramId, session.telegramId),
          eq(tradingAccounts.exchange, EXCHANGE),
        ),
      )
      .limit(1);

    if (!row) {
      await reply.status(404).send({ error: "wallet not linked" });
      return;
    }
    return row;
  });

  app.patch("/trading/risk-limits", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    const body = updateRiskLimitsBodySchema.safeParse(request.body);
    if (
      !body.success ||
      (body.data.baseSizeUsd === undefined &&
        body.data.maxPositionUsd === undefined &&
        body.data.maxDailyLossUsd === undefined)
    ) {
      await reply
        .status(400)
        .send({ error: "provide at least one of baseSizeUsd/maxPositionUsd/maxDailyLossUsd" });
      return;
    }

    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(
        and(
          eq(tradingAccounts.telegramId, session.telegramId),
          eq(tradingAccounts.exchange, EXCHANGE),
        ),
      )
      .limit(1);
    if (!account) {
      await reply.status(404).send({ error: "wallet not linked" });
      return;
    }

    // .returning() lets us tell "updated a real row" from "matched nothing" — code-review
    // (2026-09-23) caught that this used to run a bare UPDATE and always answer {ok:true},
    // even when no risk_limits row exists yet (only created in /trading/link/confirm, so a
    // PATCH sent while linkStatus is still "pending" would silently persist nothing while
    // telling the client it saved).
    const [updated] = await db
      .update(riskLimits)
      .set({
        ...(body.data.baseSizeUsd !== undefined && { baseSizeUsd: body.data.baseSizeUsd }),
        ...(body.data.maxPositionUsd !== undefined && { maxPositionUsd: body.data.maxPositionUsd }),
        ...(body.data.maxDailyLossUsd !== undefined && {
          maxDailyLossUsd: body.data.maxDailyLossUsd,
        }),
        updatedAt: new Date(),
      })
      .where(eq(riskLimits.tradingAccountId, account.id))
      .returning({ id: riskLimits.id });

    if (!updated) {
      await reply
        .status(404)
        .send({ error: "risk limits not initialized yet — finish linking first" });
      return;
    }

    return { ok: true };
  });

  // Top TWAP-initiating wallets by Trust Score — spec §3's "самых надежных по рейтингу"
  // leaderboard (CLAUDE.md, 2026-09-22). These are EXTERNAL wallets apps/worker's
  // auto-trader watches/scores, not our own users.
  app.get("/trading/leaderboard", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    const rows = await db
      .select({
        walletAddress: trustScores.walletAddress,
        score: trustScores.score,
        confidence: trustScores.confidence,
        effectiveScore: trustScores.effectiveScore,
        blocked: trustScores.blocked,
        totalSignals: trustScores.totalSignals,
        fullyExecutedCount: trustScores.fullyExecutedCount,
        cancelledCount: trustScores.cancelledCount,
        lastEventAt: trustScores.lastEventAt,
      })
      .from(trustScores)
      .where(eq(trustScores.exchange, EXCHANGE))
      // Ranked by effectiveScore (confidence-adjusted — packages/trading-core
      // evaluateWalletTrust, 2026-09-22), not raw score: a same-day burst of fake-looking
      // good behavior must not be able to buy the top spot on this leaderboard either.
      .orderBy(desc(trustScores.effectiveScore))
      .limit(50);

    return {
      entries: rows.map((row) => ({ ...row, lastEventAt: row.lastEventAt?.toISOString() ?? null })),
    };
  });

  // This user's own auto-trades (paper today) — the activity feed on the unified page.
  app.get("/trading/trades", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;

    const [account] = await db
      .select({ id: tradingAccounts.id, mode: tradingAccounts.mode })
      .from(tradingAccounts)
      .where(
        and(
          eq(tradingAccounts.telegramId, session.telegramId),
          eq(tradingAccounts.exchange, EXCHANGE),
        ),
      )
      .limit(1);
    if (!account) return { trades: [] };

    const rows = await db
      .select()
      .from(autoTrades)
      .where(eq(autoTrades.tradingAccountId, account.id))
      .orderBy(desc(autoTrades.openedAt))
      .limit(50);

    return {
      trades: rows.map((row) => ({
        id: row.id,
        coin: row.coin,
        side: row.side,
        sizeUsd: row.sizeUsd,
        entryPx: row.entryPx,
        stopLossPx: row.stopLossPx,
        takeProfitPx: row.takeProfitPx,
        status: row.status,
        realizedPnlUsd: row.realizedPnlUsd,
        mode: account.mode,
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
      })),
    };
  });
}
