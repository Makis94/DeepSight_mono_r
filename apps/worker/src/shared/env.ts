import "dotenv/config";
import { z } from "zod";

// z.coerce.boolean() uses JS's native Boolean(value) coercion, under which any non-empty
// string is truthy — so a literal `.env` line like `USE_REAL_ARBITRUM=false` coerces to
// `true`, not `false` (discovered when USE_REAL_ARBITRUM=false in apps/worker/.env still
// booted as real/enabled). This treats only the literal strings "true"/"false" as valid,
// throwing loudly on anything else instead of silently misreading it.
const booleanEnvFlag = (defaultValue: boolean) =>
  z
    .enum(["true", "false"])
    .default(defaultValue ? "true" : "false")
    .transform((value) => value === "true");

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export function createWorkerEnv(defaultHeartbeatPort: number) {
  return baseEnvSchema
    .extend({
      HEARTBEAT_PORT: z.coerce.number().int().positive().default(defaultHeartbeatPort),
    })
    .parse(process.env);
}

export type WorkerEnv = ReturnType<typeof createWorkerEnv>;

export function createCoinRegistrySyncEnv(defaultHeartbeatPort: number) {
  return baseEnvSchema
    .extend({
      HEARTBEAT_PORT: z.coerce.number().int().positive().default(defaultHeartbeatPort),
      // Flips coin-registry-sync between the static CMC_TOP_PLACEHOLDER_SYMBOLS list and a
      // real call to CoinMarketCap's listings/latest endpoint — see cmc-client.ts. Defaults
      // to false so the worker runs with no CMC key configured.
      USE_REAL_CMC: booleanEnvFlag(false),
      CMC_API_KEY: z.string().min(1).optional(),
    })
    .parse(process.env);
}

export type CoinRegistrySyncEnv = ReturnType<typeof createCoinRegistrySyncEnv>;

export function createMarketWatcherEnv(defaultHeartbeatPort: number) {
  return baseEnvSchema
    .extend({
      HEARTBEAT_PORT: z.coerce.number().int().positive().default(defaultHeartbeatPort),
      // Floor below which market-watcher doesn't even write a market_trade event — fetch
      // once above this global minimum, filter per-user (users.minTradeAmount) downstream,
      // same pattern as wallet-watcher's per-address threshold and the deposit-monitoring
      // skill's guidance. Set to the lowest of the threshold presets a user can pick in the
      // web UI (see packages/shared TRADE_THRESHOLD_PRESETS) so no preset is starved of
      // events upstream.
      MARKET_TRADE_MIN_NOTIONAL_USD: z.coerce.number().nonnegative().default(10_000),
    })
    .parse(process.env);
}

export type MarketWatcherEnv = ReturnType<typeof createMarketWatcherEnv>;

export function createTwapWatcherEnv(defaultHeartbeatPort: number) {
  return baseEnvSchema
    .extend({
      HEARTBEAT_PORT: z.coerce.number().int().positive().default(defaultHeartbeatPort),
      // Same "off by default, explicit opt-in" shape as USE_REAL_CMC/USE_REAL_ARBITRUM — with
      // this false, twap-watcher runs idle and logs that clearly rather than crashing or
      // silently pretending to work (there's no meaningful mock for "which TWAPs opened").
      USE_REAL_QUICKNODE_TWAP: booleanEnvFlag(false),
      // wss://<endpoint>.quiknode.pro/<token>/hypercore/ws — from the QuickNode dashboard's
      // Hyperliquid Mainnet endpoint, "Hypercore" row, WSS tab. Requires a Build plan or
      // higher (not available on Free trial) — see CLAUDE.md Post-MVP section.
      QUICKNODE_HYPERCORE_WSS_URL: z.string().url().optional(),
      // Global floor below which twap-watcher doesn't even write a market_twap event — same
      // "fetch once above the lowest configured threshold, filter per-user downstream"
      // pattern as MARKET_TRADE_MIN_NOTIONAL_USD/DEPOSIT_MIN_NOTIONAL_USD. Checked against
      // sz × cached mid price at "activated" (nothing has executed yet at that point), and
      // against the real executedNtl at "finished"/"terminated". Kept at or below the lowest
      // preset a user can pick (see packages/shared TWAP_THRESHOLD_PRESETS) so no preset is
      // starved of events upstream.
      TWAP_MIN_NOTIONAL_USD: z.coerce.number().nonnegative().default(100_000),
    })
    .parse(process.env);
}

export type TwapWatcherEnv = ReturnType<typeof createTwapWatcherEnv>;

export function createDepositWatcherEnv(defaultHeartbeatPort: number) {
  return baseEnvSchema
    .extend({
      HEARTBEAT_PORT: z.coerce.number().int().positive().default(defaultHeartbeatPort),
      // Same "off by default, explicit opt-in" shape as USE_REAL_CMC — deposit-watcher can't
      // fall back to a static placeholder the way coin-registry-sync does (there's no
      // meaningful mock for "which deposits happened"), so when both of these are false it
      // runs idle and logs that clearly rather than either crashing or silently pretending
      // to work. Replaces the former USE_REAL_GRAPH/THE_GRAPH_API_KEY (The Graph subgraph
      // this project depended on turned out to be abandoned — 0 signal, no indexer
      // allocations — see deposit-monitoring-architecture skill) with two direct on-chain
      // sources: legacy Bridge2 on Arbitrum, and the now-dominant CCTP-forwarder path on
      // HyperEVM. Either, both, or neither can be enabled independently.
      USE_REAL_ARBITRUM: booleanEnvFlag(false),
      ARBITRUM_RPC_URL: z.string().url().optional(),
      // No key/URL needed — HyperEVM's RPC is Hyperliquid's own public endpoint, hardcoded
      // in hyperevm-cctp-forwarder-deposit-source.ts (MCP-verified).
      USE_REAL_HYPEREVM_CCTP: booleanEnvFlag(false),
      // Global floor below which deposit-watcher doesn't even write a global_deposit event —
      // same "fetch once above the lowest configured threshold, filter per-user downstream"
      // pattern as MARKET_TRADE_MIN_NOTIONAL_USD, kept at or below the lowest preset a user
      // can pick (see packages/shared DEPOSIT_THRESHOLD_PRESETS) so no preset is starved.
      DEPOSIT_MIN_NOTIONAL_USD: z.coerce.number().nonnegative().default(5_000),
    })
    .parse(process.env);
}

export type DepositWatcherEnv = ReturnType<typeof createDepositWatcherEnv>;

export function createSubscriptionWatcherEnv(defaultHeartbeatPort: number) {
  return baseEnvSchema
    .extend({
      HEARTBEAT_PORT: z.coerce.number().int().positive().default(defaultHeartbeatPort),
      NOWPAYMENTS_API_KEY: z.string().min(1),
      NOWPAYMENTS_BASE_URL: z.string().url().default("https://api.nowpayments.io"),
      // Used only to push a "subscription active" DM once a reconciled payment is credited
      // (see notifySubscriptionActive in index.ts) — this worker never otherwise talks to
      // Telegram. Same token apps/bot and apps/api already hold.
      BOT_TOKEN: z.string().min(1),
      // How often to poll NowPayments for stuck payments and sweep expired subscriptions —
      // this is a reconciliation fallback to the apps/api webhook, not the primary path, so
      // minutes-scale is fine.
      SUBSCRIPTION_POLL_INTERVAL_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(5 * 60_000),
    })
    .parse(process.env);
}

export type SubscriptionWatcherEnv = ReturnType<typeof createSubscriptionWatcherEnv>;
