import type { Logger } from "pino";
import { getBlockNumber, getBlockTimestamp, getLogs, type EvmLog } from "./evm-json-rpc.js";

export interface EvmLogPollerOptions {
  rpcUrl: string;
  contractAddress: string;
  topic0: string;
  // Server-side max block span per eth_getLogs call — e.g. HyperEVM's actual (live-tested)
  // 1000-block cap, see hyperevm-cctp-forwarder-deposit-source.ts. Callers pass their own
  // provider's limit; this poller doesn't assume one value fits every chain.
  maxBlockRange: number;
  pollIntervalMs: number;
  logger: Logger;
}

// Shared by both deposit sources (Arbitrum Bridge2, HyperEVM CCTP forwarder) — both need the
// same "poll eth_getLogs in provider-limited block-range chunks, track a block-number
// cursor, resolve timestamps per unique block" loop, so it lives here once instead of being
// duplicated across two near-identical DepositSource implementations.
export class EvmLogPoller {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastEventAt: number | null = null;
  private isHealthy = false;

  constructor(private readonly opts: EvmLogPollerOptions) {}

  async start(
    fromBlock: number,
    onLogs: (logs: EvmLog[], blockTimestamps: Map<number, number>) => Promise<void> | void,
  ): Promise<void> {
    this.running = true;
    let cursor = fromBlock;

    const poll = async (): Promise<void> => {
      if (!this.running) return;
      try {
        const latest = await getBlockNumber(this.opts.rpcUrl);
        if (latest >= cursor) {
          const toBlock = Math.min(latest, cursor + this.opts.maxBlockRange - 1);
          const logs = await getLogs(this.opts.rpcUrl, {
            address: this.opts.contractAddress,
            topics: [this.opts.topic0],
            fromBlock: cursor,
            toBlock,
          });
          if (logs.length > 0) {
            const blockTimestamps = await this.resolveBlockTimestamps(logs);
            await onLogs(logs, blockTimestamps);
          }
          cursor = toBlock + 1;
        }
        this.isHealthy = true;
        this.lastEventAt = Date.now();
      } catch (err) {
        this.isHealthy = false;
        this.opts.logger.error({ err }, "evm log poll failed");
      }
      if (this.running) {
        this.timer = setTimeout(() => void poll(), this.opts.pollIntervalMs);
      }
    };

    await poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  getHealthStatus(): { lastEventAt: number | null; isHealthy: boolean } {
    return { lastEventAt: this.lastEventAt, isHealthy: this.isHealthy };
  }

  private async resolveBlockTimestamps(logs: EvmLog[]): Promise<Map<number, number>> {
    const timestamps = new Map<number, number>();
    const blocksNeedingLookup = new Set<number>();
    for (const log of logs) {
      if (log.blockTimestamp !== undefined) {
        timestamps.set(log.blockNumber, log.blockTimestamp);
      } else {
        blocksNeedingLookup.add(log.blockNumber);
      }
    }
    for (const blockNumber of blocksNeedingLookup) {
      timestamps.set(blockNumber, await getBlockTimestamp(this.opts.rpcUrl, blockNumber));
    }
    return timestamps;
  }
}
