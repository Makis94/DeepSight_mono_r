interface RowDeleteButtonProps {
  label: string;
  onClick: () => void;
}

// Visual-only row dismissal — hides a single row from this table's own local view. Never
// touches stored events, the realtime feed, or any server-side alert setting (see
// CoinExclusionToggle for the equivalent when actual suppression at the source is needed).
export function RowDeleteButton({ label, onClick }: RowDeleteButtonProps) {
  return (
    <button type="button" className="ht-row-delete" aria-label={label} onClick={onClick}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 4.5h10M6.5 4.5V2.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75V4.5M4.5 4.5l.6 8.6a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.6"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
