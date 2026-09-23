import { trustScoreEvents, trustScores, type Database } from "@hypertracker/db";
import type { TrustScoreEventType } from "@hypertracker/shared";
import {
  evaluateWalletTrust,
  type TrustScoreEvent,
  type WalletTrustEvaluation,
} from "@hypertracker/trading-core";
import { and, eq, gte } from "drizzle-orm";
import type { Logger } from "pino";

const EXCHANGE = "hyperliquid";

// Same query-builder surface as Database (select/insert/...), but bound to one transaction —
// lets loadEvents/recompute run against either a plain Database or an in-flight tx.
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

// packages/trading-core's DEFAULT_TRUST_SCORE_CONFIG.decayHalfLifeDays=30 and
// DEFAULT_CONFIDENCE_CONFIG.maturityDays=45 mean an event this old contributes a negligible,
// bounded amount to either score or confidence (2^-(180/30) ≈ 1.6% of its original decay
// weight, and tenure confidence already saturates at 45 days) — safe to drop from the query
// entirely rather than pay for an ever-growing per-wallet SELECT (code-review, 2026-09-23:
// loadEvents() was unbounded, called on every recordEvent AND every getTrustEvaluation).
const EVENT_HISTORY_WINDOW_DAYS = 180;

/**
 * DB-backed wrapper around packages/trading-core's pure evaluateWalletTrust() (raw score +
 * confidence-based manipulation defense — see that function's doc comment, added
 * 2026-09-22). Owns the two tables spec §3 needs: trust_score_events (insert-only source of
 * truth — never UPDATE/DELETE, same durability rationale as subscriptions.trialClaims) and
 * trust_scores (a cached projection recomputed on every new event, plus the denormalized
 * counters apps/web's leaderboard reads).
 */
export class TrustScoreStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Records one scoring-relevant TWAP outcome and recomputes+persists the wallet's cached
   * evaluation. Idempotent per (exchange, externalTwapId, eventType) — trust_score_events'
   * own unique constraint absorbs a duplicate/replayed stream message via
   * onConflictDoNothing, so this is safe to call more than once for the same transition.
   *
   * Insert + recompute run inside one transaction (code-review, 2026-09-23) — without it, two
   * concurrent calls for the same wallet (e.g. two TWAP status transitions landing close
   * together) could each read the event list before the other's insert commits, then both
   * write a trust_scores row computed from a stale/partial event set, silently corrupting the
   * cached score/confidence/blocked values that gate real position sizing.
   */
  async recordEvent(input: {
    walletAddress: string;
    externalTwapId: string;
    eventType: TrustScoreEventType;
    coin: string;
    // Decimal string — money (CLAUDE.md). Record-keeping only: computeTrustScore never reads
    // this field, only event type + occurredAt.
    notionalUsd: string;
    occurredAt: Date;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(trustScoreEvents)
        .values({
          exchange: EXCHANGE,
          walletAddress: input.walletAddress,
          externalTwapId: input.externalTwapId,
          eventType: input.eventType,
          coin: input.coin,
          notionalUsd: input.notionalUsd,
          occurredAt: input.occurredAt,
        })
        .onConflictDoNothing({
          target: [
            trustScoreEvents.exchange,
            trustScoreEvents.externalTwapId,
            trustScoreEvents.eventType,
          ],
        })
        .returning({ id: trustScoreEvents.id });

      if (!inserted) {
        this.logger.debug(
          { wallet: input.walletAddress, twapId: input.externalTwapId, eventType: input.eventType },
          "trust score event already recorded — skipping duplicate",
        );
        return;
      }

      await this.recompute(tx, input.walletAddress, input.occurredAt);
    });
  }

  /**
   * `now` anchors both the history-window cutoff and (via recompute/getTrustEvaluation)
   * decay/confidence math to the SAME reference point — code-review (2026-09-23) caught that
   * the cutoff was previously anchored to wall-clock Date.now() while decay/confidence used the
   * caller's own `now` (the triggering signal's occurredAt), so a worker restart catching up on
   * a backlog, or any delayed processing, could window events inconsistently with the
   * evaluation's own stated "now."
   */
  private async loadEvents(
    executor: Executor,
    walletAddress: string,
    now: Date,
  ): Promise<{ events: TrustScoreEvent[]; lastEventAt: Date | undefined }> {
    const cutoff = new Date(now.getTime() - EVENT_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await executor
      .select({ eventType: trustScoreEvents.eventType, occurredAt: trustScoreEvents.occurredAt })
      .from(trustScoreEvents)
      .where(
        and(
          eq(trustScoreEvents.exchange, EXCHANGE),
          eq(trustScoreEvents.walletAddress, walletAddress),
          gte(trustScoreEvents.occurredAt, cutoff),
        ),
      );

    const events: TrustScoreEvent[] = rows.map((row) => ({
      type: row.eventType,
      occurredAt: row.occurredAt,
    }));
    const lastEventAt = rows.reduce<Date | undefined>(
      (latest, row) => (!latest || row.occurredAt > latest ? row.occurredAt : latest),
      undefined,
    );
    return { events, lastEventAt };
  }

  /** Recomputes and upserts the cached trust_scores row for a wallet from its full event history. */
  private async recompute(executor: Executor, walletAddress: string, now: Date): Promise<void> {
    const { events, lastEventAt } = await this.loadEvents(executor, walletAddress, now);
    const evaluation = evaluateWalletTrust(events, now);

    const totalSignals = events.length;
    const fullyExecutedCount = events.filter((event) => event.type === "fully_executed").length;
    const cancelledCount = events.filter(
      (event) =>
        event.type === "cancelled_before_execution" || event.type === "cancelled_mid_execution",
    ).length;

    await executor
      .insert(trustScores)
      .values({
        exchange: EXCHANGE,
        walletAddress,
        score: evaluation.rawScore.toString(),
        confidence: evaluation.confidence.toString(),
        effectiveScore: evaluation.effectiveScore.toString(),
        blocked: evaluation.blocked,
        totalSignals,
        fullyExecutedCount,
        cancelledCount,
        ...(lastEventAt !== undefined && { lastEventAt }),
      })
      .onConflictDoUpdate({
        target: [trustScores.exchange, trustScores.walletAddress],
        set: {
          score: evaluation.rawScore.toString(),
          confidence: evaluation.confidence.toString(),
          effectiveScore: evaluation.effectiveScore.toString(),
          blocked: evaluation.blocked,
          totalSignals,
          fullyExecutedCount,
          cancelledCount,
          ...(lastEventAt !== undefined && { lastEventAt }),
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Full trust evaluation for a wallet AT THE GIVEN EVALUATION TIME — recomputed fresh from
   * trust_score_events rather than read from the trust_scores cache, since `now` (the
   * triggering signal's own occurredAt, not wall-clock "this instant") affects both decay
   * and confidence's tenure component. A wallet with no history yet gets the same
   * neutral/unblocked result evaluateWalletTrust([], now) would: score 0, multiplier 1.0.
   */
  async getTrustEvaluation(walletAddress: string, now: Date): Promise<WalletTrustEvaluation> {
    const { events } = await this.loadEvents(this.db, walletAddress, now);
    return evaluateWalletTrust(events, now);
  }
}
