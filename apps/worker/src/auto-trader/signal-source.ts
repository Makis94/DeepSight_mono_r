import {
  twapSignalStatusSchema,
  type SignalSource,
  type TwapSignal,
  type TwapSignalStatus,
} from "@hypertracker/trading-core";
import type { Logger } from "pino";
import {
  RECOGNIZED_TWAP_STATUSES,
  type QuicknodeTwapEvent,
} from "../twap-watcher/quicknode-schemas.js";
import { QuicknodeTwapSource } from "../twap-watcher/sources/quicknode-twap-source.js";

// Same "B"/"A" convention as every other Hyperliquid fill/state side field this project
// parses (see apps/worker/src/wallet-watcher/classify.ts's fillSide and
// apps/worker/src/twap-watcher/index.ts's own identical helper) — too small a mapping to be
// worth a shared utility, per that existing precedent.
function sideFromHyperliquid(side: string): "buy" | "sell" {
  return side === "B" ? "buy" : "sell";
}

// packages/trading-core's twapSignalStatusSchema deliberately excludes "waitingForTrigger"
// (nothing has started executing yet) — this returns null for that, for an unrecognized
// QuickNode status string outside RECOGNIZED_TWAP_STATUSES, and for the still-open
// "waitingForTrigger" case, so the caller can skip emitting a TwapSignal rather than try to
// construct one that would fail twapSignalSchema's own validation.
function mapStatus(raw: string): TwapSignalStatus | null {
  if (raw === "waitingForTrigger") return null;
  if (!RECOGNIZED_TWAP_STATUSES.has(raw)) return null;
  const parsed = twapSignalStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * trading-core SignalSource implementation for Hyperliquid, backed by QuickNode's HyperCore
 * TWAP dataset. Reuses apps/worker/src/twap-watcher's own QuicknodeTwapSource class
 * unmodified (same reconnect/stall-detection discipline, DS-011/DS-013-fixed) — this is a
 * SEPARATE WS connection from twap-watcher's own (each worker is an independent process per
 * CLAUDE.md), and deliberately does NOT apply twap-watcher's TWAP_MIN_NOTIONAL_USD filter:
 * packages/trading-core's parallel-flow.ts (spec §7) needs every active TWAP, not just the
 * ones large enough to be a trigger candidate on their own.
 */
export class HyperliquidTwapSignalSource implements SignalSource {
  readonly exchange = "hyperliquid";
  private source: QuicknodeTwapSource | null = null;

  constructor(
    private readonly wsUrl: string,
    private readonly logger: Logger,
    private readonly onFrame: () => void,
    private readonly onConnectionChange: (open: boolean) => void,
  ) {}

  start(onSignal: (signal: TwapSignal) => void): void {
    const handleEvent = (event: QuicknodeTwapEvent): void => {
      const rawStatus = typeof event.status === "string" ? event.status : String(event.status);
      const status = mapStatus(rawStatus);
      if (status === null) {
        // "waitingForTrigger" is an expected, silent skip (nothing has executed yet — see
        // mapStatus's doc comment). Anything else outside RECOGNIZED_TWAP_STATUSES is a
        // genuinely unrecognized QuickNode status: code-review (2026-09-23) caught that this
        // used to drop those with zero visibility, unlike twap-watcher/index.ts's identical
        // case, which logs a warning — silently means a wallet's TWAP outcome never gets a
        // trust_score_events row and nothing reveals why, stalling Trust Score for it
        // indefinitely with no signal anything is wrong.
        if (rawStatus !== "waitingForTrigger") {
          this.logger.warn(
            { twapId: event.twap_id, coin: event.state.coin, status: event.status },
            "unrecognized quicknode twap status — not scored, not a trigger candidate",
          );
        }
        return;
      }

      const { state: order, twap_id: twapId } = event;
      const occurredAt = event.time ? new Date(event.time) : new Date();
      const createdAt = order.timestamp !== undefined ? new Date(order.timestamp) : occurredAt;

      const signal: TwapSignal = {
        exchange: this.exchange,
        externalId: String(twapId),
        wallet: order.user.toLowerCase(),
        coin: order.coin,
        side: sideFromHyperliquid(order.side),
        status,
        totalSize: order.sz,
        executedSize: order.executedSz,
        executedNotionalUsd: order.executedNtl,
        durationMinutes: order.minutes,
        reduceOnly: order.reduceOnly,
        createdAt,
        occurredAt,
      };
      onSignal(signal);
    };

    this.source = new QuicknodeTwapSource({
      url: this.wsUrl,
      logger: this.logger,
      onEvent: handleEvent,
      onFrame: this.onFrame,
      onOpen: () => this.onConnectionChange(true),
      onClose: () => this.onConnectionChange(false),
    });
    this.source.connect();
  }

  stop(): void {
    this.source?.close();
    this.source = null;
  }
}
