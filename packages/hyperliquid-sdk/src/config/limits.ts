// source: hyperliquid-docs MCP (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits), verified: 2026-07-27
// All limits below apply per IP address.
export const HYPERLIQUID_WS_LIMITS = {
  /** Max simultaneous WebSocket connections per IP. */
  maxConnectionsPerIp: 10,
  /** Max new WebSocket connections opened per IP per minute. */
  maxNewConnectionsPerMinute: 30,
  /** Max total active subscriptions (across all connections) per IP. */
  maxSubscriptionsPerIp: 1000,
  /**
   * Max unique addresses across USER-SPECIFIC subscriptions per IP — e.g. userEvents,
   * userFills, userFundings, userNonFundingLedgerUpdates, orderUpdates, notification,
   * webData3, clearinghouseState, openOrders, twapStates, activeAssetData,
   * userTwapSliceFills, userTwapHistory, spotState, allDexsClearinghouseState.
   * This is the binding constraint for wallet-watcher, not connection or subscription count:
   * tracking more than 10 wallets from a single IP is not possible regardless of how
   * subscriptions are distributed across connections — it requires additional egress IPs.
   */
  maxUniqueUsersForUserSubscriptions: 10,
  /** Max messages sent TO Hyperliquid per minute across all connections on the IP (subscribe/unsubscribe/ping/post — not inbound data volume). */
  maxMessagesSentPerMinute: 2000,
  /** Max simultaneous inflight "post" (request/response) messages across all connections on the IP. */
  maxInflightPostMessages: 100,
} as const;

// source: hyperliquid-docs MCP (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats), verified: 2026-07-27
export const HYPERLIQUID_WS_HEARTBEAT = {
  /** Server closes the connection if it hasn't received a message from us in this window. */
  serverIdleTimeoutMs: 60_000,
  /** Recommended interval to send { method: "ping" } to keep an idle subscription alive. */
  recommendedPingIntervalMs: 30_000,
} as const;

export const HYPERLIQUID_WS_URLS = {
  mainnet: "wss://api.hyperliquid.xyz/ws",
  testnet: "wss://api.hyperliquid-testnet.xyz/ws",
} as const;

// source: hyperliquid-docs MCP (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint), verified: 2026-07-27
export const HYPERLIQUID_REST_URLS = {
  mainnet: "https://api.hyperliquid.xyz",
  testnet: "https://api.hyperliquid-testnet.xyz",
} as const;
