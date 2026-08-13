// A second, independent identifying cue for the tracker lists (CommonWalletsPanel /
// PreciseWalletPanel) — colors alone (wallet-colors.ts) run out at 8 hues while up to
// MAX_WATCHED_WALLETS (10) can be tracked at once, so two wallets can land on the same color
// and become hard to tell apart at a glance (see the Pseudo Tracker screenshot this was
// reported from). 17 is deliberately coprime-ish with WALLET_COLORS' length of 8 (their gcd
// is 1) so a color collision (id1 % 8 === id2 % 8) essentially never also produces an emoji
// collision (id1 % 17 === id2 % 17) for realistic wallet id gaps — the two cues fail
// independently instead of together.
const WALLET_EMOJI: readonly string[] = [
  "🐰",
  "🐢",
  "🦊",
  "🦉",
  "🐼",
  "🐨",
  "🐯",
  "🦁",
  "🐸",
  "🐧",
  "🐙",
  "🐝",
  "🦋",
  "🐬",
  "🐺",
  "🐻",
  "🦔",
];

// Same "keyed by DB id, not list position" reasoning as walletColorForId in wallet-colors.ts —
// untracking a wallet must not reshuffle everyone else's emoji.
function walletEmojiForId(id: number): string {
  const normalized = ((id % WALLET_EMOJI.length) + WALLET_EMOJI.length) % WALLET_EMOJI.length;
  return WALLET_EMOJI[normalized] ?? "🐾";
}

export function buildWalletEmojiMap(
  wallets: readonly { id: number; address: string }[],
): Map<string, string> {
  return new Map(
    wallets.map((wallet) => [wallet.address.toLowerCase(), walletEmojiForId(wallet.id)]),
  );
}
