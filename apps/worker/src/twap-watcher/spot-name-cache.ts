import { getSpotMeta, HYPERLIQUID_REST_URLS } from "@hypertracker/hyperliquid-sdk";
import type { Logger } from "pino";

type Network = "mainnet" | "testnet";

export interface ResolvedCoin {
  market: "perp" | "spot";
  /** Human-readable name: "BTC", "xyz:NVDA", "HYPE/USDC". */
  displayCoin: string;
}

const REFRESH_INTERVAL_MS = 10 * 60_000;

/**
 * Classifies a QuickNode TWAP `state.coin` as perp or spot and gives it a readable name.
 * There is no market-type field in the feed — the coin string format is the only signal:
 *
 *   "BTC" / "HYPE"   -> perp, as-is
 *   "xyz:NVDA"       -> perp (HIP-3 builder dex), as-is
 *   "@107"           -> spot, "HYPE/USDC" (base/quote token names from spotMeta)
 *   "PURR/USDC"      -> spot, as-is (canonical pair, already readable)
 *   "#0"             -> null (outcome / prediction-market asset — not handled)
 *
 * Spot names come from Hyperliquid's `spotMeta` (info weight 20), refreshed every
 * REFRESH_INTERVAL_MS into memory — never looked up per event.
 *
 * Names are the L1 token names, so a UI-remapped pair renders in its HyperCore form
 * ("UBTC/USDC", not app.hyperliquid.xyz's "BTC/USDC"). Left as-is deliberately: that's the
 * canonical on-chain name, and a wrong remap would be worse than an unfamiliar-but-correct
 * one. (Info-endpoint docs note this remapping.)
 */
export class SpotNameCache {
  private readonly baseUrl: string;
  private byPairIndex = new Map<number, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    network: Network,
    private readonly logger: Logger,
  ) {
    this.baseUrl = HYPERLIQUID_REST_URLS[network];
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, REFRESH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  resolve(coin: string): ResolvedCoin | null {
    if (coin.startsWith("#")) return null;
    if (coin.startsWith("@")) {
      const idx = Number(coin.slice(1));
      const name = Number.isFinite(idx) ? this.byPairIndex.get(idx) : undefined;
      // Unknown index (spotMeta not loaded yet, or a pair added since the last refresh) —
      // still publish it as spot, just with the raw id as the name until the next refresh.
      return { market: "spot", displayCoin: name ?? coin };
    }
    if (coin.includes("/")) return { market: "spot", displayCoin: coin };
    return { market: "perp", displayCoin: coin };
  }

  private async refresh(): Promise<void> {
    try {
      const meta = await getSpotMeta(this.baseUrl);
      const tokenName = new Map(meta.tokens.map((token) => [token.index, token.name]));
      const next = new Map<number, string>();
      for (const pair of meta.universe) {
        const [baseIdx, quoteIdx] = pair.tokens;
        const base = tokenName.get(baseIdx);
        const quote = tokenName.get(quoteIdx);
        if (base !== undefined && quote !== undefined) {
          next.set(pair.index, `${base}/${quote}`);
        } else if (!pair.name.startsWith("@")) {
          next.set(pair.index, pair.name);
        }
      }
      this.byPairIndex = next;
      this.logger.debug({ pairs: next.size }, "spot name cache refreshed");
    } catch (err) {
      this.logger.warn({ err }, "spotMeta refresh failed — keeping last spot-name snapshot");
    }
  }
}
