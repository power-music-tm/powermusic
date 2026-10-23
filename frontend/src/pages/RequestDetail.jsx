import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import RequestDetailView from '../components/RequestDetailDrawer';
import { AdminPageScroll, Modal, Toast, useToast } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { usePartners } from '../context/PartnerContext';
import { fetchJson } from '../utils/api';
import {
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
import { getManagerDisplayName } from '../utils/manualEntry';
import {
  markDirectoryPersonHighlight,
  markRequestViewed,
  removeRequestHighlight,
} from '../utils/adminUiHighlights';
import { formatPersonName } from '../utils/personDisplay';

function safeNewRequestsBackPath(from) {
  if (typeof from !== 'string') return '/new-requests';
  if (!from.startsWith('/new-requests')) return '/new-requests';
  if (from.includes('://') || from.includes('//')) return '/new-requests';
  return from;
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

  const goBack = useCallback(() => {
    navigate(backTo);
  }, [navigate, backTo]);

  const applyPage = useCallback((data) => {
    const requests = Array.isArray(data?.requests) ? data.requests : [];
    const persons = Array.isArray(data?.persons) ? data.persons : [];
    setDirectory(persons);

    const match = requests.find((row) => row.id === requestId) || null;
    if (match) {
      // Guard: if this request belongs to a duplicate group, redirect to the
      // group resolution page so it cannot be mark-handled as a simple request.
      if (match.duplicateGroupId) {
        navigate(
          `/new-requests/group/${encodeURIComponent(match.duplicateGroupId)}`,
          { replace: true },
        );
        return;
      }
      setRequest(match);
      setNotFound(false);
      markRequestViewed(match.id);
    } else {
      setRequest(null);
      setNotFound(true);
    }
    setLoading(false);
  }, [requestId, navigate]);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    loadWithCache(requestsCacheKey, () => getNewRequestsPage(selectedPartnerId || ''), applyPage).catch((err) => {
      console.error(err);
      setLoading(false);
      setNotFound(true);
    });
  }, [applyPage, requestsCacheKey, selectedPartnerId]);

  const completeRequest = async (req, adminNote = '') => {
    const personName = formatPersonName(req.person);
    const outcome = req.action === 'Add' ? 'Added' : 'Removed';
    const handledAt = new Date().toISOString();

    setConfirmAction(null);
    removeRequestHighlight(req.id);

    const cached = await new Promise((resolve) => {
      loadWithCache(requestsCacheKey, () => getNewRequestsPage(selectedPartnerId || ''), (data) => resolve(data)).catch(() => resolve(null));
    });

    const currentRequests = Array.isArray(cached?.requests) ? cached.requests : [];
    const currentDirectory = Array.isArray(cached?.persons) ? cached.persons : directory;

    const nextRequests = currentRequests.filter((r) => r.id !== req.id);
    const existingPerson = currentDirectory.find((p) => p.id === req.id || p.sourceRequestId === req.id);
    const nextDirectory = existingPerson
      ? currentDirectory.map((p) =>
          (p.id === req.id || p.sourceRequestId === req.id)
            ? {
                ...p,
                status: outcome,
                dateAdded: handledAt,
                handledBy: adminDisplayName,
                adminNotes: adminNote || '',
                partnerId: req.partnerId || p.partnerId || null,
              }
            : p,
        )
      : [
          {
            id: `temp-${req.id}`,
            displayId: req.displayId,
            sourceRequestId: req.id,
            sourceRequestNumber: req.displayId,
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
            partnerId: req.partnerId || null,
          },
          ...currentDirectory,
        ];

    try {
      await fetchJson(`/api/admin/requests/${req.id}/mark-handled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNote: adminNote || null }),
      });

      suppressNewRequests({ requestIds: [req.id] });
      removeRequestsFromCache(requestsCacheKey, { requestIds: [req.id] });
      patchCache(requestsCacheKey, { requests: nextRequests, persons: nextDirectory });
      bumpCacheEpoch(requestsCacheKey);
      writeCache(directoryCacheKey, nextDirectory);
      markDirectoryPersonHighlight(req.person.email);
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
