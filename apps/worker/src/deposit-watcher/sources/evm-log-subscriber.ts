import type { Logger } from "pino";
import { getBlockNumber, getBlockTimestamp, getLogs, type EvmLog } from "./evm-json-rpc.js";

export interface EvmLogSubscriberOptions {
  // wsUrl for the live eth_subscribe feed, httpUrl for the one-time historical catch-up
  // (eth_getLogs) and per-log block-timestamp lookups (eth_getBlockByNumber) — WS
  // subscriptions only push logs from subscribe-time onward, they don't backfill.
  wsUrl: string;
  httpUrl: string;
  contractAddress: string;
  topic0: string;
  // Some free-tier RPC providers cap eth_getLogs to a tiny block range (Alchemy's free tier:
  // 10 blocks — discovered live, 2026-08-10, via the provider's own error message; nowhere
  // documented up front). Only used for the bounded historical catch-up, not the live feed.
  catchUpMaxBlockRange: number;
  logger: Logger;
}

const MIN_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

// Real-time counterpart to EvmLogPoller — used where a provider's eth_getLogs block-range
// cap is too small for continuous polling to keep up with a fast chain (Arbitrum produces a
// block roughly every ~0.25s; a 10-block cap would fall permanently behind at any reasonable
// poll interval). Subscribes once via eth_subscribe and receives pushed logs instead.
export class EvmLogSubscriber {
  private ws: WebSocket | null = null;
  private running = false;
  private closedByUs = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private lastEventAt: number | null = null;
  private isHealthy = false;
  private subscriptionId: string | null = null;

  constructor(private readonly opts: EvmLogSubscriberOptions) {}

  async start(
    fromBlock: number,
    onLog: (log: EvmLog, blockTimestamp: number) => void,
  ): Promise<void> {
    this.running = true;
    await this.catchUp(fromBlock, onLog);
    this.openSocket(onLog);
  }

  stop(): void {
    this.running = false;
    this.closedByUs = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  getHealthStatus(): { lastEventAt: number | null; isHealthy: boolean } {
    return { lastEventAt: this.lastEventAt, isHealthy: this.isHealthy };
  }

  // One-time bounded backfill from the resume cursor up to "now" — RESTART_SAFETY_BLOCKS
  // (see deposit-watcher/index.ts) keeps this small (tens of blocks), so a handful of
  // small-range calls is fine even under a tight free-tier cap; this is not the continuous
  // polling loop that cap makes impractical.
  private async catchUp(
    fromBlock: number,
    onLog: (log: EvmLog, blockTimestamp: number) => void,
  ): Promise<void> {
    try {
      const latest = await getBlockNumber(this.opts.httpUrl);
      let cursor = fromBlock;
      while (cursor <= latest) {
        const toBlock = Math.min(latest, cursor + this.opts.catchUpMaxBlockRange - 1);
        const logs = await getLogs(this.opts.httpUrl, {
          address: this.opts.contractAddress,
          topics: [this.opts.topic0],
          fromBlock: cursor,
          toBlock,
        });
        for (const log of logs) {
          const blockTimestamp =
            log.blockTimestamp ?? (await getBlockTimestamp(this.opts.httpUrl, log.blockNumber));
          onLog(log, blockTimestamp);
        }
        cursor = toBlock + 1;
      }
    } catch (err) {
      this.opts.logger.error({ err }, "evm log subscriber catch-up failed");
    }
  }

  private openSocket(onLog: (log: EvmLog, blockTimestamp: number) => void): void {
    if (!this.running) return;
    const ws = new WebSocket(this.opts.wsUrl);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.isHealthy = true;
      this.lastEventAt = Date.now();
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_subscribe",
          params: ["logs", { address: this.opts.contractAddress, topics: [this.opts.topic0] }],
        }),
      );
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      void this.handleMessage(String(event.data), onLog);
    });

    ws.addEventListener("close", () => {
      this.isHealthy = false;
      if (!this.closedByUs) this.scheduleReconnect(onLog);
    });

    ws.addEventListener("error", (event) => {
      this.opts.logger.error({ err: event }, "evm log subscriber ws error");
    });
  }

  private async handleMessage(
    raw: string,
    onLog: (log: EvmLog, blockTimestamp: number) => void,
  ): Promise<void> {
    const parsed = JSON.parse(raw) as {
      id?: number;
      result?: string;
      params?: { subscription: string; result: EvmLog & { blockTimestamp?: string } };
    };

    if (parsed.id === 1 && typeof parsed.result === "string") {
      this.subscriptionId = parsed.result;
      return;
    }

    if (!parsed.params || parsed.params.subscription !== this.subscriptionId) return;

    const rawLog = parsed.params.result;
    const log: EvmLog = {
      address: rawLog.address,
      topics: rawLog.topics,
      data: rawLog.data,
      blockNumber: Number(rawLog.blockNumber),
      transactionHash: rawLog.transactionHash,
    };

    this.lastEventAt = Date.now();
    const blockTimestamp =
      rawLog.blockTimestamp !== undefined
        ? Number.parseInt(rawLog.blockTimestamp, 16)
        : await getBlockTimestamp(this.opts.httpUrl, log.blockNumber);
    onLog(log, blockTimestamp);
  }

  private scheduleReconnect(onLog: (log: EvmLog, blockTimestamp: number) => void): void {
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      MIN_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt += 1;
    this.opts.logger.warn({ delayMs: delay }, "evm log subscriber ws disconnected, reconnecting");
    this.reconnectTimer = setTimeout(() => this.openSocket(onLog), delay);
  }
}
