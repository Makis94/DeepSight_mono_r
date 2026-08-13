import { useEffect, useRef, useState } from "react";

interface CoinFilterProps {
  coins: string[];
  selected: string[];
  onAdd: (coin: string) => void;
  onRemove: (coin: string) => void;
}

// A real dropdown (not <datalist>, which can't be styled and closes after one pick) —
// click to open, type to filter the ~250-symbol list in place, click/Enter an option to
// add it as a tag without closing, so several coins can be picked in one sitting.
export function CoinFilter({ coins, selected, onAdd, onRemove }: CoinFilterProps) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const query = inputValue.trim().toUpperCase();
  const options = coins.filter(
    (coin) => !selected.includes(coin) && (query === "" || coin.includes(query)),
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [inputValue, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  function selectOption(coin: string): void {
    onAdd(coin);
    setInputValue("");
    setHighlightedIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((i) => Math.min(i + 1, options.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const option = options[highlightedIndex];
      if (option) selectOption(option);
    }
  }

  return (
    <div className="ht-coin-filter" ref={rootRef}>
      <div className="ht-coin-combobox">
        <input
          type="text"
          className="ht-input"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="ht-coin-listbox"
          value={inputValue}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Filter coins…"
        />

        {isOpen && (
          <ul className="ht-coin-dropdown" role="listbox" id="ht-coin-listbox">
            {options.length === 0 && <li className="ht-coin-dropdown-empty">No matches</li>}
            {options.map((coin, index) => (
              <li key={coin}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlightedIndex}
                  className={index === highlightedIndex ? "ht-coin-option-active" : ""}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectOption(coin)}
                >
                  {coin}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected.length > 0 && (
        <ul className="ht-coin-tags">
          {selected.map((coin) => (
            <li key={coin} className="ht-coin-tag">
              {coin}
              <button
                type="button"
                aria-label={`Remove ${coin} from filter`}
                onClick={() => onRemove(coin)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
