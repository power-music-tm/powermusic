import { useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { DataTable, TablePagination } from '../ui';
import ManagerRequestHistoryRow from './ManagerRequestHistoryRow';
import ManagerRequestHistoryTabs, {
  MANAGER_REQUEST_HISTORY_PANEL_ID,
} from './ManagerRequestHistoryTabs';
import ManagerRequestHistoryEmpty, {
  ManagerRequestHistoryNotice,
} from './ManagerRequestHistoryEmpty';
import { buildManagerRequestHistoryColumns } from './managerRequestHistoryColumns';
import { getPartnerTerminology } from '../../utils/managerAuthBranding';
import {
  countManagerHandledRequestUnseen,
  countManagerPendingUnseen,
  dismissAllManagerHandledHighlights,
  dismissManagerPendingHighlights,
  markManagerHandledRequestViewed,
} from '../../utils/managerUiHighlights';
import { MANAGER_UPDATE_HIGHLIGHT_CLASS } from '../../utils/managerRequestHistory';
import { sortManagerRequestsForTab } from '../../hooks/useManagerRequests';
import { useClientPagination } from '../../hooks/useClientPagination';

function latestHandledRequestId(requests) {
  let latestId = null;
  let latestTime = -1;
  for (const request of requests) {
    if (request.status !== 'handled') continue;
    const time = request.handledAt ? new Date(request.handledAt).getTime() : 0;
    if (time > latestTime) {
      latestTime = time;
      latestId = request.id;
    }
  }
  return latestId;
}

function latestPendingRequestId(requests) {
  let latestId = null;
  let latestTime = -1;
  for (const request of requests) {
    if (request.status !== 'new') continue;
    const time = request.receivedAt ? new Date(request.receivedAt).getTime() : 0;
    if (time > latestTime) {
      latestTime = time;
      latestId = request.id;
    }
  }
  return latestId;
}

/**
 * Inline request history — same content as the former modal, embedded in the portal.
 */
export default function ManagerRequestHistoryPanel({
  onBack,
  requests = [],
  pendingUnseenCount = 0,
  loading = false,
  error = null,
  highlightVersion = 0,
  onHighlightChange,
  embedded = false,
  backLabel = 'Back',
  partnerName,
  partnerSlug,
}) {
  const [activeTab, setActiveTab] = useState('all');

  const effectivePartnerName = partnerName || requests[0]?.partnerName || requests[0]?.partner_name;
  const effectivePartnerSlug = partnerSlug || requests[0]?.partnerSlug || requests[0]?.partner_slug;
  const partnerTerms = useMemo(
    () => getPartnerTerminology(effectivePartnerName, effectivePartnerSlug),
    [effectivePartnerName, effectivePartnerSlug],
  );

  const unreadCount = useMemo(() => {
    void highlightVersion;
    return countManagerHandledRequestUnseen();
  }, [highlightVersion]);

  const pendingUnseenInSession = useMemo(() => {
    void highlightVersion;
    return countManagerPendingUnseen();
  }, [highlightVersion]);

  const tabbedRequests = useMemo(
    () => sortManagerRequestsForTab(requests, activeTab),
    [requests, activeTab],
  );

  const {
    pageItems,
    page,
    setPage,
    totalPages,
    total,
    pageStart,
    pageEnd,
  } = useClientPagination(tabbedRequests, { pageSize: 20, resetKey: activeTab });

  const spotlightRequestId = useMemo(() => {
    void highlightVersion;
    if (unreadCount > 0 && (activeTab === 'handled' || activeTab === 'all')) {
      return latestHandledRequestId(tabbedRequests);
    }
    if (pendingUnseenInSession > 0 && (activeTab === 'new' || activeTab === 'all')) {
      return latestPendingRequestId(tabbedRequests);
    }
    return null;
  }, [activeTab, highlightVersion, pendingUnseenInSession, tabbedRequests, unreadCount]);

  const handleOpenRequest = (request) => {
    if (request.status !== 'handled') return;
    if (request.id === spotlightRequestId) {
      dismissAllManagerHandledHighlights();
    } else {
      markManagerHandledRequestViewed(request.id);
    }
    onHighlightChange?.();
  };

  const handleDismissAll = () => {
    dismissAllManagerHandledHighlights();
    onHighlightChange?.();
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    dismissManagerPendingHighlights(requests);
    dismissAllManagerHandledHighlights();
    onHighlightChange?.();
  };

  const tabCounts = useMemo(() => {
    const pending = requests.filter((request) => request.status === 'new').length;
    const handled = requests.filter((request) => request.status === 'handled').length;
    return {
      all: requests.length,
      new: pending,
      handled,
    };
  }, [requests]);

  const dateColumnLabel =
    activeTab === 'new' ? 'Submitted' : activeTab === 'handled' ? 'Handled at' : 'Date';

  const columns = useMemo(
    () => buildManagerRequestHistoryColumns(dateColumnLabel, partnerTerms),
    [dateColumnLabel, partnerTerms],
  );

  const tableRows = useMemo(
    () =>
      pageItems.map((request, index) => ({
        ...request,
        _rowNumber: pageStart + index,
        _dateValue: request.status === 'handled' ? request.handledAt : request.receivedAt,
        _showAsNew: request.id === spotlightRequestId,
      })),
    [pageItems, pageStart, spotlightRequestId],
  );

  const hasList = !loading && !error && tabbedRequests.length > 0;

  const shellClass = embedded
    ? 'relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-manager-panel)]'
    : 'relative overflow-hidden rounded-2xl border border-[var(--color-manager-border)] bg-[var(--color-manager-card)] shadow-[var(--shadow-manager-form)]';

  return (
    <section
      aria-labelledby="manager-request-history-heading"
      className={shellClass}
    >
      {!embedded && (
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--color-brand-accent)]/80 via-[var(--color-brand-secondary)] to-[var(--color-brand-accent)]/80"
        aria-hidden="true"
      />
      )}

      <div className={`flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-manager-border)] ${embedded ? 'px-4 py-3 sm:px-5' : 'px-4 py-3 sm:px-6'}`}>
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-white/80 hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/30"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {backLabel}
          </button>
          <div className="min-w-0">
            <h1
              id="manager-request-history-heading"
              className="truncate text-base font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-lg"
            >
              Your requests
            </h1>
          </div>
        </div>

        {!loading && !error && requests.length > 0 && (
          <p className="text-[11px] tabular-nums text-[var(--color-text-muted)]">
            {tabCounts.new > 0 ? (
              <>
                <span className="font-semibold text-amber-700">{tabCounts.new}</span> pending
                <span aria-hidden="true"> · </span>
              </>
            ) : null}
            {tabCounts.handled} handled
          </p>
        )}
      </div>

      <ManagerRequestHistoryNotice unreadCount={unreadCount} onDismissAll={handleDismissAll} />

      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${embedded ? 'p-4 sm:p-5' : 'space-y-4 p-4 sm:space-y-5 sm:p-6'}`}>
        <div className="shrink-0">
        <ManagerRequestHistoryTabs
          activeTab={activeTab}
          onChange={handleTabChange}
          counts={tabCounts}
          pendingUnseenCount={pendingUnseenCount}
          unreadCount={unreadCount}
        />
        </div>

        <div
          role="tabpanel"
          id={MANAGER_REQUEST_HISTORY_PANEL_ID}
          aria-labelledby={`manager-request-history-tab-${activeTab}`}
          className={`min-h-0 flex-1 ${embedded ? 'mt-4 overflow-y-auto overscroll-contain' : ''}`}
        >
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading your requests…
            </div>
          )}

          {!loading && error && (
            <p className="py-16 text-center text-xs text-red-600" role="alert">
              {error}
            </p>
          )}

          {!loading && !error && tabbedRequests.length === 0 && (
            <ManagerRequestHistoryEmpty activeTab={activeTab} />
          )}

          {hasList && (
            <>
              <ul className="divide-y divide-[var(--color-border-default)] rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] sm:hidden">
                {tableRows.map((request) => (
                  <ManagerRequestHistoryRow
                    key={request.id}
                    request={request}
                    rowNumber={request._rowNumber}
                    onOpen={handleOpenRequest}
                    showAsNew={request._showAsNew}
                  />
                ))}
              </ul>

              <div className="hidden w-full sm:block">
                <DataTable
                  columns={columns}
                  rows={tableRows}
                  onRowClick={handleOpenRequest}
                  getRowClassName={(row) =>
                    row._showAsNew ? MANAGER_UPDATE_HIGHLIGHT_CLASS : ''
                  }
                  emptyMessage="No requests yet."
                  compact
                  centerHeaders
                  accent
                />
              </div>
            </>
          )}
        </div>

        {hasList && (
          <div className="shrink-0 pt-4">
          <TablePagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageStart={pageStart}
            pageEnd={pageEnd}
            onPageChange={setPage}
            noun="requests"
          />
          </div>
        )}
      </div>
    </section>
  );
}
