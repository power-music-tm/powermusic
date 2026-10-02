/**
 * Standalone filter chips — active fills brand-primary; inactive are bordered white pills.
 */
export default function CountTabs({ tabs, value, onChange, className = '' }) {
  return (
    <div
      role="tablist"
      className={`inline-flex max-w-full flex-wrap items-center gap-2 ${className}`.trim()}
    >
      {tabs.map(({ key, label, count }) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange?.(key)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-all duration-150 ${
              selected
                ? 'bg-[var(--color-brand-primary)] font-semibold text-white shadow-sm'
                : 'border border-[var(--color-border-default)] bg-white font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]/40 hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <span className="leading-none">{label}</span>
            {count != null ? (
              <span
                className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums leading-none ${
                  selected
                    ? 'bg-white/15 text-white'
                    : 'bg-[var(--color-surface-panel)] text-[var(--color-text-muted)]'
                }`}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
