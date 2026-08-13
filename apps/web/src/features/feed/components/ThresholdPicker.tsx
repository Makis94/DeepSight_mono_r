import { TRADE_THRESHOLD_PRESETS } from "@hypertracker/shared/schemas/settings";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";
import { CoinExclusionToggle } from "./CoinExclusionToggle.js";
import { CoinFilter } from "./CoinFilter.js";
import { TopTradesTable } from "./TopTradesTable.js";

interface ThresholdPickerProps {
  value: string | null;
  // Whether large-trade notifications are on at all — independent of `value`, which stays
  // whatever it was last set to even while off, so turning back on restores it (see
  // FeedPage's handleToggleTradeNotify).
  enabled: boolean;
  isUpdating: boolean;
  onSelect: (preset: string) => void;
  onToggleOff: () => void;
  coins: string[];
  selectedCoins: string[];
  onAddCoin: (coin: string) => void;
  onRemoveCoin: (coin: string) => void;
  // Shared BTC/ETH exclusion setting (users.excludeBtc/excludeEth) — also surfaced on
  // TwapThresholdPicker, since it's one user-level setting feeding both feeds.
  excludeBtc: boolean;
  excludeEth: boolean;
  isUpdatingCoinExclusions: boolean;
  onToggleExcludeBtc: (value: boolean) => void;
  onToggleExcludeEth: (value: boolean) => void;
  // This threshold's own matching-trades feed, rendered nested at the bottom of this same
  // card via TopTradesTable's `bare` mode (see WhaleActivityTable for the same pattern).
  events: RealtimeEvent[];
  walletColors: Map<string, string>;
  walletEmojis: Map<string, string>;
  trackedAddresses: Set<string>;
  trackingAddress: string | null;
  onTrackAddress: (address: string) => void;
}

export function ThresholdPicker({
  value,
  enabled,
  isUpdating,
  onSelect,
  onToggleOff,
  coins,
  selectedCoins,
  onAddCoin,
  onRemoveCoin,
  excludeBtc,
  excludeEth,
  isUpdatingCoinExclusions,
  onToggleExcludeBtc,
  onToggleExcludeEth,
  events,
  walletColors,
  walletEmojis,
  trackedAddresses,
  trackingAddress,
  onTrackAddress,
}: ThresholdPickerProps) {
  return (
    <section className="ht-section">
      <h2>Large trade alert threshold</h2>
      <p>Alert me on trades above:</p>
      <div className="ht-threshold-row">
        <button
          type="button"
          className="ht-btn ht-btn-off"
          disabled={isUpdating}
          aria-pressed={!enabled}
          onClick={onToggleOff}
        >
          Off
        </button>
        {TRADE_THRESHOLD_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="ht-btn"
            disabled={isUpdating}
            aria-pressed={enabled && value === preset}
            onClick={() => onSelect(preset)}
          >
            ${Number(preset).toLocaleString()}
          </button>
        ))}
      </div>
      <CoinFilter
        coins={coins}
        selected={selectedCoins}
        onAdd={onAddCoin}
        onRemove={onRemoveCoin}
      />
      <CoinExclusionToggle
        excludeBtc={excludeBtc}
        excludeEth={excludeEth}
        isUpdating={isUpdatingCoinExclusions}
        onToggleBtc={onToggleExcludeBtc}
        onToggleEth={onToggleExcludeEth}
      />
      <TopTradesTable
        bare
        enabled={enabled}
        events={events}
        walletColors={walletColors}
        walletEmojis={walletEmojis}
        trackedAddresses={trackedAddresses}
        trackingAddress={trackingAddress}
        onTrack={onTrackAddress}
      />
    </section>
  );
}
