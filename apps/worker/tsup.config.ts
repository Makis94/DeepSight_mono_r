import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "wallet-watcher/index": "src/wallet-watcher/index.ts",
    "market-watcher/index": "src/market-watcher/index.ts",
    "deposit-watcher/index": "src/deposit-watcher/index.ts",
    "coin-registry-sync/index": "src/coin-registry-sync/index.ts",
    "common-wallet-tracker/index": "src/common-wallet-tracker/index.ts",
    "subscription-watcher/index": "src/subscription-watcher/index.ts",
    "twap-watcher/index": "src/twap-watcher/index.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  noExternal: [/^@hypertracker\//],
});
