/**
 * PLACEHOLDER for the CoinMarketCap top-250 list. There is no CoinMarketCap API key
 * configured yet, so this is a hand-picked stand-in of well-known large-cap symbols —
 * NOT an actual top-250-by-market-cap snapshot, and NOT kept in sync with anything.
 *
 * Replace with a real fetch against CoinMarketCap's
 * `/v1/cryptocurrency/listings/latest` (rank <= 250, requires `CMC_API_KEY`) once a key
 * is available. `syncCoinRegistry` in ./sync.ts already does the Hyperliquid-side half
 * of the intersection for real (via `getMeta`) — only this list is fake.
 */
export const CMC_TOP_PLACEHOLDER_SYMBOLS = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "BNB",
  "DOGE",
  "ADA",
  "TRX",
  "AVAX",
  "LINK",
  "TON",
  "DOT",
  "MATIC",
  "LTC",
  "BCH",
  "NEAR",
  "UNI",
  "APT",
  "ATOM",
  "SUI",
  "ARB",
  "OP",
  "INJ",
  "TIA",
  "SEI",
  "FTM",
  "AAVE",
  "MKR",
  "LDO",
  "CRV",
] as const;
