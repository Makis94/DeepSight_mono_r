// See the deposit-monitoring-architecture skill — this is the mandatory extension point for
// global deposit detection. Never call a specific indexer's client directly from index.ts;
// go through this interface so TheGraphDepositSource can be swapped for a direct-RPC
// implementation later without touching the consumer.
export interface DepositEvent {
  txHash: string;
  depositorAddress: string;
  // Decimal string, never a float — see CLAUDE.md's monetary-amounts rule.
  amountUsdc: string;
  blockTimestamp: number;
  // "arbitrum": legacy Bridge2 contract. "hyperevm": Circle CCTP's mint-and-forward path,
  // which now carries the majority of deposit volume — see deposit-monitoring-architecture
  // skill for why both sources are needed (Hyperliquid's own docs: the legacy bridge holds
  // <10% of USDC supply on HyperCore).
  sourceChain: "arbitrum" | "hyperevm";
}

export interface DepositSource {
  readonly name: string;
  // Called on worker startup and after reconnects/errors to resume from last known point
  // (a durable cursor — see event_cursors — not an in-memory-only position).
  start(
    fromBlockOrCursor: string | number,
    onDeposit: (event: DepositEvent) => void,
  ): Promise<void>;
  stop(): Promise<void>;
  getHealthStatus(): { lastEventAt: number | null; isHealthy: boolean };
}
