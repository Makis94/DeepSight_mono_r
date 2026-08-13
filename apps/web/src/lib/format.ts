// $21.64M / $1.56K style shorthand for position/notional sizes — matches the density
// convention of trading-terminal dashboards, where a fixed-width compact form scans faster
// down a column than a full number with thousands separators.
export function formatCompactUsd(value: string): string {
  const amount = Math.abs(Number(value));
  const sign = Number(value) < 0 ? "-" : "";
  if (amount >= 1_000_000) return `${sign}$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${sign}$${(amount / 1_000).toFixed(2)}K`;
  return `${sign}$${amount.toFixed(2)}`;
}

export function formatPrice(value: string): string {
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

export function truncateAddress(address: string): string {
  return `${address.slice(0, 5)}..${address.slice(-3)}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
