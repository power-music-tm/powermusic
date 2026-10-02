import { Loader2 } from 'lucide-react';

/**
 * Compact request summary — stats only; open full history from the navbar.
 */
export default function ManagerRequestSummary({
  summary,
  summaryPending = false,
  summaryError = null,
  pendingUnseenCount = 0,
  unreadCount = 0,
}) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-[var(--color-manager-border)] bg-[var(--color-manager-card)] p-3.5 shadow-[var(--shadow-manager-panel)] sm:p-4"
      aria-labelledby="manager-requests-heading"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--color-brand-accent)]/80 via-[var(--color-brand-secondary)] to-[var(--color-brand-accent)]/80"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id="manager-requests-heading"
            className="text-sm font-semibold text-[var(--color-text-primary)]"
          >
            Your requests
          </h2>
          {pendingUnseenCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white">
              {pendingUnseenCount} pending
            </span>
          )}
          {unreadCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-[var(--color-brand-primary)] px-2 py-0.5 text-[10px] font-semibold text-white">
              {unreadCount} update{unreadCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
          Track submissions and see when Power Music has actioned them.
        </p>
        <p
          className={`mt-2 text-xs ${
            summaryError ? 'text-red-600' : 'text-[var(--color-text-secondary)]'
          }`}
          role={summaryError ? 'alert' : 'status'}
        >
          {summaryPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {summary}
            </span>
          ) : (
            summary
          )}
        </p>
      </div>
    </section>
  );
}
