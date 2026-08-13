// One hue per watched-wallet slot — reused once a user exceeds this many wallets (see
// MAX_WATCHED_WALLETS in packages/shared, currently 10 vs. 8 colors here: color is a
// supporting cue, the address text is still the ground-truth identifier, so a repeat past
// slot 8 doesn't lose information).
// Validated (dataviz skill, scripts/validate_palette.js) against this app's actual dark
// surface (--bg: #0a0714, see theme.css) and this exact adjacency order — lightness band,
// chroma floor, CVD separation and normal-vision separation all pass for every adjacent pair.
// Re-run the validator against any reorder or hue swap before shipping it.
const WALLET_COLORS: readonly string[] = [
  "#12a894", // teal
  "#3f7fe0", // blue
  "#e0631a", // orange
  "#1590ad", // cyan (darker than --accent, kept distinct from it)
  "#e0527a", // rose
  "#8a5cf0", // violet
  "#e0299e", // magenta
  "#a89400", // yellow
];

// Keyed by the wallet's own DB id rather than its position in the current list, so a
// wallet's color never moves — untracking one wallet must not reshuffle everyone else's
// color, which is what indexing by array position used to cause (removing wallet #1 shifted
// every wallet below it up one slot, and thus up one color).
function walletColorForId(id: number): string {
  const normalized = ((id % WALLET_COLORS.length) + WALLET_COLORS.length) % WALLET_COLORS.length;
  return WALLET_COLORS[normalized] ?? "#22e8ff";
}

export function buildWalletColorMap(
  wallets: readonly { id: number; address: string }[],
): Map<string, string> {
  return new Map(
    wallets.map((wallet) => [wallet.address.toLowerCase(), walletColorForId(wallet.id)]),
  );
}
