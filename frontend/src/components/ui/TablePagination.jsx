import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import HoverTip from './HoverTip';

export default function TablePagination({
  page,
  totalPages,
  total,
  pageStart,
  pageEnd,
  onPageChange,
  noun = 'rows',
  className = '',
}) {
  const [draftPage, setDraftPage] = useState(String(page));

  useEffect(() => {
    setDraftPage(String(page));
  }, [page]);

  if (total <= 0) {
    return (
      <div className={`px-2 text-xs font-medium text-[var(--color-text-secondary)] ${className}`.trim()}>
        0 {noun}
      </div>
    );
  }

  const showControls = totalPages > 1;

  const commitPage = () => {
    const parsed = Number.parseInt(String(draftPage).trim(), 10);
    if (!Number.isFinite(parsed)) {
      setDraftPage(String(page));
      return;
    }
    const next = Math.min(totalPages, Math.max(1, parsed));
    setDraftPage(String(next));
    if (next !== page) onPageChange(next);
  };

  return (
    <div
      className={`flex items-center justify-between gap-3 px-2 py-1.5 ${className}`.trim()}
    >
      <span className="text-xs font-medium text-[var(--color-text-secondary)] tabular-nums">
        {showControls
          ? `${pageStart}–${pageEnd} of ${total} ${noun}`
          : `${total} ${noun}`}
      </span>
      {showControls ? (
        <div className="flex items-center gap-1">
          <HoverTip label="Previous page">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-highlight)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </HoverTip>
          <label className="inline-flex items-center gap-0.5 text-xs font-semibold text-[var(--color-text-primary)] px-1 tabular-nums">
            <span className="sr-only">Page</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={draftPage}
              onChange={(e) => setDraftPage(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={commitPage}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  setDraftPage(String(page));
                  e.currentTarget.blur();
                }
              }}
              aria-label={`Page number, ${page} of ${totalPages}`}
              className="w-10 rounded-md border border-[var(--color-border-default)] bg-white px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none focus:ring-2 focus:ring-[rgba(233,69,96,0.12)]"
            />
            <span aria-hidden="true">/</span>
            <span>{totalPages}</span>
          </label>
          <HoverTip label="Next page">
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-highlight)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </HoverTip>
        </div>
      ) : null}
    </div>
  );
}
