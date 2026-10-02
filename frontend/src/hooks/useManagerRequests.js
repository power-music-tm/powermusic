import { useCallback, useEffect, useRef, useState } from 'react';
import { clearCache, isRateLimitError, loadWithCache, refreshCache } from '../utils/pilot2Api';
import {
  fetchManagerRequestsPage,
  fetchManagerRequestsSummary,
} from '../utils/managerRequestHistory';
import { syncManagerHandledHighlights, syncManagerPendingHighlights } from '../utils/managerUiHighlights';
import { useBackgroundRefresh } from './useBackgroundRefresh';

const CACHE_KEY = 'manager_requests_all';
const SUMMARY_CACHE_KEY = 'manager_requests_summary';
/** Backend caps manager list page size at 50. */
const FETCH_LIMIT = 50;

function applyManagerRequestsPayload(data, onHighlightChange) {
  const items = Array.isArray(data?.items) ? data.items : [];
  let highlightsChanged = syncManagerHandledHighlights(items);
  if (syncManagerPendingHighlights(items)) {
    highlightsChanged = true;
  }
  if (highlightsChanged) {
    onHighlightChange?.();
  }
  return {
    items,
    total: data?.total ?? items.length,
    pendingCount: data?.pendingCount ?? 0,
  };
}

export function filterManagerRequestsByTab(requests, tab) {
  if (tab === 'new') return requests.filter((req) => req.status === 'new');
  if (tab === 'handled') return requests.filter((req) => req.status === 'handled');
  return requests;
}

export function sortManagerRequestsForTab(requests, tab) {
  const filtered = filterManagerRequestsByTab(requests, tab);
  if (tab === 'handled') {
    return [...filtered].sort((a, b) => {
      const aTime = a.handledAt ? new Date(a.handledAt).getTime() : 0;
      const bTime = b.handledAt ? new Date(b.handledAt).getTime() : 0;
      return bTime - aTime;
    });
  }
  return filtered;
}

export function paginateManagerRequests(requests, page, pageSize) {
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * pageSize;
  return {
    items: requests.slice(offset, offset + pageSize),
    total: requests.length,
    page: safePage,
    pageSize,
  };
}

export function useManagerRequestSummary(refreshToken = 0) {
  const [meta, setMeta] = useState({ total: 0, pendingCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshInFlightRef = useRef(false);

  const apply = useCallback((data) => {
    setMeta({
      total: data?.total ?? 0,
      pendingCount: data?.pendingCount ?? 0,
    });
    setError(null);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      await refreshCache(SUMMARY_CACHE_KEY, fetchManagerRequestsSummary, apply);
    } catch (err) {
      console.error(err);
      if (!isRateLimitError(err)) {
        setError(err.message || 'Could not load your requests.');
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [apply]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        if (refreshToken > 0) {
          await refreshCache(SUMMARY_CACHE_KEY, fetchManagerRequestsSummary, (data, isStale) => {
            if (!cancelled) apply(data, isStale);
          });
          return;
        }

        await loadWithCache(SUMMARY_CACHE_KEY, fetchManagerRequestsSummary, (data, isStale) => {
          if (!cancelled) apply(data);
        });
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          if (!isRateLimitError(err)) {
            setError(err.message || 'Could not load your requests.');
          }
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [refreshToken, apply]);

  useBackgroundRefresh(refresh);

  return { meta, loading, error, refresh };
}

export function useManagerRequests(
  refreshToken = 0,
  onHighlightChange,
  { enabled = false, backgroundPollEnabled, pollIntervalMs = 60000, networkFirst = false } = {},
) {
  const [requests, setRequests] = useState([]);
  const [meta, setMeta] = useState({ total: 0, pendingCount: 0 });
  const [initialLoading, setInitialLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasLoadedRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const onHighlightChangeRef = useRef(onHighlightChange);
  onHighlightChangeRef.current = onHighlightChange;

  const apply = useCallback((data, isStale) => {
    const items = Array.isArray(data?.items) ? data.items : [];
    // Ignore stale empty snapshots — summary may already show requests exist.
    if (isStale && items.length === 0) return;

    const next = applyManagerRequestsPayload(data, () => {
      onHighlightChangeRef.current?.();
    });
    setRequests(next.items);
    setMeta({ total: next.total, pendingCount: next.pendingCount });
    setError(null);
    setInitialLoading(false);
    if (!isStale) hasLoadedRef.current = true;
  }, []);

  const fetchAll = useCallback(
    () => fetchManagerRequestsPage({ page: 1, limit: FETCH_LIMIT }),
    [],
  );

  const refresh = useCallback(async () => {
    if (!enabled || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      await refreshCache(CACHE_KEY, fetchAll, apply);
    } catch (err) {
      console.error(err);
      if (!isRateLimitError(err)) {
        setError(err.message || 'Could not load your requests.');
      }
      setInitialLoading(false);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [apply, enabled, fetchAll]);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    setInitialLoading(!hasLoadedRef.current);

    const run = async () => {
      try {
        if (networkFirst) {
          clearCache(CACHE_KEY);
        }

        if (hasLoadedRef.current && refreshToken > 0) {
          await refreshCache(CACHE_KEY, fetchAll, (data, isStale) => {
            if (!cancelled) apply(data, isStale);
          });
          return;
        }

        if (networkFirst) {
          await refreshCache(CACHE_KEY, fetchAll, (data, isStale) => {
            if (!cancelled) apply(data, isStale);
          });
          return;
        }

        await loadWithCache(CACHE_KEY, fetchAll, (data, isStale) => {
          if (!cancelled) apply(data, isStale);
        });
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          if (!isRateLimitError(err)) {
            setError(err.message || 'Could not load your requests.');
          }
          setInitialLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshToken, apply, fetchAll, networkFirst]);

  useBackgroundRefresh(refresh, {
    enabled: backgroundPollEnabled ?? enabled,
    intervalMs: pollIntervalMs,
  });

  return {
    requests,
    meta,
    initialLoading,
    error,
    refresh,
  };
}
