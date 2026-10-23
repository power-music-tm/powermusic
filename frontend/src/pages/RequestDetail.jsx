import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import RequestDetailView from '../components/RequestDetailDrawer';
import { AdminPageScroll, Modal, Toast, useToast } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { usePartners } from '../context/PartnerContext';
import { useRealtimeBroadcast } from '../hooks/useRealtimeBroadcast';
import { fetchJson } from '../utils/api';
import {
  getAdminRequest,
  getNewRequestsPage,
  loadWithCache,
  patchCache,
  refreshCache,
  writeCache,
  suppressNewRequests,
  removeRequestsFromCache,
  bumpCacheEpoch,
  REQUESTS_PAGE_CACHE_KEY,
} from '../utils/pilot2Api';
import { fetchGroupDetail } from '../utils/duplicateGroupApi';
import { groupDetailCacheKey } from '../utils/groupDetailCache';
import { getManagerDisplayName } from '../utils/manualEntry';
import {
  markDirectoryPersonHighlight,
  markRequestViewed,
  removeRequestHighlight,
} from '../utils/adminUiHighlights';
import { formatPersonName } from '../utils/personDisplay';

/** Match Group Detail cadence so the 1→2 grouping jump is not slower than 3+. */
const REQUEST_DETAIL_POLL_MS = 4000;

function safeNewRequestsBackPath(from) {
  if (typeof from !== 'string') return '/new-requests';
  if (!from.startsWith('/new-requests')) return '/new-requests';
  if (from.includes('://') || from.includes('//')) return '/new-requests';
  return from;
}

function seedFromRequest(match, groupDetail = null) {
  const members = Array.isArray(groupDetail?.members) ? groupDetail.members : null;
  return {
    id: match.id,
    displayId: match.displayId,
    receivedAt: match.receivedAt,
    person: match.person,
    action: match.action,
    status: match.status,
    submittedBy: match.submittedBy,
    notes: match.notes,
    tags: match.tags,
    createdBy: match.createdBy,
    directorFirst: match.directorFirst || match.person?.directorFirst,
    directorLast: match.directorLast || match.person?.directorLast,
    groupClassificationSummary: groupDetail?.classificationSummary || null,
    groupMembers: members,
    groupDirectoryPersonId: groupDetail?.directoryPersonId || null,
    groupDirectoryPerson: groupDetail?.directoryPerson || null,
    groupPreview: groupDetail
      ? {
          members,
          representativeRequestId: groupDetail.representativeRequestId || match.id,
          classificationSummary: groupDetail.classificationSummary || null,
          directoryPersonId: groupDetail.directoryPersonId || null,
        }
      : null,
  };
}

/**
 * When a solo request gains a duplicate group, hand off to Group Detail with a
 * warm cache + list seed so the 2nd member paints like later arrivals (no load flash).
 * `arrival`: the duplicate landed while this page was open — Group Detail shows
 * the same "New request arrived" alert it shows for 3rd+ arrivals.
 */
async function promoteToGroupDetail(match, navigate, { arrival = false } = {}) {
  const groupId = match?.duplicateGroupId;
  if (!groupId || match.status !== 'new') return false;

  let detail = null;
  try {
    detail = await fetchGroupDetail(groupId);
    if (detail?.id) {
      writeCache(groupDetailCacheKey(groupId), detail);
    }
  } catch {
    // Seed alone still avoids a blank Group Detail mount.
  }

  navigate(`/new-requests/group/${encodeURIComponent(groupId)}`, {
    replace: true,
    state: {
      seedFromList: seedFromRequest(match, detail),
      arrivalFromRequestId: arrival ? match.id : null,
    },
  });
  return true;
}

export default function RequestDetail() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const { selectedPartnerId } = usePartners();
  const { toast, showToast, dismissToast } = useToast();

  const [request, setRequest] = useState(null);
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const adminDisplayName = profile?.full_name?.trim() || 'Power Music Admin';
  const requestsCacheKey = selectedPartnerId ? `${REQUESTS_PAGE_CACHE_KEY}:${selectedPartnerId}` : REQUESTS_PAGE_CACHE_KEY;
  const directoryCacheKey = selectedPartnerId ? `directory_persons:${selectedPartnerId}` : 'directory_persons';
  const backTo = safeNewRequestsBackPath(location.state?.from);

  const liveReadyRef = useRef(false);
  const promoteInFlightRef = useRef(false);
  const requestRef = useRef(null);
  requestRef.current = request;

  const goBack = useCallback(() => {
    navigate(backTo);
  }, [navigate, backTo]);

  const applyMatch = useCallback(async (match, { allowPromote = true, arrival = false } = {}) => {
    if (!match || match.id !== requestId) {
      setRequest(null);
      setNotFound(true);
      setLoading(false);
      return;
    }

    if (match.status && match.status !== 'new') {
      setRequest(null);
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Solo request was grouped (2nd+ duplicate arrived) — jump to group UI with warm seed.
    if (allowPromote && match.duplicateGroupId) {
      if (promoteInFlightRef.current) return;
      promoteInFlightRef.current = true;
      try {
        await promoteToGroupDetail(match, navigate, { arrival });
      } finally {
        promoteInFlightRef.current = false;
      }
      return;
    }

    setRequest(match);
    setNotFound(false);
    setLoading(false);
    markRequestViewed(match.id);
  }, [requestId, navigate]);

  const refreshRequest = useCallback(async ({ silent = false } = {}) => {
    if (!requestId) return;
    try {
      const match = await getAdminRequest(requestId);
      // Live refresh only runs once the solo request is on screen — a group now means a new arrival.
      await applyMatch(match, { arrival: true });
    } catch (err) {
      if (silent && requestRef.current) return;
      console.error(err);
      setRequest(null);
      setNotFound(true);
      setLoading(false);
    }
  }, [requestId, applyMatch]);

  useEffect(() => {
    let cancelled = false;
    liveReadyRef.current = false;
    promoteInFlightRef.current = false;
    setLoading(true);
    setNotFound(false);

    const seed = location.state?.seedRequest;
    if (seed?.id && seed.id === requestId && seed.status === 'new' && !seed.duplicateGroupId) {
      setRequest(seed);
      setNotFound(false);
      setLoading(false);
      markRequestViewed(seed.id);
    }

    loadWithCache(requestsCacheKey, () => getNewRequestsPage(selectedPartnerId || ''), (data) => {
      if (cancelled) return;
      const persons = Array.isArray(data?.persons) ? data.persons : [];
      setDirectory(persons);
    }).catch(() => {});

    getAdminRequest(requestId)
      .then(async (match) => {
        if (cancelled) return;
        await applyMatch(match);
        if (!cancelled) liveReadyRef.current = true;
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setRequest(null);
        setNotFound(true);
        setLoading(false);
        liveReadyRef.current = true;
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, requestsCacheKey, selectedPartnerId, navigate, applyMatch]);

  // Live: when a 2nd duplicate lands, promote to Group Detail as fast as 3+ arrivals.
  useEffect(() => {
    if (!requestId) return undefined;
    const refreshIfVisible = () => {
      if (document.hidden || !liveReadyRef.current || promoteInFlightRef.current) return;
      // Only watch while still on the solo detail page (no group yet).
      if (requestRef.current?.duplicateGroupId) return;
      void refreshRequest({ silent: true });
    };
    window.addEventListener('focus', refreshIfVisible);
    const onVisibility = () => {
      if (!document.hidden) refreshIfVisible();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const poll = window.setInterval(refreshIfVisible, REQUEST_DETAIL_POLL_MS);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(poll);
    };
  }, [requestId, refreshRequest]);

  useRealtimeBroadcast('requests-changed', () => {
    if (!liveReadyRef.current || document.hidden || promoteInFlightRef.current) return;
    if (requestRef.current?.duplicateGroupId) return;
    void refreshRequest({ silent: true });
  }, { enabled: Boolean(requestId) });

  const completeRequest = async (req, adminNote = '') => {
    const personName = formatPersonName(req.person);
    const outcome = req.action === 'Add' ? 'Added' : 'Removed';
    const handledAt = new Date().toISOString();
    const handledId = req.id;

    setConfirmAction(null);
    removeRequestHighlight(handledId);

    const cached = await new Promise((resolve) => {
      loadWithCache(requestsCacheKey, () => getNewRequestsPage(selectedPartnerId || ''), (data) => resolve(data)).catch(() => resolve(null));
    });

    const currentRequests = Array.isArray(cached?.requests) ? cached.requests : [];
    const currentDirectory = Array.isArray(cached?.persons) ? cached.persons : directory;

    const nextRequests = currentRequests.filter((r) => r.id !== handledId);
    const existingPerson = currentDirectory.find((p) => p.id === handledId || p.sourceRequestId === handledId);
    const directoryPersonPayload = {
      id: existingPerson?.id || `temp-${handledId}`,
      displayId: existingPerson?.displayId || req.displayId,
      sourceRequestId: handledId,
      sourceRequestNumber: existingPerson?.sourceRequestNumber || req.displayId,
      firstName: req.person.firstName,
      lastName: req.person.lastName,
      email: req.person.email,
      location: req.person.location,
      role: req.person.role || req.role,
      directorFirst: req.person.directorFirst || req.directorFirst,
      directorLast: req.person.directorLast || req.directorLast,
      status: outcome,
      dateAdded: handledAt,
      requestReceivedAt: req.receivedAt,
      addedBy: req.createdBy || getManagerDisplayName(req.submittedBy, req.tags),
      managerName: req.createdBy || getManagerDisplayName(req.submittedBy, req.tags),
      handledBy: adminDisplayName,
      managerEmail: req.submittedBy?.email || '',
      club: req.submittedBy?.club || '',
      managerNotes: req.notes || '',
      adminNotes: adminNote || '',
      notes: req.notes || '',
      partnerId: req.partnerId || existingPerson?.partnerId || null,
    };
    const nextDirectory = outcome === 'Removed'
      ? currentDirectory.filter((p) => p.id !== handledId && p.sourceRequestId !== handledId)
      : existingPerson
        ? currentDirectory.map((p) =>
            (p.id === handledId || p.sourceRequestId === handledId)
              ? { ...p, ...directoryPersonPayload, id: p.id }
              : p,
          )
        : [directoryPersonPayload, ...currentDirectory];

    try {
      await fetchJson(`/api/admin/requests/${handledId}/mark-handled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNote: adminNote || null }),
      });

      suppressNewRequests({ requestIds: [handledId], hard: true });
      removeRequestsFromCache(requestsCacheKey, { requestIds: [handledId] });
      patchCache(requestsCacheKey, { requests: nextRequests, persons: nextDirectory });
      bumpCacheEpoch(requestsCacheKey);
      writeCache(directoryCacheKey, nextDirectory);
      // Active Directory only — archive/Removed must not bump the Directory badge.
      if (outcome === 'Added' && req.person?.email) {
        markDirectoryPersonHighlight(req.person.email);
      }
      sessionStorage.setItem('pm_directory_pending_tab', outcome === 'Added' ? 'Added' : 'Removed');

      refreshCache(directoryCacheKey, () => fetchJson(`/api/persons${selectedPartnerId ? `?partner_id=${encodeURIComponent(selectedPartnerId)}` : ''}`)).catch(() => {});

      showToast(
        outcome === 'Removed'
          ? `${personName} marked as Removed. They are now moved to archive in Directory.`
          : `${personName} marked as ${outcome}. They are now in the Directory.`,
        'success',
      );
      navigate('/new-requests');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to save request.', 'error');
    }
  };

  if (loading) {
    return (
      <AdminPageScroll contentClassName="flex min-h-full items-center justify-center text-sm text-[var(--color-text-secondary)]">
        Loading request…
      </AdminPageScroll>
    );
  }

  if (notFound || !request) {
    return (
      <AdminPageScroll contentClassName="flex min-h-full items-center justify-center">
        <div className="mx-auto flex max-w-lg flex-col items-center gap-4 text-center">
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Request not found</h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              This request may already have been handled, or the link is no longer valid.
            </p>
          </div>
          <button
            type="button"
            onClick={goBack}
            className="rounded-lg bg-[var(--color-brand-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Back to new requests
          </button>
        </div>
      </AdminPageScroll>
    );
  }

  return (
    <AdminPageScroll dataPage="request-detail" contentClassName="min-w-0 pb-2">
      <RequestDetailView
        request={request}
        directory={directory}
        onConfirmAction={(req, adminNote) => setConfirmAction({ request: req, adminNote: adminNote || '' })}
      />

      <Modal
        isOpen={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title="Confirm action"
        confirm
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              className="rounded-lg border border-[var(--color-border-default)] px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => completeRequest(confirmAction.request, confirmAction.adminNote)}
              className="rounded-lg bg-[var(--color-brand-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              Confirm
            </button>
          </>
        }
      >
        {confirmAction ? (
          <p>
            Confirm you have {confirmAction.request.action === 'Add' ? 'added' : 'removed'}{' '}
            <strong>
              {formatPersonName(confirmAction.request.person)}
            </strong>{' '}
            in Power Music before continuing. This cannot be undone.
            {confirmAction.adminNote ? (
              <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                Admin note: {confirmAction.adminNote}
              </span>
            ) : null}
          </p>
        ) : null}
      </Modal>

      <Toast toast={toast} onDismiss={dismissToast} />
    </AdminPageScroll>
  );
}
