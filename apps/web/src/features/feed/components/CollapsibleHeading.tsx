interface CollapsibleHeadingProps {
  level: "h2" | "h3";
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  // Visual-only "hide everything currently shown in this table" action — clears the table's
  // own local dismissed-rows set, never touches stored events or server-side alert settings
  // (see RowDeleteButton for the equivalent per-row action). Omitted entirely when there's
  // nothing to clear, rather than rendered disabled.
  onClearAll?: (() => void) | undefined;
}

// Shared heading + chevron toggle for every table section (TopTradesTable, DepositsTable,
// MarketTwapsTable, WhaleActivityTable) — collapsed state lives in each table itself, this
// component only renders the row and flips the chevron (down = collapsed/click to expand,
// up = expanded/click to collapse).
export function CollapsibleHeading({
  level,
  title,
  collapsed,
  onToggle,
  onClearAll,
}: CollapsibleHeadingProps) {
  const Heading = level;
  return (
    <div className="ht-table-header">
      <Heading>{title}</Heading>
      <div className="ht-table-header-actions">
        {onClearAll && (
          <button type="button" className="ht-clear-all-btn" onClick={onClearAll}>
            Clear
          </button>
        )}
        <button
          type="button"
          className="ht-collapse-btn"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          onClick={onToggle}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
