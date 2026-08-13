import { coinRegistry, type Database } from "@hypertracker/db";
import { getMeta, HYPERLIQUID_REST_URLS } from "@hypertracker/hyperliquid-sdk";
import { notInArray } from "drizzle-orm";
import type { Logger } from "pino";
import { fetchCmcTopSymbols, type CmcSource } from "./cmc-client.js";
import { CMC_TOP_PLACEHOLDER_SYMBOLS } from "./cmc-top-placeholder.js";

export async function syncCoinRegistry(
  db: Database,
  logger: Logger,
  cmcSource: CmcSource,
): Promise<void> {
  const universe = await getMeta(HYPERLIQUID_REST_URLS.mainnet);
  const cmcTopSymbols = cmcSource.useReal
    ? await fetchCmcTopSymbols(cmcSource.apiKey, 250)
    : CMC_TOP_PLACEHOLDER_SYMBOLS;
  const cmcTopSet = new Set<string>(cmcTopSymbols);

  const active = universe.filter((entry) => !entry.isDelisted && cmcTopSet.has(entry.name));
  const activeSymbols = active.map((entry) => entry.name);

  for (const entry of active) {
    await db
      .insert(coinRegistry)
      .values({ symbol: entry.name, hyperliquidName: entry.name, isActive: true })
      .onConflictDoUpdate({
        target: coinRegistry.symbol,
        set: { isActive: true, updatedAt: new Date() },
      });
  }

  if (activeSymbols.length > 0) {
    await db
      .update(coinRegistry)
      .set({ isActive: false, updatedAt: new Date() })
      .where(notInArray(coinRegistry.symbol, activeSymbols));
  }

  logger.info(
    {
      hyperliquidUniverseSize: universe.length,
      activeCount: activeSymbols.length,
      cmcSource: cmcSource.useReal ? "real" : "placeholder",
    },
    cmcSource.useReal
      ? "coin_registry synced against Hyperliquid meta and real CMC top-250"
      : "coin_registry synced against Hyperliquid meta (CMC side is a placeholder list, not real top-250)",
  );
}
