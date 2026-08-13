import { TWAP_THRESHOLD_PRESETS } from "@hypertracker/shared/schemas/settings";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";
import { CoinExclusionToggle } from "./CoinExclusionToggle.js";
import { LikelyTwapsTable } from "./LikelyTwapsTable.js";

interface TwapThresholdPickerProps {
  value: string | null;
  // Whether likely-TWAP notifications are on at all — independent of `value` (see
  // ThresholdPicker's equivalent prop doc for why the amount survives being turned off).
  enabled: boolean;
  isUpdating: boolean;
  onSelect: (preset: string) => void;
  onToggleOff: () => void;
  // Shared BTC/ETH exclusion setting (users.excludeBtc/excludeEth) — also surfaced on
  // ThresholdPicker, since it's one user-level setting feeding both feeds.
  excludeBtc: boolean;
  excludeEth: boolean;
  isUpdatingCoinExclusions: boolean;
  onToggleExcludeBtc: (value: boolean) => void;
  onToggleExcludeEth: (value: boolean) => void;
  // This threshold's own matching-TWAPs feed, rendered nested at the bottom of this same
  // card via LikelyTwapsTable's `bare` mode (see WhaleActivityTable for the same pattern).
  events: RealtimeEvent[];
  walletColors: Map<string, string>;
  walletEmojis: Map<string, string>;
  trackedAddresses: Set<string>;
  trackingAddress: string | null;
  onTrackAddress: (address: string) => void;
}

export function TwapThresholdPicker({
  value,
  enabled,
  isUpdating,
  onSelect,
  onToggleOff,
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
}: TwapThresholdPickerProps) {
  return (
    <section className="ht-section">
      <h2>Likely TWAP alert threshold</h2>
      <p>Alert me on likely-TWAP activity above:</p>
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
        {TWAP_THRESHOLD_PRESETS.map((preset) => (
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
      <CoinExclusionToggle
        excludeBtc={excludeBtc}
        excludeEth={excludeEth}
        isUpdating={isUpdatingCoinExclusions}
        onToggleBtc={onToggleExcludeBtc}
        onToggleEth={onToggleExcludeEth}
      />
      <LikelyTwapsTable
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
