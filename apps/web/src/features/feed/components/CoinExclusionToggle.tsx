interface ToggleProps {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: boolean) => void;
}

// Sliding pill switch instead of a bare checkbox — matches the rest of the feed's neon
// styling (glow-on-active, see .ht-btn[aria-pressed]) rather than reading as unstyled HTML.
// Uses --short for the checked/active glow, the same color the "Off" notification buttons
// already use for "this alert type is toggled away from its default" (see .ht-btn-off in
// feed.css) — excluding a coin is the same kind of opt-out, so it borrows that vocabulary
// instead of introducing a new color meaning.
function Toggle({ checked, disabled, label, onChange }: ToggleProps) {
  return (
    <label className="ht-toggle-row">
      <span className="ht-toggle">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="ht-toggle-track" aria-hidden="true" />
      </span>
      <span className={checked ? "ht-toggle-label ht-toggle-label-active" : "ht-toggle-label"}>
        {label}
      </span>
    </label>
  );
}

interface CoinExclusionToggleProps {
  excludeBtc: boolean;
  excludeEth: boolean;
  isUpdating: boolean;
  onToggleBtc: (value: boolean) => void;
  onToggleEth: (value: boolean) => void;
}

// One shared user-level setting (users.excludeBtc/excludeEth) surfaced next to both the Large
// trades and TWAPs cards — BTC/ETH dominate both feeds' volume, so a user focused on
// other coins can opt either one out here without losing large-trade/TWAP alerts entirely.
export function CoinExclusionToggle({
  excludeBtc,
  excludeEth,
  isUpdating,
  onToggleBtc,
  onToggleEth,
}: CoinExclusionToggleProps) {
  return (
    <div className="ht-coin-exclusions">
      <Toggle
        checked={excludeBtc}
        disabled={isUpdating}
        label="Exclude BTC"
        onChange={onToggleBtc}
      />
      <Toggle
        checked={excludeEth}
        disabled={isUpdating}
        label="Exclude ETH"
        onChange={onToggleEth}
      />
    </div>
  );
}
