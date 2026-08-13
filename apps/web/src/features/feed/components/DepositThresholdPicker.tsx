import { DEPOSIT_THRESHOLD_PRESETS } from "@hypertracker/shared/schemas/settings";
import type { RealtimeEvent } from "../../../lib/realtime-client.js";
import { DepositsTable } from "./DepositsTable.js";

interface DepositThresholdPickerProps {
  value: string | null;
  // Whether deposit notifications are on at all — independent of `value` (see
  // ThresholdPicker's equivalent prop doc for why the amount survives being turned off).
  enabled: boolean;
  isUpdating: boolean;
  onSelect: (preset: string) => void;
  onToggleOff: () => void;
  // This threshold's own matching-deposits feed, rendered nested at the bottom of this same
  // card via DepositsTable's `bare` mode (see WhaleActivityTable for the same pattern).
  events: RealtimeEvent[];
  walletColors: Map<string, string>;
  walletEmojis: Map<string, string>;
  trackedAddresses: Set<string>;
  trackingAddress: string | null;
  onTrackAddress: (address: string) => void;
}

export function DepositThresholdPicker({
  value,
  enabled,
  isUpdating,
  onSelect,
  onToggleOff,
  events,
  walletColors,
  walletEmojis,
  trackedAddresses,
  trackingAddress,
  onTrackAddress,
}: DepositThresholdPickerProps) {
  return (
    <section className="ht-section">
      <h2>Deposit alert threshold</h2>
      <p>Alert me on deposits above:</p>
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
        {DEPOSIT_THRESHOLD_PRESETS.map((preset) => (
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
      <DepositsTable
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
