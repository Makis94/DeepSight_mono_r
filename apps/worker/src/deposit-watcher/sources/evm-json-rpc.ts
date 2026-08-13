// Minimal raw JSON-RPC client — this project has no ethers/viem dependency anywhere, and
// pulling one in for two log-watching sources would be a heavier addition than needed. Same
// "plain fetch, no SDK" style as cmc-client.ts.

export interface EvmLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  // HyperEVM's eth_getLogs includes this directly (verified against a live response,
  // 2026-08-10) — a non-standard extension, not part of base Ethereum JSON-RPC, so callers
  // (e.g. an Arbitrum provider) must not assume it's present and should fall back to
  // eth_getBlockByNumber when it's absent.
  blockTimestamp?: number;
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`${method} request failed: ${response.status} ${response.statusText}`);
  }
  const json = (await response.json()) as { result?: T; error?: { code: number; message: string } };
  if (json.error) {
    throw new Error(`${method} RPC error ${json.error.code}: ${json.error.message}`);
  }
  if (json.result === undefined) {
    throw new Error(`${method} returned no result`);
  }
  return json.result;
}

export async function getBlockNumber(rpcUrl: string): Promise<number> {
  const hex = await rpcCall<string>(rpcUrl, "eth_blockNumber", []);
  return Number.parseInt(hex, 16);
}

export async function getLogs(
  rpcUrl: string,
  params: { address: string; topics: [string]; fromBlock: number; toBlock: number },
): Promise<EvmLog[]> {
  const raw = await rpcCall<
    {
      address: string;
      topics: string[];
      data: string;
      blockNumber: string;
      transactionHash: string;
      blockTimestamp?: string;
    }[]
  >(rpcUrl, "eth_getLogs", [
    {
      address: params.address,
      topics: params.topics,
      fromBlock: `0x${params.fromBlock.toString(16)}`,
      toBlock: `0x${params.toBlock.toString(16)}`,
    },
  ]);
  return raw.map((log) => ({
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: Number.parseInt(log.blockNumber, 16),
    transactionHash: log.transactionHash,
    ...(log.blockTimestamp !== undefined
      ? { blockTimestamp: Number.parseInt(log.blockTimestamp, 16) }
      : {}),
  }));
}

// Log-only responses don't carry a timestamp — callers batch-fetch it once per unique block.
export async function getBlockTimestamp(rpcUrl: string, blockNumber: number): Promise<number> {
  const block = await rpcCall<{ timestamp: string }>(rpcUrl, "eth_getBlockByNumber", [
    `0x${blockNumber.toString(16)}`,
    false,
  ]);
  return Number.parseInt(block.timestamp, 16);
}

// A topic/data word is a 32-byte (64 hex char) slot. An indexed `address` param is
// left-zero-padded to 32 bytes in `topics`; this strips the padding back to a 20-byte address.
export function decodeAddressFromWord(word: string): string {
  const hex = word.startsWith("0x") ? word.slice(2) : word;
  return `0x${hex.slice(-40)}`;
}

// Reads a uint from a specific 32-byte word inside a log's `data` field (wordIndex 0 = the
// first word after 0x). Values here (uint32 destinationId, uint64 usd, uint256 amount) all
// fit safely in BigInt — never coerced to `number`, per CLAUDE.md's monetary-amounts rule.
export function decodeUintWord(data: string, wordIndex: number): bigint {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const word = hex.slice(wordIndex * 64, wordIndex * 64 + 64);
  return BigInt(`0x${word}`);
}

// Raw token integer -> decimal string, no float at any point — see CLAUDE.md's
// monetary-amounts rule. `decimals` is the ERC20 token's own `decimals()` value (confirmed
// via a live eth_call against both USDC contracts this project watches: 6 on Arbitrum's
// USDC and 6 on HyperEVM's native USDC, verified 2026-08-10 — not assumed from convention).
export function formatTokenAmount(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = (raw % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}
