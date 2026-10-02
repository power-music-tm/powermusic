import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminPageScroll, Toast, useToast } from '../components/ui';
import GroupResolutionView from '../components/GroupResolutionView';
import { usePartners } from '../context/PartnerContext';
import { fetchJson } from '../utils/api';
import {
  getNewRequestsPage,
  loadWithCache,
  bumpCacheEpoch,
  refreshCache,
  REQUESTS_PAGE_CACHE_KEY,
} from '../utils/pilot2Api';
import { fetchGroupDetail } from '../utils/duplicateGroupApi';

export default function GroupDetail() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { selectedPartnerId } = usePartners();
  const { showToast } = useToast();

  const [group, setGroup] = useState(null);
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const requestsCacheKey = selectedPartnerId
    ? `${REQUESTS_PAGE_CACHE_KEY}:${selectedPartnerId}`
    : REQUESTS_PAGE_CACHE_KEY;
  const directoryCacheKey = selectedPartnerId
    ? `directory_persons:${selectedPartnerId}`
    : 'directory_persons';

  const goBack = useCallback(() => navigate('/new-requests'), [navigate]);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);

    // Load directory from requests page cache
    loadWithCache(
      requestsCacheKey,
      () => getNewRequestsPage(selectedPartnerId || ''),
      (data) => {
        if (Array.isArray(data?.persons)) setDirectory(data.persons);
      },
    ).catch(() => {});

    // Fetch group detail (members, directoryPersonId, classification)
    fetchGroupDetail(groupId)
      .then((data) => {
        if (!data || data.status === 'resolved' || data.status === 'dismissed') {
          setNotFound(true);
        } else {
          setGroup(data);
        }
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [groupId, requestsCacheKey, selectedPartnerId]);

  /** Called by GroupResolutionView when any resolve or unlink action completes. */
  const handleResolved = useCallback(
    async (type, name) => {
      if (type === 'error') {
        showToast(name || 'Something went wrong. Please try again.', 'error');
        return;
      }

      // Bust the requests page cache so the list reflects the resolved group
      bumpCacheEpoch(requestsCacheKey);

      let toastMsg = '';
      switch (type) {
        case 'add':
          toastMsg = 'Merged and added to Directory.';
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
      if (type === 'unlinked' || type === 'unlinked_handled' || type === 'member_deleted') {
        return;
      }

      // Refresh directory cache in the background for Directory page consistency
      if (type === 'add' || type === 'update') {
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

      navigate('/new-requests');
    },
    [navigate, requestsCacheKey, directoryCacheKey, selectedPartnerId, showToast],
  );

  /* ── loading state ── */
  if (loading) {
    return (
      <AdminPageScroll contentClassName="flex min-h-full items-center justify-center text-sm text-[var(--color-text-secondary)] select-none">
        Loading group…
      </AdminPageScroll>
    );
  }

  /* ── not found / already resolved ── */
  if (notFound || !group) {
    return (
      <AdminPageScroll contentClassName="flex min-h-full items-center justify-center select-none">
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
    <AdminPageScroll dataPage="group-detail" contentClassName="min-w-0 select-none pb-2">
      <Toast />
      <GroupResolutionView
        group={group}
        directory={directory}
        onResolved={handleResolved}
      />
    </AdminPageScroll>
  );
}
