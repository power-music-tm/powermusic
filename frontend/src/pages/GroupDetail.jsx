import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AdminPageScroll, Toast, useToast } from '../components/ui';
import GroupResolutionView from '../components/GroupResolutionView';
import { usePartners } from '../context/PartnerContext';
import { useRealtimeBroadcast } from '../hooks/useRealtimeBroadcast';
import { fetchJson } from '../utils/api';
import {
  bumpCacheEpoch,
  refreshCache,
  clearCache,
  writeCache,
  readCache,
  suppressNewRequests,
  clearNewRequestsSuppressions,
  hardSuppressedRequestIds,
  removeRequestsFromCache,
  detachRequestFromGroupInCache,
  REQUESTS_PAGE_CACHE_KEY,
} from '../utils/pilot2Api';
import { fetchGroupDetail } from '../utils/duplicateGroupApi';
import { markRequestsViewed } from '../utils/adminUiHighlights';
import {
  applyListSeed,
  groupDetailCacheKey,
  patchRequestsCacheAfterReattach,
  readCachedGroup,
} from '../utils/groupDetailCache';
import {
  scheduleRequestsPageRefetch,
  subscribeRequestsPage,
} from '../utils/requestsPageStore';

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

function arrivalMessage(groupData, addedMembers) {
  const members = Array.isArray(groupData?.members) ? groupData.members : [];
  const label = addedMembers.length === 1
    ? personLabel(addedMembers[0])
    : `${addedMembers.length} new requests`;
  const representative = members.find((m) => m.isRepresentative);
  const hero = [
    groupData?.directoryPerson?.firstName || groupData?.directoryPerson?.person?.firstName,
    groupData?.directoryPerson?.lastName || groupData?.directoryPerson?.person?.lastName,
  ].filter(Boolean).join(' ').trim()
    || [
      representative?.person?.firstName,
      representative?.person?.lastName,
    ].filter(Boolean).join(' ').trim()
    || 'this group';

  return addedMembers.length === 1
    ? `New request for ${hero}: ${label} joined this group.`
    : `New requests for ${hero}: ${label} joined this group.`;
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
  const groupRef = useRef(group);
  groupRef.current = group;
  const droppedMemberIdsRef = useRef(
    Array.isArray(group?.droppedMemberIds) ? group.droppedMemberIds : [],
  );

  const goBack = useCallback(() => navigate('/new-requests'), [navigate]);

  // Set when Request Detail hands off because a 2nd duplicate arrived while it was open.
  const handoffArrivalFromRef = useRef(null);
  const handoffArrivalKeyRef = useRef(null);
  const alertGroupIdRef = useRef(null);

  const showArrivalAlert = useCallback((groupData, addedMembers) => {
    if (!addedMembers.length) return;
    const message = arrivalMessage(groupData, addedMembers);
    setArrivalAlert({ message, count: addedMembers.length, at: Date.now() });
    showToastRef.current(message, 'warning');
  }, []);

  /** Alert for members other than the request the admin was viewing (once data has them). */
  const consumeHandoffArrival = useCallback((groupData) => {
    const fromId = handoffArrivalFromRef.current;
    if (!fromId) return false;
    const arrived = (Array.isArray(groupData?.members) ? groupData.members : [])
      .filter((m) => m?.id && m.id !== fromId);
    if (!arrived.length) return false;
    handoffArrivalFromRef.current = null;
    showArrivalAlert(groupData, arrived);
    return true;
  }, [showArrivalAlert]);

  const applyGroupDetail = useCallback((data, { alertNewMembers = false, quietDissolved = false } = {}) => {
    if (!data || data.status === 'resolved' || data.status === 'dismissed') {
      // After Delete, caller navigates away — keep current paint (avoid !group
      // flashing "Group not found" before replace navigation).
      if (!quietDissolved) {
        setNotFound(true);
        setGroup(null);
      }
      return { dissolved: true };
    }

    // refreshCache writes the API payload first and would wipe merge tombstones —
    // restore them from the in-memory group / prior cache so list warmers stay blocked.
    const prevCached = readCachedGroup(data.id || groupId);
    const prevIds = memberIdsRef.current;
    const rawApiIds = memberIdsFromGroup(data);
    const shrinkDropped = [...prevIds].filter((id) => id && !rawApiIds.includes(id));
    const cachedIds = memberIdsFromGroup(prevCached);
    const cachedShrinkDropped = cachedIds.filter((id) => id && !rawApiIds.includes(id));
    const droppedMemberIds = Array.from(new Set([
      ...(droppedMemberIdsRef.current || []),
      ...(Array.isArray(groupRef.current?.droppedMemberIds) ? groupRef.current.droppedMemberIds : []),
      ...(Array.isArray(prevCached?.droppedMemberIds) ? prevCached.droppedMemberIds : []),
      ...(Array.isArray(data.droppedMemberIds) ? data.droppedMemberIds : []),
      ...shrinkDropped,
      ...cachedShrinkDropped,
    ].filter(Boolean)));
    droppedMemberIdsRef.current = droppedMemberIds;

    // Drop merged-away / deleted peers that a stale in-flight poll may still return.
    const droppedSet = new Set([...droppedMemberIds, ...hardSuppressedRequestIds()]);
    const liveMembers = (Array.isArray(data.members) ? data.members : [])
      .filter((m) => m?.id && !droppedSet.has(m.id));
    const filtered = {
      ...data,
      members: liveMembers,
      droppedMemberIds,
    };
    writeCache(groupDetailCacheKey(filtered.id || groupId), filtered);

    const nextIds = memberIdsFromGroup(filtered);

    // Active members must stay list-visible. Clear stale request-id tombstones
    // (e.g. a prior attach that wrongly suppressed survivors).
    if (nextIds.length) {
      clearNewRequestsSuppressions({ requestIds: nextIds, includeHard: false });
    }

    // Only treat as arrivals when we already had a baseline — empty→full after
    // remount/seed is not a new request joining.
    const added = nextIds.filter((id) => !prevIds.has(id) && !droppedSet.has(id));

    setGroup(filtered);
    setNotFound(false);
    memberIdsRef.current = new Set(nextIds);

    if (consumeHandoffArrival(filtered)) return { dissolved: false };

    if (
      alertNewMembers
      && liveReadyRef.current
      && prevIds.size > 0
      && added.length > 0
    ) {
      showArrivalAlert(filtered, liveMembers.filter((m) => added.includes(m.id)));
    }
    return { dissolved: false };
  }, [groupId, consumeHandoffArrival, showArrivalAlert]);

  const refreshGroupDetail = useCallback(({ alertNewMembers = true, bustCache = false, quietDissolved = false } = {}) => {
    if (!groupId) return Promise.resolve(null);
    // Allow post-merge / post-attach busts to preempt a poll that would otherwise
    // apply a stale multi-member payload after Request History Merge.
    if (refreshInFlightRef.current && !bustCache) return Promise.resolve(null);
    refreshInFlightRef.current = true;
    // Do NOT bump epoch on live polls — that races in-flight GETs and drops apply().
    if (bustCache) bumpCacheEpoch(groupCacheKey);
    return refreshCache(
      groupCacheKey,
      () => fetchGroupDetail(groupId),
      (data) => {
        applyGroupDetail(data, { alertNewMembers, quietDissolved });
        liveReadyRef.current = true;
        setLoading(false);
      },
    )
      .catch(() => null)
      .finally(() => {
        refreshInFlightRef.current = false;
      });
  }, [applyGroupDetail, groupCacheKey, groupId]);

  // Viewing the group opens every member — keeps the sidebar badge from
  // re-counting the group when its representative changes.
  const viewedMemberKey = memberIdsFromGroup(group).join(',');
  useEffect(() => {
    if (viewedMemberKey) markRequestsViewed(viewedMemberKey.split(','));
  }, [viewedMemberKey]);

  // Directory is optional context — paint from the shared list cache; only
  // schedule a soft refetch when that cache is empty (avoid a full /page GET
  // on every Back → reopen of the same group).
  useEffect(() => {
    const partnerId = selectedPartnerId || '';
    const cached = readCache(requestsCacheKey);
    if (Array.isArray(cached?.persons)) setDirectory(cached.persons);
    const unsub = subscribeRequestsPage(({ partnerId: pubPartnerId, data }) => {
      if (String(pubPartnerId || '') !== String(partnerId)) return;
      if (Array.isArray(data?.persons)) setDirectory(data.persons);
    });
    if (!Array.isArray(cached?.persons) || cached.persons.length === 0) {
      scheduleRequestsPageRefetch(partnerId, { minAgeMs: 15_000 });
    }
    return unsub;
  }, [requestsCacheKey, selectedPartnerId]);

  // Paint list seed + cache instantly, then network-refresh for full history.
  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    if (alertGroupIdRef.current !== groupId) {
      alertGroupIdRef.current = groupId;
      setArrivalAlert(null);
    }
    liveReadyRef.current = false;
    refreshInFlightRef.current = false;

    const cached = readCachedGroup(groupId);
    const seeded = applyListSeed(groupId, cached, listSeed);
    // Prefer the post-merge detail cache when list seed would re-expand history.
    const paint = (
      cached
      && Array.isArray(cached.members)
      && seeded
      && Array.isArray(seeded.members)
      && cached.members.length > 0
      && cached.members.length < seeded.members.length
    ) ? cached : seeded;
    memberIdsRef.current = new Set(memberIdsFromGroup(paint));
    const handoffFromId = location.state?.arrivalFromRequestId || null;
    handoffArrivalFromRef.current = null;
    if (handoffFromId && handoffArrivalKeyRef.current !== location.key) {
      handoffArrivalKeyRef.current = location.key;
      handoffArrivalFromRef.current = handoffFromId;
      // One-shot: a reload or Back/Forward to this entry must not re-alert.
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: { ...location.state, arrivalFromRequestId: null },
      });
    }
    if (paint) {
      setGroup(paint);
      setLoading(false);
      writeCache(groupCacheKey, paint);
      consumeHandoffArrival(paint);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, groupCacheKey, listSeed?.id, applyGroupDetail, consumeHandoffArrival]);

  // Live updates: Realtime nudge + visible-tab poll + focus/visible refetch.
  useEffect(() => {
    if (!groupId) return undefined;
    const refreshIfVisible = () => {
      if (document.hidden || !liveReadyRef.current) return;
      refreshGroupDetail({ alertNewMembers: true });
    };
    window.addEventListener('focus', refreshIfVisible);
    const onVisibility = () => {
      if (!document.hidden) refreshIfVisible();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const poll = window.setInterval(refreshIfVisible, GROUP_DETAIL_POLL_MS);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(poll);
    };
  }, [groupId, refreshGroupDetail]);

  useRealtimeBroadcast('requests-changed', () => {
    if (!liveReadyRef.current || document.hidden) return;
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

      // If resolving/removing the group entirely, suppress group and member IDs.
      // reattached is handled separately — the survivor request must stay visible
      // under its new group (tombstoning its requestId hid the whole group row).
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

      if (type === 'reattached') {
        // Never tombstone destination request IDs — that hid the whole destination row.
        // When peers remain, only the moved current request leaves the source group.
        const payload = name && typeof name === 'object' ? name : null;
        const newGroupId = payload?.newGroupId || null;
        const movedSourceId = payload?.sourceRequestId || null;
        const previousDismissed = Boolean(payload?.previousGroupDismissed);
        const movedIds = [movedSourceId, payload?.targetRequestId].filter(Boolean);
        if (previousDismissed) {
          removeRequestsFromCache(requestsCacheKey, {
            groupIds: [groupId],
            requestIds: movedIds,
          });
          clearCache(groupCacheKey);
          suppressNewRequests({ groupIds: [groupId], requestIds: movedIds });
        } else if (movedSourceId) {
          const remainingMembers = (groupMemberIds || [])
            .filter((id) => id && id !== movedSourceId)
            .map((id) => (group?.members || []).find((m) => m.id === id))
            .filter(Boolean);
          detachRequestFromGroupInCache(requestsCacheKey, {
            requestId: movedSourceId,
            groupId,
            remainingMembers,
          });
          // Keep a warm source-group detail cache so reopen does not paint
          // empty person stubs while the list seed catches up.
          if (remainingMembers.length > 0 && group) {
            const nextRep =
              remainingMembers.find((m) => m.isRepresentative)
              || remainingMembers[0];
            writeCache(groupCacheKey, {
              ...group,
              members: remainingMembers,
              representativeRequestId: nextRep?.id || group.representativeRequestId,
              droppedMemberIds: Array.from(new Set([
                ...(Array.isArray(group.droppedMemberIds) ? group.droppedMemberIds : []),
                movedSourceId,
              ].filter(Boolean))),
              separatedLookalikeRequests: [],
            });
          } else {
            clearCache(groupCacheKey);
          }
        }
        clearNewRequestsSuppressions({
          requestIds: movedIds,
          groupIds: [groupId, newGroupId].filter(Boolean),
          includeHard: false,
        });
        if (payload?.detail) {
          patchRequestsCacheAfterReattach(requestsCacheKey, {
            previousGroupId: previousDismissed ? groupId : null,
            newGroupId,
            detail: payload.detail,
            sourceRequestId: payload.sourceRequestId,
            targetRequestId: payload.targetRequestId,
          });
          writeCache(groupDetailCacheKey(newGroupId), {
            ...payload.detail,
            droppedMemberIds: [],
          });
        }
      }

      // Bust in-flight list GETs so they cannot overwrite optimistic patches.
      // unlinked_new_requests bumps *after* its cache split (see below).
      if (type !== 'unlinked_new_requests') {
        bumpCacheEpoch(requestsCacheKey);
      }

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
          toastMsg = 'Request separated. Opening New Requests…';
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
        case 'member_deleted_done': {
          const deletedLabel = typeof name === 'object' && name
            ? (name.name || null)
            : name;
          toastMsg = deletedLabel
            ? `Deleted request for ${deletedLabel}.`
            : 'Request deleted.';
          break;
        }
        case 'peers_merged':
          toastMsg = 'Combined into one request. Choose Keep Existing or continue on the current request.';
          if (name && typeof name === 'object' && Array.isArray(name.members)) {
            droppedMemberIdsRef.current = Array.isArray(name.droppedMemberIds)
              ? name.droppedMemberIds
              : [];
            setGroup(name);
            memberIdsRef.current = new Set(memberIdsFromGroup(name));
            writeCache(groupCacheKey, name);
          }
          break;
        case 'unlinked_dissolved':
          toastMsg = 'Group dissolved successfully.';
          break;
        case 'reattached': {
          const payload = name && typeof name === 'object' ? name : null;
          toastMsg = payload?.previousGroupDismissed === false
            ? 'Transferred to the similar request. Other requests stay in the previous group.'
            : 'Transferred to the similar request. Find it on New Requests.';
          break;
        }
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
        || type === 'peers_merged'
      ) {
        // Member set changed — refresh so live baseline matches this visit.
        // After a merge the baseline is survivor + known late arrivals, so any
        // other member is a request that landed while the merge was saving.
        refreshGroupDetail({ alertNewMembers: type === 'peers_merged', bustCache: true });
        return;
      }

      // Partial delete: refresh in place. If the group was dissolved (cascade or
      // last peer), leave — never flash "Group not found" on this URL.
      if (type === 'member_deleted') {
        refreshGroupDetail({
          alertNewMembers: false,
          bustCache: true,
          quietDissolved: true,
        }).then((fresh) => {
          if (!fresh || fresh.status === 'resolved' || fresh.status === 'dismissed') {
            clearCache(groupCacheKey);
            navigate('/new-requests', { replace: true });
          }
        });
        return;
      }

      // Group finished after delete: open the surviving request, or the list.
      if (type === 'member_deleted_done') {
        const payload = typeof name === 'object' && name ? name : {};
        const survivorId = payload.survivorId || null;
        const survivor = payload.survivor || null;
        clearCache(groupCacheKey);
        if (survivorId) {
          navigate(`/new-requests/${encodeURIComponent(survivorId)}`, {
            replace: true,
            state: {
              seedRequest: survivor
                ? { ...survivor, duplicateGroupId: null }
                : { id: survivorId, status: 'new' },
              from: '/new-requests',
            },
          });
        } else {
          navigate('/new-requests', { replace: true });
        }
        return;
      }

      if (type === 'reattached') {
        // Leave the dissolved source group immediately. Opening the destination
        // group URL races dismissed→active transitions and flashes "Group not found".
        // List cache already has the combined row — admin opens it from New Requests.
        navigate('/new-requests', { replace: true });
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
        // Keep the New Requests list cache so the page does not flash empty while
        // the (often slow) /api/admin/requests/page refetch runs. Split the
        // unlinked member out of the group shell for correct click-through.
        const payload = name && typeof name === 'object' ? name : null;
        const unlinkedRequestId = payload?.requestId || null;
        detachRequestFromGroupInCache(requestsCacheKey, {
          requestId: unlinkedRequestId,
          groupId,
          member: payload?.member || null,
          remainingMembers: Array.isArray(payload?.remainingMembers)
            ? payload.remainingMembers
            : null,
        });
        // Invalidate in-flight list GETs *after* the optimistic patch so they
        // cannot overwrite with pre-unlink data.
        bumpCacheEpoch(requestsCacheKey);
        clearCache(groupCacheKey);
        clearNewRequestsSuppressions({
          requestIds: [unlinkedRequestId].filter(Boolean),
          groupIds: [groupId],
          includeHard: false,
        });
        navigate('/new-requests', { replace: true });
        return;
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
