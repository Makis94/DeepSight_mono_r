import { useEffect, useRef, useState } from "react";
import { listCoinPrices } from "../lib/api.js";
import { formatPrice } from "../lib/format.js";
import type { CoinPrice } from "@hypertracker/shared/schemas/coins";

interface PriceTickerProps {
  token: string;
}

// A fixed, small coin list (see packages/shared HEADER_TICKER_COINS) — REST-polled rather
// than pushed over the realtime WS channel, same pattern as the coin filter's /coins fetch.
// Matched to apps/worker's own write cadence (at most once every 2s per coin) rather than
// polling much slower — an 8s poll made real per-second price movement invisible, reading
// as "not actually live" even though the backend was updating the whole time.
const POLL_INTERVAL_MS = 3_000;

// How long a changed value stays flashed (see FLASH_UP/FLASH_DOWN below) before fading back
// to the plain accent color.
const FLASH_DURATION_MS = 700;

type FlashDirection = "up" | "down";

export function PriceTicker({ token }: PriceTickerProps) {
  const [prices, setPrices] = useState<CoinPrice[]>([]);
  const [flashes, setFlashes] = useState<Map<string, FlashDirection>>(new Map());
  const previousPrices = useRef<Map<string, string>>(new Map());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    function poll(): void {
      listCoinPrices(token)
        .then((result) => {
          if (cancelled) return;

          const nextFlashes = new Map<string, FlashDirection>();
          for (const price of result) {
            const prev = previousPrices.current.get(price.symbol);
            if (prev !== undefined && prev !== price.midPrice) {
              nextFlashes.set(price.symbol, Number(price.midPrice) > Number(prev) ? "up" : "down");
            }
            previousPrices.current.set(price.symbol, price.midPrice);
          }

          setPrices(result);
          if (nextFlashes.size > 0) {
            setFlashes(nextFlashes);
            if (flashTimer.current) clearTimeout(flashTimer.current);
            flashTimer.current = setTimeout(() => setFlashes(new Map()), FLASH_DURATION_MS);
          }
        })
        .catch((err: unknown) => {
          console.error("failed to load coin prices", err);
        });
    }
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [token]);

  // Nothing to show yet (fresh deploy, worker still warming up) — no empty-state chrome for
  // a header decoration, it just doesn't render until there's something real to show.
  if (prices.length === 0) return null;

  return (
    <div className="ht-price-ticker">
      {prices.map((price) => {
        const flash = flashes.get(price.symbol);
        return (
          <span key={price.symbol} className="ht-price-ticker-item">
            <span className="ht-price-ticker-symbol">{price.symbol}</span>
            <span
              className={`ht-price-ticker-value${flash ? ` ht-price-ticker-value-${flash}` : ""}`}
            >
              {formatPrice(price.midPrice)}
            </span>
          </span>
        );
      })}
    </div>
  );
}
