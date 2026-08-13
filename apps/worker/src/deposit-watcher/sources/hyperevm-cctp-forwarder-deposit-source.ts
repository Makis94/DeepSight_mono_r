import type { Logger } from "pino";
import type { DepositEvent, DepositSource } from "./deposit-source.interface.js";
import { decodeAddressFromWord, decodeUintWord, formatTokenAmount } from "./evm-json-rpc.js";
import { EvmLogPoller } from "./evm-log-poller.js";

// Hyperliquid's own HyperEVM JSON-RPC endpoint (chain id 999) — source: hyperliquid-docs MCP
// (for-developers/hyperevm page), verified: 2026-08-10. No third-party RPC provider/API key
// needed for this source, unlike the Arbitrum one.
export const HYPEREVM_RPC_URL = "https://rpc.hyperliquid.xyz/evm";

// Circle's CctpForwarder proxy on HyperEVM — the contract that mints CCTP-bridged USDC
// (from Arbitrum/Base/Ethereum/Polygon/etc.) and auto-forwards it to the recipient's
// HyperCore balance. Verified on hyperevmscan.io: "Exact Match" verified source, deployer
// tagged "Circle: Deployer", 627k+ transactions, most recent labeled "Mint And Forward" —
// checked 2026-08-10. This is now the dominant deposit path per Hyperliquid's own docs (the
// legacy Bridge2/Arbitrum path holds <10% of USDC supply) — see
// arbitrum-bridge2-deposit-source.ts for that other, smaller path.
const CCTP_FORWARDER_CONTRACT_ADDRESS = "0xb21D281DEdb17AE5B501F6AA8256fe38C4e45757";

// HyperEVM's own native USDC contract (Circle-issued) — source: hyperliquid-docs MCP
// (hypercore/usdc page), verified: 2026-08-10. decimals() confirmed via a live eth_call: 6.
// MintAndForward can in principle carry other tokens; filter to this address so a non-USDC
// mint is never misread as a USD amount.
const HYPEREVM_USDC_ADDRESS = "0xb88339cb7199b77e23db6e890353e22632ba630f";
const USDC_DECIMALS = 6;

// event MintAndForward(address indexed forwardRecipient, address indexed forwardingAddress,
//   address indexed token, uint32 destinationId, uint256 amount)
// source: hyperevmscan.io verified source for the CctpForwarder implementation contract,
// checked 2026-08-10 — not a Hyperliquid API endpoint, so the hyperliquid-docs MCP
// verification rule doesn't apply to the contract itself (only to the RPC URL above, which
// is Hyperliquid's own). Topic0 computed and cross-checked locally against the well-known
// ERC20 Transfer topic hash before trusting the keccak256 output.
const MINT_AND_FORWARD_TOPIC0 =
  "0x7c77c294abdf00fb72b21272f440e7f664b15929dfe5e3689c33fb1456be0583";

// hyperliquid-docs MCP (for-developers/hyperevm/json-rpc page, verified: 2026-08-10) states
// "up to 50 blocks in query range" for eth_getLogs, but a live call against
// https://rpc.hyperliquid.xyz/evm on the same date empirically rejected a 999-block range
// with "query exceeds max block range 1000" and accepted exactly 1000 — the live RPC's
// actual behavior contradicts the doc text, so this trusts the live, reproduced response
// over the stale doc claim. Kept slightly under the hard cap as a safety margin.
const MAX_BLOCK_RANGE = 990;
const POLL_INTERVAL_MS = 30_000; // module 1's recommended 30-60s cadence, see CLAUDE.md

export type HyperEvmCctpSource = { useReal: false } | { useReal: true };

export function resolveHyperEvmCctpSource(env: {
  USE_REAL_HYPEREVM_CCTP: boolean;
}): HyperEvmCctpSource {
  return env.USE_REAL_HYPEREVM_CCTP ? { useReal: true } : { useReal: false };
}

export class HyperEvmCctpForwarderDepositSource implements DepositSource {
  readonly name = "hyperevm-cctp-forwarder";

  private readonly poller: EvmLogPoller;

  constructor(logger: Logger) {
    this.poller = new EvmLogPoller({
      rpcUrl: HYPEREVM_RPC_URL,
      contractAddress: CCTP_FORWARDER_CONTRACT_ADDRESS,
      topic0: MINT_AND_FORWARD_TOPIC0,
      maxBlockRange: MAX_BLOCK_RANGE,
      pollIntervalMs: POLL_INTERVAL_MS,
      logger,
    });
  }

  async start(
    fromBlockOrCursor: string | number,
    onDeposit: (event: DepositEvent) => void,
  ): Promise<void> {
    await this.poller.start(Number(fromBlockOrCursor), (logs, blockTimestamps) => {
      for (const log of logs) {
        const forwardRecipientTopic = log.topics[1];
        const tokenTopic = log.topics[3];
        if (!forwardRecipientTopic || !tokenTopic) continue;

        const token = decodeAddressFromWord(tokenTopic).toLowerCase();
        if (token !== HYPEREVM_USDC_ADDRESS) continue; // non-USDC mint, not our concern

        const depositorAddress = decodeAddressFromWord(forwardRecipientTopic).toLowerCase();
        const rawAmount = decodeUintWord(log.data, 1); // word 0 = destinationId, word 1 = amount
        onDeposit({
          txHash: log.transactionHash,
          depositorAddress,
          amountUsdc: formatTokenAmount(rawAmount, USDC_DECIMALS),
          blockTimestamp: blockTimestamps.get(log.blockNumber) ?? Math.floor(Date.now() / 1000),
          sourceChain: "hyperevm",
        });
      }
    });
  }

  stop(): Promise<void> {
    this.poller.stop();
    return Promise.resolve();
  }

  getHealthStatus(): { lastEventAt: number | null; isHealthy: boolean } {
    return this.poller.getHealthStatus();
  }
}
