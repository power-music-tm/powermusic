import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_PAGE_SIZE = 4;
const MAX_PAGE_SIZE = 24;
const FALLBACK_ROW_HEIGHT = 48;

/**
 * Sets page size to the number of rows that fit in the list viewport.
 * Each page ≈ one screen of requests — pagination replaces in-list scrolling.
 */
export function useAdaptiveListPageSize(listRef, rowRef, active = true) {
  const [pageSize, setPageSize] = useState(10);
  const rowHeightRef = useRef(FALLBACK_ROW_HEIGHT);

  const measure = useCallback(() => {
    if (!active) return;

    const list = listRef.current;
    if (!list) return;

    if (rowRef?.current) {
      const measured = rowRef.current.getBoundingClientRect().height;
      if (measured > 0) rowHeightRef.current = Math.ceil(measured);
    }

    const height = list.clientHeight;
    if (height <= 0) return;

    const rowHeight = rowHeightRef.current || FALLBACK_ROW_HEIGHT;
    const visibleRows = Math.max(1, Math.floor(height / rowHeight));
    const next = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, visibleRows));

    setPageSize((current) => (current === next ? current : next));
  }, [active, listRef, rowRef]);

  useEffect(() => {
    if (!active) return undefined;

    measure();
    const list = listRef.current;
    if (!list) return undefined;

    const ro = new ResizeObserver(() => measure());
    ro.observe(list);
    window.addEventListener('resize', measure);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active, measure]);

  return pageSize;
}
