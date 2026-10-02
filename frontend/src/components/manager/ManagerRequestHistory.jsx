import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  countManagerHandledRequestUnseen,
  countManagerPendingUnseen,
  dismissAllManagerHandledHighlights,
  dismissManagerPendingHighlights,
  registerManagerHandledPageVisit,
} from '../../utils/managerUiHighlights';
import { clearCache } from '../../utils/pilot2Api';
import {
  useManagerRequestSummary,
  useManagerRequests,
} from '../../hooks/useManagerRequests';
import ManagerRequestSummary from './ManagerRequestSummary';
import ManagerRequestHistoryPanel from './ManagerRequestHistoryPanel';

function requestSummaryText({
  total,
  pendingCount,
  pendingUnseenCount,
  unreadCount,
  loading,
  error,
  historyOpen,
}) {
  if (historyOpen && loading) return 'Loading your request history…';
  if (loading && total === 0 && pendingCount === 0 && !error) return 'Loading your requests…';
  if (error) return error;
  if (total === 0) return 'You have not submitted any requests yet.';
  const parts = [];
  if (pendingUnseenCount > 0) {
    parts.push(`${pendingUnseenCount} new pending`);
  } else if (pendingCount > 0) {
    parts.push(`${pendingCount} pending`);
  }
  parts.push(`${total} total`);
  if (unreadCount > 0) {
    parts.push(`${unreadCount} new update${unreadCount === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

/** Single source of truth for manager request summary + full list. */
export function useManagerRequestPortal(refreshToken = 0, requestsOpen = false) {
  const location = useLocation();
  const [highlightVersion, setHighlightVersion] = useState(0);

  const bumpHighlights = useCallback(() => setHighlightVersion((v) => v + 1), []);
  const { meta: summaryMeta, loading: summaryLoading, error: summaryError, refresh: refreshSummary } =
    useManagerRequestSummary(refreshToken);

  const hasKnownRequests = summaryMeta.total > 0 || summaryMeta.pendingCount > 0;
  const listEnabled = requestsOpen || hasKnownRequests;

  const {
    requests,
    meta,
    initialLoading,
    error: historyError,
    refresh: refreshRequests,
  } = useManagerRequests(refreshToken, bumpHighlights, {
    enabled: listEnabled,
    backgroundPollEnabled: requestsOpen,
    pollIntervalMs: 15000,
    networkFirst: requestsOpen,
  });

  useEffect(() => {
    if (!requestsOpen) return;
    clearCache('manager_requests_all');
    clearCache('manager_requests_summary');
    refreshSummary();
    refreshRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestsOpen]);

  useEffect(() => {
    registerManagerHandledPageVisit(location.key);
    bumpHighlights();
  }, [location.key, bumpHighlights]);

  const unreadCount = useMemo(() => {
    void highlightVersion;
    return countManagerHandledRequestUnseen();
  }, [highlightVersion]);

  const pendingUnseenCount = useMemo(() => {
    void highlightVersion;
    return countManagerPendingUnseen();
  }, [highlightVersion]);

  const summaryPending = summaryLoading && summaryMeta.total === 0 && summaryMeta.pendingCount === 0;

  const summary = requestSummaryText({
    total: summaryMeta.total,
    pendingCount: summaryMeta.pendingCount,
    pendingUnseenCount,
    unreadCount,
    loading: summaryLoading,
    error: summaryError,
    historyOpen: requestsOpen,
  });

  const listLoading = initialLoading && requests.length === 0 && !historyError;

  const closeHistory = useCallback(() => {
    dismissManagerPendingHighlights(requests);
    dismissAllManagerHandledHighlights();
    bumpHighlights();
    refreshSummary();
    refreshRequests();
  }, [requests, bumpHighlights, refreshSummary, refreshRequests]);

  return {
    summary,
    summaryPending,
    summaryError,
    pendingUnseenCount,
    unreadCount,
    totalBadgeCount: pendingUnseenCount + unreadCount,
    requests,
    pendingCount: meta.pendingCount || summaryMeta.pendingCount,
    summaryTotal: summaryMeta.total,
    listLoading,
    historyError,
    highlightVersion,
    bumpHighlights,
    closeHistory,
    summaryLoading,
  };
}

export default function ManagerRequestHistory({
  refreshToken = 0,
  requestsOpen = false,
  onCloseRequests,
}) {
  const portal = useManagerRequestPortal(refreshToken, requestsOpen);

  const handleCloseHistory = () => {
    portal.closeHistory();
    onCloseRequests?.();
  };

  if (requestsOpen) {
    return (
      <ManagerRequestHistoryPanel
        onBack={handleCloseHistory}
        requests={portal.requests}
        pendingUnseenCount={portal.pendingUnseenCount}
        loading={portal.listLoading}
        error={portal.historyError}
        highlightVersion={portal.highlightVersion}
        onHighlightChange={portal.bumpHighlights}
      />
    );
  }

  return (
    <ManagerRequestSummary
      summary={portal.summary}
      summaryPending={portal.summaryPending}
      summaryError={portal.summaryError}
      pendingUnseenCount={portal.pendingUnseenCount}
      unreadCount={portal.unreadCount}
    />
  );
}

/** @deprecated Use useManagerRequestPortal instead */
export function useManagerRequestNavBadges(refreshToken = 0) {
  const portal = useManagerRequestPortal(refreshToken, false);
  return {
    summaryMeta: { total: 0, pendingCount: 0 },
    summaryLoading: portal.summaryLoading,
    pendingUnseenCount: portal.pendingUnseenCount,
    unreadCount: portal.unreadCount,
    totalBadgeCount: portal.totalBadgeCount,
    bumpHighlights: portal.bumpHighlights,
  };
}
