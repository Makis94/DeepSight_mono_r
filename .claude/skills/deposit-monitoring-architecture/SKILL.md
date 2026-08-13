---
name: deposit-monitoring-architecture
description: Use this skill whenever writing, reviewing, or modifying code related to global deposit monitoring on Hyperliquid — this includes any file implementing DepositSource, deposit-watcher, Bridge2 contract event handling, The Graph subgraph queries for Hyperliquid, or Arbitrum RPC integration for detecting deposits. Also trigger when the user asks "why isn't this deposit through Hyperliquid's own API", "how do we detect all deposits", or discusses adding a new deposit data source. Do NOT trigger for per-wallet deposit/withdrawal tracking of an already-watched address (that goes through userNonFundingLedgerUpdates via Hyperliquid WebSocket — see hyperliquid-ws-patterns skill instead). This skill is specifically about GLOBAL, all-users deposit detection, which Hyperliquid's own API does not provide.
---

# Global Deposit Monitoring: Architecture Decision Record

## Why this skill exists

Hyperliquid's own REST/WebSocket API has no endpoint or subscription for "all deposits from all users." Deposits are an on-chain event on the Arbitrum bridge contract (Bridge2), not something HyperCore itself exposes globally. This is a load-bearing architectural fact, not an implementation detail — do not attempt to "find" a Hyperliquid-native global deposit feed; it does not exist. If asked to implement this feature, always route through the `DepositSource` abstraction described below, never by hardcoding a call to Hyperliquid's API expecting a global feed.

Per-wallet deposits/withdrawals for an already-watched address ARE available via Hyperliquid's own `userNonFundingLedgerUpdates` WebSocket subscription — that is a separate, already-solved problem (see `hyperliquid-ws-patterns` skill). This skill is only about detecting deposits from addresses NOT yet on the watch list, i.e. the "$500k+ deposit from anyone" requirement.

## Current implementation: The Graph subgraph

The chosen approach queries a public Hyperliquid Bridge2 subgraph on Arbitrum One via GraphQL over HTTP. This indexes Deposit/Withdrawal events on the bridge contract, bridge TVL, and per-account totals — no need to run a dedicated Arbitrum RPC node or write custom log-decoding logic for the first version.

Implementation requirements:

- Poll or subscribe (if the subgraph supports subscriptions) for new Deposit entities above the configurable threshold (`min_deposit_amount` from the `users`/settings table — note this is a per-user threshold, so the source should surface ALL deposits above the LOWEST configured threshold across users, then filter per-user downstream, not query per-user).
- Deduplicate by the deposit's on-chain transaction hash — this is the natural idempotency key, do not rely on auto-increment IDs or timestamps alone.
- Handle subgraph indexing lag explicitly: a subgraph is not real-time-instant, there can be a delay of seconds to low minutes after the actual Arbitrum block. Log this lag if measurable, and do not assume sub-second latency in any user-facing copy ("depósito detectado" wording should not imply instant detection if it isn't).
- Treat the subgraph endpoint URL and query schema as configuration, not hardcoded strings scattered through the codebase — one client module, not inline fetches.

## The `DepositSource` interface — mandatory extension point

Do not implement deposit detection as a direct, one-off integration with The Graph. Define an interface so a future direct-RPC implementation (or a different indexer, if the subgraph becomes unreliable or rate-limited) can be swapped in without touching `deposit-watcher`'s consumer logic:

```typescript
interface DepositEvent {
  txHash: string;
  depositorAddress: string;
  amountUsdc: string; // decimal string, never float — see note below
  blockTimestamp: number;
  sourceChain: "arbitrum";
}

interface DepositSource {
  // Called on worker startup and after reconnects/errors to resume from last known point
  start(
    fromBlockOrCursor: string | number,
    onDeposit: (event: DepositEvent) => void,
  ): Promise<void>;
  stop(): Promise<void>;
  // Should expose enough info to detect indexing lag / staleness
  getHealthStatus(): { lastEventAt: number | null; isHealthy: boolean };
}
```

Current implementation: `TheGraphDepositSource implements DepositSource`.
Deferred, not yet built: `ArbitrumRpcDepositSource implements DepositSource` — a placeholder for direct log subscription to the Bridge2 contract if/when subgraph reliability or latency becomes a problem. Do not build this speculatively before it's needed — the interface is the point of the abstraction, not a premature second implementation.

## Amount handling — critical for financial correctness

USDC amounts must be handled as decimal strings or a fixed-point/BigInt-based type end to end — from the subgraph response, through the `events` table, to the Telegram notification text. Never cast to native JS `number`/float at any point in this pipeline; for deposits in the $100k–$500k+ range that this project targets, float rounding errors are not cosmetic, they change what crosses the user's configured threshold.

## Anti-patterns — do not do these

- ❌ Trying to find a Hyperliquid-native "all deposits" WebSocket subscription — it does not exist, stop looking and use this architecture instead.
- ❌ Querying the subgraph once per user per their individual threshold — fetch once above the global minimum threshold, filter per-user in application code.
- ❌ Hardcoding the subgraph GraphQL endpoint/query inline in multiple files instead of one client module behind `DepositSource`.
- ❌ Using `number`/float for `amountUsdc` anywhere in the pipeline.
- ❌ Building `ArbitrumRpcDepositSource` before there is an actual reason (rate limits, subgraph downtime) to need it.
