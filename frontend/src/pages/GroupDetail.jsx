import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AdminPageScroll, Toast, useToast } from '../components/ui';
import GroupResolutionView from '../components/GroupResolutionView';
import { usePartners } from '../context/PartnerContext';
import { useRealtimeBroadcast } from '../hooks/useRealtimeBroadcast';
import { fetchJson } from '../utils/api';
import {
  getNewRequestsPage,
  loadWithCache,
  bumpCacheEpoch,
  refreshCache,
  clearCache,
  writeCache,
  suppressNewRequests,
  removeRequestsFromCache,
  REQUESTS_PAGE_CACHE_KEY,
} from '../utils/pilot2Api';
import { fetchGroupDetail } from '../utils/duplicateGroupApi';
import {
  applyListSeed,
  groupDetailCacheKey,
  readCachedGroup,
} from '../utils/groupDetailCache';

/** Faster than New Requests list — admins watching a group need arrivals quickly. */
const GROUP_DETAIL_POLL_MS = 4000;

function memberIdsFromGroup(data) {
  return (data?.members || []).map((m) => m.id).filter(Boolean);
}

function personLabel(member) {
  const first = member?.person?.firstName || member?.firstName || '';
  const last = member?.person?.lastName || member?.lastName || '';
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || 'A new request';
}

export default function GroupDetail() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedPartnerId } = usePartners();
  const { showToast } = useToast();
  const listSeed = location.state?.seedFromList || null;

  const [group, setGroup] = useState(() =>
    applyListSeed(groupId, readCachedGroup(groupId), listSeed),
  );
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(
    () => !applyListSeed(groupId, readCachedGroup(groupId), listSeed),
  );
  const [notFound, setNotFound] = useState(false);
  const [arrivalAlert, setArrivalAlert] = useState(null);

  const requestsCacheKey = selectedPartnerId
    ? `${REQUESTS_PAGE_CACHE_KEY}:${selectedPartnerId}`
    : REQUESTS_PAGE_CACHE_KEY;
  const directoryCacheKey = selectedPartnerId
    ? `directory_persons:${selectedPartnerId}`
    : 'directory_persons';
  const groupCacheKey = groupDetailCacheKey(groupId);

  const memberIdsRef = useRef(new Set(memberIdsFromGroup(
    applyListSeed(groupId, readCachedGroup(groupId), listSeed),
  )));
  const liveReadyRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const goBack = useCallback(() => navigate('/new-requests'), [navigate]);

  const applyGroupDetail = useCallback((data, { alertNewMembers = false } = {}) => {
    if (!data || data.status === 'resolved' || data.status === 'dismissed') {
      setNotFound(true);
      setGroup(null);
      return;
    }

    const nextIds = memberIdsFromGroup(data);
    const prevIds = memberIdsRef.current;
    const added = nextIds.filter((id) => !prevIds.has(id));

    setGroup(data);
    setNotFound(false);
    memberIdsRef.current = new Set(nextIds);

    if (alertNewMembers && liveReadyRef.current && added.length > 0) {
      const addedMembers = (data.members || []).filter((m) => added.includes(m.id));
      const label = addedMembers.length === 1
        ? personLabel(addedMembers[0])
        : `${added.length} new requests`;
      const hero = [
        data.directoryPerson?.firstName || data.directoryPerson?.person?.firstName,
        data.directoryPerson?.lastName || data.directoryPerson?.person?.lastName,
      ].filter(Boolean).join(' ').trim()
        || [
          data.members?.find((m) => m.isRepresentative)?.person?.firstName,
          data.members?.find((m) => m.isRepresentative)?.person?.lastName,
        ].filter(Boolean).join(' ').trim()
        || 'this group';

      const message = added.length === 1
        ? `New request for ${hero}: ${label} joined this group.`
        : `New requests for ${hero}: ${label} joined this group.`;

      setArrivalAlert({
        message,
        count: added.length,
        at: Date.now(),
      });
      showToastRef.current(message, 'warning');
    }
  }, []);

  const refreshGroupDetail = useCallback(({ alertNewMembers = true, bustCache = false } = {}) => {
    if (!groupId || refreshInFlightRef.current) return Promise.resolve();
    refreshInFlightRef.current = true;
    // Do NOT bump epoch on live polls — that races in-flight GETs and drops apply().
    if (bustCache) bumpCacheEpoch(groupCacheKey);
    return refreshCache(
      groupCacheKey,
      () => fetchGroupDetail(groupId),
      (data) => {
        applyGroupDetail(data, { alertNewMembers });
        liveReadyRef.current = true;
        setLoading(false);
      },
    )
      .catch(() => {})
      .finally(() => {
        refreshInFlightRef.current = false;
      });
  }, [applyGroupDetail, groupCacheKey, groupId]);

  // Directory is optional context — do not block the group UI on it.
  useEffect(() => {
    loadWithCache(
      requestsCacheKey,
      () => getNewRequestsPage(selectedPartnerId || ''),
      (data) => {
        if (Array.isArray(data?.persons)) setDirectory(data.persons);
      },
    ).catch(() => {});
  }, [requestsCacheKey, selectedPartnerId]);

  // Paint list seed + cache instantly, then network-refresh for full history.
  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    setArrivalAlert(null);
    liveReadyRef.current = false;
    refreshInFlightRef.current = false;

    const seeded = applyListSeed(groupId, readCachedGroup(groupId), listSeed);
    memberIdsRef.current = new Set(memberIdsFromGroup(seeded));
    if (seeded) {
      setGroup(seeded);
      setLoading(false);
      writeCache(groupCacheKey, seeded);
    } else {
      setGroup(null);
      setLoading(true);
    }

    // Single initial network load — no epoch bump so poll cannot invalidate it.
    refreshInFlightRef.current = true;
    refreshCache(
      groupCacheKey,
      () => fetchGroupDetail(groupId),
      (data) => {
        if (cancelled) return;
        applyGroupDetail(data, { alertNewMembers: false });
        liveReadyRef.current = true;
        setLoading(false);
      },
    )
      .catch(() => {
        if (cancelled) return;
        if (!readCachedGroup(groupId) && !listSeed) {
          setNotFound(true);
          setGroup(null);
        }
        liveReadyRef.current = true;
        setLoading(false);
      })
      .finally(() => {
        if (!cancelled) refreshInFlightRef.current = false;
      });

    return () => {
      cancelled = true;
    };
    // Seed by request id only — avoid re-running on new state object identity.
  }, [groupId, groupCacheKey, listSeed?.id, applyGroupDetail]);

  // Live updates while standing on this group — realtime + focus + poll.
  useEffect(() => {
    if (!groupId) return undefined;
    const refresh = () => {
      if (document.hidden || !liveReadyRef.current) return;
      refreshGroupDetail({ alertNewMembers: true });
    };
    window.addEventListener('focus', refresh);
    const poll = window.setInterval(refresh, GROUP_DETAIL_POLL_MS);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(poll);
    };
  }, [groupId, refreshGroupDetail]);

  useRealtimeBroadcast('requests-changed', () => {
    if (!liveReadyRef.current) return;
    refreshGroupDetail({ alertNewMembers: true });
  }, { enabled: Boolean(groupId) });

  /** Called by GroupResolutionView when any resolve or unlink action completes. */
  const handleResolved = useCallback(
    async (type, name) => {
      if (type === 'error') {
        showToast(name || 'Something went wrong. Please try again.', 'error');
        return;
      }

      const groupMemberIds = group?.members?.map((m) => m.id) || [];

      // If resolving/removing the group entirely, suppress group and member IDs
      if (
        type === 'add' ||
        type === 'add_as_new' ||
        type === 'keep_and_archive' ||
        type === 'mark_removed' ||
        type === 'remove_group' ||
        type === 'update' ||
        type === 'keep' ||
        type === 'delete' ||
        type === 'unlinked_dissolved'
      ) {
        suppressNewRequests({ groupIds: [groupId], requestIds: groupMemberIds });
        removeRequestsFromCache(requestsCacheKey, { groupIds: [groupId], requestIds: groupMemberIds });
        clearCache(groupCacheKey);
      }

      // Bust the requests page cache so the list reflects the resolved group
      bumpCacheEpoch(requestsCacheKey);

      let toastMsg = '';
      switch (type) {
        case 'add':
          toastMsg = 'Merged and added to Directory.';
          break;
        case 'add_as_new':
          toastMsg = name
            ? `${name} added as a new Directory person. Existing record left unchanged.`
            : 'Added as a new Directory person. Existing record left unchanged.';
          break;
        case 'keep_and_archive':
          toastMsg = name
            ? `${name} archived. Existing Directory record left unchanged.`
            : 'Remove request archived. Existing Directory record left unchanged.';
          break;
        case 'mark_removed':
          toastMsg = 'Request resolved and person marked as removed.';
          break;
        case 'remove_group':
          toastMsg = 'User marked as removed in Directory.';
          break;
        case 'update':
          toastMsg = 'Directory record updated successfully.';
          break;
        case 'keep':
          toastMsg = group?.members?.length > 1
            ? 'Existing Directory record kept. New requests deleted.'
            : 'Existing Directory record kept. New request deleted.';
          break;
        case 'delete':
          toastMsg = 'Resolved and Directory record permanently deleted.';
          break;
        case 'unlinked':
          toastMsg = 'Request unlinked. It stays here as a current request for this visit.';
          break;
        case 'unlinked_added_directory':
          toastMsg = 'Person added to Directory.';
          break;
        case 'unlinked_removed_directory':
          toastMsg = 'Person marked as removed in Directory.';
          break;
        case 'unlinked_new_requests':
          toastMsg = 'Request moved to New Requests.';
          break;
        case 'unlinked_handled':
          toastMsg = name
            ? `${name} marked as handled.`
            : 'Request marked as handled.';
          break;
        case 'unlinked_handled_done':
          toastMsg = name
            ? `${name} marked as handled.`
            : 'Request marked as handled.';
          break;
        case 'member_deleted':
          toastMsg = name ? `Deleted request for ${name}.` : 'Request deleted.';
          break;
        case 'member_deleted_done':
          toastMsg = name ? `Deleted request for ${name}.` : 'Request deleted.';
          break;
        case 'peers_merged':
          toastMsg = 'Combined into one request. Choose Keep Existing or continue on the current request.';
          break;
        case 'unlinked_dissolved':
          toastMsg = 'Group dissolved successfully.';
          break;
        default:
          toastMsg = 'Group resolved successfully.';
          break;
      }

      showToast(toastMsg, 'success');

      // Stay on this page after unlink / partial handle / partial delete so the
      // admin can keep working here for this visit.
      if (
        type === 'unlinked'
        || type === 'unlinked_handled'
        || type === 'member_deleted'
        || type === 'peers_merged'
      ) {
        // Member set changed — refresh so live baseline matches this visit.
        refreshGroupDetail({ alertNewMembers: false, bustCache: true });
        return;
      }

      // Refresh directory cache in the background for Directory page consistency
      if (type === 'add' || type === 'add_as_new' || type === 'update') {
        refreshCache(
          directoryCacheKey,
          () =>
            fetchJson(
              `/api/persons${selectedPartnerId ? `?partner_id=${encodeURIComponent(selectedPartnerId)}` : ''}`,
            ),
          () => {},
        ).catch(() => {});
        if (type === 'add') {
          sessionStorage.setItem('pm_directory_pending_tab', 'Added');
        }
      }

      if (type === 'unlinked_new_requests') {
        clearCache(requestsCacheKey);
        clearCache(groupCacheKey);
      }

      navigate('/new-requests');
    },
    [groupId, group?.members, navigate, requestsCacheKey, directoryCacheKey, groupCacheKey, selectedPartnerId, showToast, refreshGroupDetail],
  );

  /* ── loading state ── */
  if (loading && !group) {
    return (
      <AdminPageScroll contentClassName="flex min-h-full items-center justify-center text-sm text-[var(--color-text-secondary)]">
        Loading group…
      </AdminPageScroll>
    );
  }

  /* ── not found / already resolved ── */
  if (notFound || !group) {
    return (
      <AdminPageScroll contentClassName="flex min-h-full items-center justify-center">
        <div className="mx-auto flex max-w-lg flex-col items-center gap-4 text-center">
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Group not found
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              This group may already have been resolved, or the link is no longer valid.
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
    <AdminPageScroll dataPage="group-detail" contentClassName="min-w-0 pb-2">
      <Toast />
      {arrivalAlert ? (
        <div
          role="status"
          className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-[var(--color-text-primary)] shadow-[0_1px_0_rgba(26,26,46,0.04)]"
        >
          <div className="min-w-0">
            <p className="font-semibold">New request arrived</p>
            <p className="mt-0.5 text-[var(--color-text-secondary)]">{arrivalAlert.message}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Open Previous Requests to review all {group?.members?.length || 0} matching requests.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setArrivalAlert(null)}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-white cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <GroupResolutionView
        group={group}
        directory={directory}
        onResolved={handleResolved}
      />
    </AdminPageScroll>
  );
}
