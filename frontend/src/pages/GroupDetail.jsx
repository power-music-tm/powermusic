import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AdminPageScroll, Toast, useToast } from '../components/ui';
import GroupResolutionView from '../components/GroupResolutionView';
import { usePartners } from '../context/PartnerContext';
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

  const requestsCacheKey = selectedPartnerId
    ? `${REQUESTS_PAGE_CACHE_KEY}:${selectedPartnerId}`
    : REQUESTS_PAGE_CACHE_KEY;
  const directoryCacheKey = selectedPartnerId
    ? `directory_persons:${selectedPartnerId}`
    : 'directory_persons';
  const groupCacheKey = groupDetailCacheKey(groupId);

  const goBack = useCallback(() => navigate('/new-requests'), [navigate]);

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

    const seeded = applyListSeed(groupId, readCachedGroup(groupId), listSeed);
    if (seeded) {
      setGroup(seeded);
      setLoading(false);
      writeCache(groupCacheKey, seeded);
    } else {
      setGroup(null);
      setLoading(true);
    }

    bumpCacheEpoch(groupCacheKey);
    refreshCache(
      groupCacheKey,
      () => fetchGroupDetail(groupId),
      (data) => {
        if (cancelled) return;
        if (!data || data.status === 'resolved' || data.status === 'dismissed') {
          setNotFound(true);
          setGroup(null);
        } else {
          setGroup(data);
          setNotFound(false);
        }
        setLoading(false);
      },
    ).catch(() => {
      if (cancelled) return;
      if (!readCachedGroup(groupId) && !listSeed) {
        setNotFound(true);
        setGroup(null);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // Seed by request id only — avoid re-running on new state object identity.
  }, [groupId, groupCacheKey, listSeed?.id]);

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
          toastMsg = 'Merged into one request. Choose Keep Existing or Merge and Update Directory.';
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
        // Member set changed — refresh group cache so revisit stays accurate.
        bumpCacheEpoch(groupCacheKey);
        refreshCache(groupCacheKey, () => fetchGroupDetail(groupId), (data) => {
          if (data && data.status !== 'resolved' && data.status !== 'dismissed') {
            setGroup(data);
          }
        }).catch(() => {});
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
    [groupId, group?.members, navigate, requestsCacheKey, directoryCacheKey, groupCacheKey, selectedPartnerId, showToast],
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
      <GroupResolutionView
        group={group}
        directory={directory}
        onResolved={handleResolved}
      />
    </AdminPageScroll>
  );
}
