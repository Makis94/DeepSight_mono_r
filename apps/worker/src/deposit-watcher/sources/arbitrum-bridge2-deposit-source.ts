import type { Logger } from "pino";
import type { DepositEvent, DepositSource } from "./deposit-source.interface.js";
import { decodeAddressFromWord, decodeUintWord, formatTokenAmount } from "./evm-json-rpc.js";
import { EvmLogSubscriber } from "./evm-log-subscriber.js";

// Hyperliquid's legacy Bridge2 contract on Arbitrum One — address confirmed via the
// hyperliquid-docs MCP (for-developers/api/usdc page), verified: 2026-08-10. Docs call this
// path "deprecated" and note it now holds <10% of USDC supply on HyperCore — see
// hyperevm-cctp-forwarder-deposit-source.ts for the dominant path. Both sources are needed
// for reasonable coverage; neither alone is complete (deposit-monitoring-architecture skill).
const BRIDGE2_CONTRACT_ADDRESS = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";

// event Deposit(address indexed user, uint64 usd) — source: Bridge2.sol
// (github.com/hyperliquid-dex/contracts), not a Hyperliquid API endpoint so the
// hyperliquid-docs MCP verification rule doesn't apply to the contract itself (same carve-out
// as the removed the-graph-deposit-source.ts). Topic0 computed and cross-checked locally
// against the well-known ERC20 Transfer topic hash before trusting the keccak256 output.
const DEPOSIT_TOPIC0 = "0x0ee94a97c7c69ce2eb8cfb09bacc78d63a73b5e0fbed0d13a079190ff876ae3a";

// USDC on Arbitrum (0xaf88d065e77c8cC2239327C5EDb3A432268e5831) — decimals() confirmed via a
// live eth_call, not assumed: 6. Bridge2's `usd` field is denominated in this same raw unit.
const USDC_DECIMALS = 6;

// Arbitrum produces a block roughly every ~0.25s, and a free-tier eth_getLogs cap as low as
// 10 blocks/call (Alchemy — confirmed live, 2026-08-10, via the provider's own error
// response, not documented anywhere up front) means continuous HTTP polling can never catch
// up. This source subscribes over WebSocket (eth_subscribe) for live logs instead, and only
// uses bounded eth_getLogs polling for the one-time startup catch-up — see
// evm-log-subscriber.ts. 10 is deliberately conservative so the catch-up itself doesn't hit
// the same cap; it's not assumed to be every provider's exact limit.
const CATCH_UP_MAX_BLOCK_RANGE = 10;

export type ArbitrumSource = { useReal: false } | { useReal: true; rpcUrl: string };

export function resolveArbitrumSource(env: {
  USE_REAL_ARBITRUM: boolean;
  ARBITRUM_RPC_URL?: string | undefined;
}): ArbitrumSource {
  if (!env.USE_REAL_ARBITRUM) return { useReal: false };
  if (!env.ARBITRUM_RPC_URL) {
    throw new Error("ARBITRUM_RPC_URL is required when USE_REAL_ARBITRUM=true");
  }
  return { useReal: true, rpcUrl: env.ARBITRUM_RPC_URL };
}

// ARBITRUM_RPC_URL is configured as the https:// endpoint (also used for the catch-up
// eth_getLogs/eth_getBlockByNumber calls); the live eth_subscribe feed needs the wss://
// counterpart at the identical host+path, which Alchemy (and most providers following the
// same convention) expose as a straight scheme swap.
function deriveWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) return `wss://${httpUrl.slice("https://".length)}`;
  if (httpUrl.startsWith("http://")) return `ws://${httpUrl.slice("http://".length)}`;
  throw new Error(`ARBITRUM_RPC_URL must start with http:// or https://, got: ${httpUrl}`);
}

export class ArbitrumBridge2DepositSource implements DepositSource {
  readonly name = "arbitrum-bridge2";

  private readonly subscriber: EvmLogSubscriber;

  constructor(rpcUrl: string, logger: Logger) {
    this.subscriber = new EvmLogSubscriber({
      wsUrl: deriveWsUrl(rpcUrl),
      httpUrl: rpcUrl,
      contractAddress: BRIDGE2_CONTRACT_ADDRESS,
      topic0: DEPOSIT_TOPIC0,
      catchUpMaxBlockRange: CATCH_UP_MAX_BLOCK_RANGE,
      logger,
    });
  }

  async start(
    fromBlockOrCursor: string | number,
    onDeposit: (event: DepositEvent) => void,
  ): Promise<void> {
    await this.subscriber.start(Number(fromBlockOrCursor), (log, blockTimestamp) => {
      const topic1 = log.topics[1];
      if (!topic1) return;
      const depositorAddress = decodeAddressFromWord(topic1).toLowerCase();
      const rawUsd = decodeUintWord(log.data, 0);
      onDeposit({
        txHash: log.transactionHash,
        depositorAddress,
        amountUsdc: formatTokenAmount(rawUsd, USDC_DECIMALS),
        blockTimestamp,
        sourceChain: "arbitrum",
      });
    });
  }

  stop(): Promise<void> {
    this.subscriber.stop();
    return Promise.resolve();
  }

  getHealthStatus(): { lastEventAt: number | null; isHealthy: boolean } {
    return this.subscriber.getHealthStatus();
  }
}
