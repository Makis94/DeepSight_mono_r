import { autoTrades, triggerEvaluations, type Database } from "@hypertracker/db";
import { sql } from "drizzle-orm";
import {
  computeCounterFlowAdjustment,
  computeNetFlow,
  computePositionSizeUsd,
  Decimal,
  deriveStopLossTakeProfit,
  estimatePriceImpact,
  evaluateTierTrigger,
  validateBracket,
  type ActiveTwap,
  type ExecutionAdapter,
  type OrderBookSource,
  type TwapSignal,
} from "@hypertracker/trading-core";
import type { Logger } from "pino";
import { classifyCoin, TIER_BASES } from "./tier-config.js";
import type { MarketDataCache } from "./market-data-cache.js";
import type { MidPriceCache } from "../twap-watcher/mid-price-cache.js";
import type { RiskGuard } from "./risk-guard.js";
import type { TrustScoreStore } from "./trust-score-store.js";

// Below this, a computed position is not worth the trouble of a simulated (or, in Phase B,
// real) order — Hyperliquid's own $10 minimum order value (hyperliquid-docs MCP, verified
// 2026-09-20) is the hard floor; this stays comfortably above it.
const MIN_POSITION_SIZE_USD = 15;

export interface TriggerPipelineDeps {
  db: Database;
  orderBookSource: OrderBookSource;
  marketData: MarketDataCache;
  midPrices: MidPriceCache;
  trustScores: TrustScoreStore;
  riskGuard: RiskGuard;
  executionAdapter: ExecutionAdapter;
  logger: Logger;
}

/**
 * Evaluates ONE "activated", non-reduceOnly TwapSignal against every open question spec §1-§5
 * and §7 raise (tier threshold, price impact, Trust Score, counter-flow), then fans the
 * resulting position size out to every eligible linked account (risk-guard.ts). Spec §6
 * (reverse trade) is explicitly descoped — see CLAUDE.md, 2026-09-22 — so this only ever
 * opens the main-direction trade.
 *
 * Logs exactly one trigger_evaluations row per call, regardless of how many (if any)
 * accounts actually got a trade — see that table's own doc comment for why "skipped"/
 * "reduced" rows matter as much as "opened" ones for future calibration.
 */
export async function evaluateTrigger(
  signal: TwapSignal,
  activeTwaps: readonly ActiveTwap[],
  deps: TriggerPipelineDeps,
): Promise<void> {
  const { db, logger } = deps;

  const tier = classifyCoin(signal.coin);
  const base = TIER_BASES[tier];
  const baseDayNtlVlm = deps.marketData.dayNtlVlm(base.baseCoin);
  const coinDayNtlVlm = deps.marketData.dayNtlVlm(signal.coin);
  // baseDayNtlVlm must be > 0, not just defined — code-review (2026-09-23) caught that
  // computeTierThresholdUsd (packages/trading-core) throws unconditionally when the tier's
  // base coin volume is <=0 (unlike coinDayNtlVlm<=0, which it handles gracefully by
  // falling back to the base threshold). An uncaught throw here would propagate past this
  // function's own "exactly one trigger_evaluations row per signal" contract for as long as
  // a degraded metaAndAssetCtxs reading persists.
  if (
    baseDayNtlVlm === undefined ||
    new Decimal(baseDayNtlVlm).lte(0) ||
    coinDayNtlVlm === undefined
  ) {
    logger.debug(
      { coin: signal.coin, tier },
      "market data not warm yet — skipping trigger evaluation",
    );
    return;
  }

  const mid = deps.midPrices.get(signal.coin);
  if (mid === undefined) {
    logger.debug({ coin: signal.coin }, "no mid price available — skipping trigger evaluation");
    return;
  }
  // mid.price is MidPriceCache's (apps/worker/src/twap-watcher, shared) own `number` — the one
  // blessed conversion point into this function's otherwise all-decimal money arithmetic.
  const actualNotionalUsd = new Decimal(signal.totalSize).abs().times(mid.price).toString();

  const tierResult = evaluateTierTrigger(actualNotionalUsd, signal.durationMinutes, {
    base: { ...base, baseDayNtlVlm },
    coinDayNtlVlm,
  });
  if (!tierResult.passesThreshold) return; // not a candidate at all — no trigger_evaluations row

  // Trust evaluation BEFORE the l2Book fetch, deliberately — a blocked wallet (manipulation
  // defense, packages/trading-core evaluateWalletTrust, 2026-09-22) skips the trade
  // regardless of price impact, so there is no reason to spend that REST call finding out.
  const trustEval = await deps.trustScores.getTrustEvaluation(signal.wallet, signal.occurredAt);

  // Excludes the triggering signal itself — code-review (2026-09-23) caught that
  // activeTwaps.upsert() runs (apps/worker/src/auto-trader/index.ts) before this function is
  // called, so without this filter a TWAP counted itself as part of the "parallel" pressure
  // opposing (or reinforcing) its own trigger, inflating trigger_evaluations.counterFlowNetUsd
  // by the trigger's own size on every single row.
  const otherActiveTwaps = activeTwaps.filter((twap) => twap.externalId !== signal.externalId);
  const netFlow = computeNetFlow(otherActiveTwaps, signal.coin);
  const counterFlow = computeCounterFlowAdjustment(signal.side, actualNotionalUsd, netFlow);

  // Checked here, BEFORE the trigger_evaluations insert below — code-review (2026-09-23)
  // caught that this used to run AFTER that insert, so a signal that cleared every
  // signal-level gate but landed while the kill switch was active still got persisted with
  // decision "opened"/"reduced" even though zero trades actually opened, corrupting the
  // audit trail a future backtest replays against.
  const globalKillSwitch = await deps.riskGuard.isGlobalKillSwitchActive();

  const signalSkip = trustEval.blocked || counterFlow.skip || globalKillSwitch;

  // Only fetch the book (and compute price impact / SL-TP off it) if there's any chance of
  // actually opening a trade — a skip decided above never needs it. entryPx/stopLossPx/
  // takeProfitPx are decimal strings (money); maxMovePct is a percentage, stays `number`.
  // entryPx is the TOUCH (best ask for a buy, best bid for a sell) and is the single price
  // reference for the whole bracket: the paper fill AND the SL/TP are anchored to it.
  let entryPx: string | undefined;
  let maxMovePct: number | undefined;
  let depthExhausted: boolean | undefined;
  let stopLossPx: string | undefined;
  let takeProfitPx: string | undefined;
  let spreadPx: string | undefined;
  let bracketRejection: string | undefined;
  if (!signalSkip) {
    const book = await deps.orderBookSource.getBook(signal.coin);
    // Walk the side the TWAP itself trades INTO — a buy TWAP lifts asks, a sell TWAP hits
    // bids (see packages/trading-core price-impact.ts's own doc comment). The exchange
    // (Hyperliquid today, via HyperliquidOrderBookSource) already normalizes to
    // {price, size} — trigger-pipeline.ts never sees an exchange-specific book shape.
    const bookSide = signal.side === "buy" ? book.asks : book.bids;
    const bestAsk = book.asks[0];
    const bestBid = book.bids[0];
    const bestLevel = bookSide[0];
    // Both sides are needed now: the spread (ask - bid) is what tells validateBracket whether
    // a derived stop is real or just quoting noise.
    if (!bestLevel || !bestAsk || !bestBid) {
      logger.warn(
        { coin: signal.coin, side: signal.side },
        "empty order book side — skipping trigger",
      );
      return;
    }
    entryPx = bestLevel.price;
    spreadPx = new Decimal(bestAsk.price).minus(bestBid.price).toString();
    const impact = estimatePriceImpact(bookSide, actualNotionalUsd);
    maxMovePct = impact.maxMovePct;
    depthExhausted = impact.depthExhausted;
    const sltp = deriveStopLossTakeProfit(entryPx, impact.maxMovePct, signal.side);
    stopLossPx = sltp.stopLossPx;
    takeProfitPx = sltp.takeProfitPx;

    // Skip (and log why) instead of opening a trade whose bracket is born invalid — zero-width
    // when the TWAP fits inside the first book level, stop on the wrong side, or stop inside the
    // spread (2026-09-25 audit: 28 of 78 paper trades were malformed this way).
    const bracket = validateBracket({
      side: signal.side,
      entryPx,
      stopLossPx,
      takeProfitPx,
      spreadPx,
    });
    if (!bracket.valid) bracketRejection = bracket.reason;
  }

  const skip = signalSkip || bracketRejection !== undefined;
  // Both multipliers feed the actual position size (computePositionSizeUsd below) — checking
  // only counterFlow.sizeMultiplier mislabeled every trust-reduced-but-not-counter-flow-
  // reduced trade as "opened" (code-review, 2026-09-23), corrupting trigger_evaluations, the
  // table this whole calibration effort depends on (see its own doc comment).
  const decision = skip
    ? "skipped"
    : counterFlow.sizeMultiplier < 1 || trustEval.sizeMultiplier < 1
      ? "reduced"
      : "opened";

  const [evaluation] = await db
    .insert(triggerEvaluations)
    .values({
      exchange: signal.exchange,
      externalTwapId: signal.externalId,
      walletAddress: signal.wallet,
      coin: signal.coin,
      tier,
      side: signal.side,
      triggerNotionalUsd: actualNotionalUsd,
      thresholdUsd: tierResult.thresholdUsd,
      // Effective (confidence-adjusted) score — what actually drove the decision. rawScore/
      // confidence are in `detail` below for full transparency. Not money (a dimensionless
      // score, CLAUDE.md's money rule doesn't apply) — computed as `number`, stringified only
      // for this decimal-typed DB column.
      trustScoreAtEval: trustEval.effectiveScore.toString(),
      counterFlowNetUsd: netFlow.netFlowUsd,
      decision,
      detail: {
        normalizedNotionalUsd: tierResult.normalizedNotionalUsd,
        entryPx,
        spreadPx,
        maxMovePct,
        depthExhausted,
        stopLossPx,
        takeProfitPx,
        rawTrustScore: trustEval.rawScore,
        trustConfidence: trustEval.confidence,
        trustBlocked: trustEval.blocked,
        trustMultiplier: trustEval.sizeMultiplier,
        counterFlowMultiplier: counterFlow.sizeMultiplier,
        skipReason: trustEval.blocked
          ? "wallet_blocked"
          : counterFlow.skip
            ? "counter_flow"
            : globalKillSwitch
              ? "kill_switch"
              : bracketRejection !== undefined
                ? `invalid_bracket:${bracketRejection}`
                : undefined,
      },
      occurredAt: signal.occurredAt,
    })
    .returning({ id: triggerEvaluations.id });

  if (skip) {
    logger.info(
      {
        coin: signal.coin,
        wallet: signal.wallet,
        blocked: trustEval.blocked,
        counterFlowSkip: counterFlow.skip,
        globalKillSwitch,
        bracketRejection,
      },
      "trigger skipped",
    );
    return;
  }

  // Narrows entryPx/stopLossPx/takeProfitPx from `number | undefined` to `number` for
  // everything below — guaranteed set by the `!skip` branch above (this block is
  // unreachable when skip is true, since that path already returned), but written as an
  // explicit guard rather than a non-null assertion.
  if (entryPx === undefined || stopLossPx === undefined || takeProfitPx === undefined) {
    logger.error({ coin: signal.coin }, "unreachable: SL/TP missing on a non-skipped trigger");
    return;
  }

  const accounts = await deps.riskGuard.listEligibleAccounts();
  const accountIds = accounts.map((account) => account.tradingAccountId);
  // Two batched queries instead of up to 2N sequential per-account round-trips
  // (code-review, 2026-09-23) — same checks as before, just computed once for every eligible
  // account ahead of the loop rather than re-queried inside it.
  const [accountsWithOpenPosition, todaysLossByAccount] = await Promise.all([
    deps.riskGuard.openPositionsByAccount(accountIds, signal.coin),
    deps.riskGuard.todaysRealizedLossUsdByAccount(accountIds),
  ]);

  for (const account of accounts) {
    try {
      // User-chosen "ignored coins" (risk_limits.ignoredCoins) — filtered HERE, in the per-
      // account fan-out, not earlier: the signal above is account-independent and has already
      // been evaluated and logged to trigger_evaluations (calibration data stays complete),
      // and this only ever stops NEW entries, never touching an already-open position.
      if (account.ignoredCoins.includes(signal.coin)) {
        logger.debug(
          { accountId: account.tradingAccountId, coin: signal.coin },
          "coin ignored by account",
        );
        continue;
      }
      if (accountsWithOpenPosition.has(account.tradingAccountId)) continue;

      const todaysLossUsd = todaysLossByAccount.get(account.tradingAccountId) ?? "0";
      if (new Decimal(todaysLossUsd).gte(account.maxDailyLossUsd)) {
        logger.info(
          { accountId: account.tradingAccountId },
          "daily loss limit reached — skipping account",
        );
        continue;
      }

      const sizeUsd = computePositionSizeUsd({
        baseSizeUsd: account.baseSizeUsd,
        trustMultiplier: trustEval.sizeMultiplier,
        counterFlowMultiplier: counterFlow.sizeMultiplier,
        maxPositionUsd: account.maxPositionUsd,
      });
      if (new Decimal(sizeUsd).lt(MIN_POSITION_SIZE_USD)) continue;

      const result = await deps.executionAdapter.openPosition({
        accountId: String(account.tradingAccountId),
        coin: signal.coin,
        side: signal.side,
        sizeUsd,
        referencePx: entryPx,
        stopLossPx,
        takeProfitPx,
      });

      // onConflictDoNothing against auto_trades_open_account_coin_unique (packages/db,
      // added after code-review 2026-09-23 found a TOCTOU race here: the
      // accountsWithOpenPosition check above and this insert aren't atomic, so two signals on the same coin
      // processed close together could both pass the check). The DB constraint is the real
      // guard; this just lets the loser find out and log instead of silently succeeding
      // twice. A paper-mode "phantom fill" from executionAdapter.openPosition() above with
      // no matching row is harmless (nothing persists, no real funds moved) — Phase B's
      // live adapter must not call openPosition before this insert path is confirmed to
      // hold, since a real order can't be un-placed the same way.
      const [inserted] = await db
        .insert(autoTrades)
        .values({
          tradingAccountId: account.tradingAccountId,
          triggerEvaluationId: evaluation?.id,
          exchange: signal.exchange,
          externalTwapId: signal.externalId,
          triggerWalletAddress: signal.wallet,
          coin: signal.coin,
          side: signal.side,
          sizeUsd,
          trustScoreAtEntry: trustEval.effectiveScore.toString(),
          entryPx: result.entryPx,
          stopLossPx,
          takeProfitPx,
          externalOrderId: result.externalOrderId,
          externalStopLossOrderId: result.stopLossOrderId,
          externalTakeProfitOrderId: result.takeProfitOrderId,
          status: "open",
        })
        .onConflictDoNothing({
          target: [autoTrades.tradingAccountId, autoTrades.coin],
          where: sql`${autoTrades.status} = 'open'`,
        })
        .returning({ id: autoTrades.id });

      if (!inserted) {
        logger.warn(
          { accountId: account.tradingAccountId, coin: signal.coin },
          "lost a concurrent-open race — another signal already opened a position for this account+coin",
        );
        continue;
      }

      logger.info(
        { accountId: account.tradingAccountId, coin: signal.coin, sizeUsd, mode: account.mode },
        "auto-trade opened",
      );
    } catch (err) {
      logger.error(
        { err, accountId: account.tradingAccountId, coin: signal.coin },
        "failed to open auto-trade",
      );
    }
  }
}
