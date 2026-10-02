export const STATUS_COLUMN_TEXT_CLASS = 'text-[11px] font-semibold leading-none';

/** User-facing duplicate hint for dense table cells. */
export default function DuplicateStatusHint({ indicator }) {
  if (!indicator) return null;

  return (
    <span
      title={indicator.title}
      className={`${STATUS_COLUMN_TEXT_CLASS} text-[var(--color-tag-duplicate-potential-text)]`}
    >
      {indicator.label}
    </span>
  );
}

/** Plain status labels (Not added / Not removed) in the Status column. */
export function StatusColumnPlainLabel({ label }) {
  return (
    <span className={`${STATUS_COLUMN_TEXT_CLASS} text-[var(--color-text-secondary)]`}>
      {label}
    </span>
  );
}
