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
  if (total <= 0) {
    return (
      <div className={`px-2 text-xs font-medium text-[var(--color-text-secondary)] ${className}`.trim()}>
        0 {noun}
      </div>
    );
  }

  const showControls = totalPages > 1;

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
          <span className="text-xs font-semibold text-[var(--color-text-primary)] px-1 tabular-nums">
            {page}/{totalPages}
          </span>
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
