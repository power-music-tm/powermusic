import { useEffect, useMemo, useState } from 'react';

/**
 * Client-side pagination for already-loaded lists (admin tables, etc.).
 * Resets to page 1 whenever `resetKey` changes (filters, tabs, search).
 */
export function useClientPagination(items, { pageSize = 20, resetKey = '' } = {}) {
  const [page, setPage] = useState(1);
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(1, current), totalPages));
  }, [totalPages]);

  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [list, currentPage, pageSize]);

  const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, total);

  return {
    pageItems,
    page: currentPage,
    setPage,
    totalPages,
    total,
    pageStart,
    pageEnd,
    pageSize,
  };
}
