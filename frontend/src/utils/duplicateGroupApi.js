/**
 * duplicateGroupApi.js
 *
 * Named API helpers for the duplicate group resolution endpoints (Task 2 backend).
 * All calls use the same fetchJson / auth / timeout infrastructure as pilot2Api.js.
 */
import { fetchJson } from './api';

const ADMIN_TIMEOUT_MS = 45000;

async function groupRequest(path, options = {}) {
  return fetchJson(path, {
    headers: { 'Content-Type': 'application/json' },
    timeout: ADMIN_TIMEOUT_MS,
    ...options,
  });
}

/**
 * GET /api/duplicate-groups/{groupId}
 * Returns DuplicateGroupDetailOut: id, classification, status, directoryPersonId,
 * representativeRequestId, members[].
 */
export const fetchGroupDetail = (groupId) =>
  groupRequest(`/api/duplicate-groups/${groupId}`);

/**
 * POST /api/duplicate-groups/{groupId}/resolve-add
 * Case A — no existing Directory match. Creates a new Directory row.
 */
export const resolveGroupAdd = (groupId, { finalValues, adminNote, sourceRequestId }) =>
  groupRequest(`/api/duplicate-groups/${groupId}/resolve-add`, {
    method: 'POST',
    body: JSON.stringify({
      finalValues,
      adminNote: adminNote || null,
      sourceRequestId: sourceRequestId || null,
    }),
  });

/**
 * POST /api/duplicate-groups/{groupId}/resolve-add-as-new
 * Directory match is a false positive — leave Directory unchanged, add as new person.
 */
export const resolveGroupAddAsNew = (groupId, { finalValues, adminNote, sourceRequestId }) =>
  groupRequest(`/api/duplicate-groups/${groupId}/resolve-add-as-new`, {
    method: 'POST',
    body: JSON.stringify({
      finalValues,
      adminNote: adminNote || null,
      sourceRequestId: sourceRequestId || null,
    }),
  });

/**
 * POST /api/duplicate-groups/{groupId}/resolve-keep-existing-and-archive
 * Remove false positive vs Directory — leave Directory unchanged, archive Remove request.
 */
export const resolveGroupKeepExistingAndArchive = (groupId, { finalValues, adminNote, sourceRequestId }) =>
  groupRequest(`/api/duplicate-groups/${groupId}/resolve-keep-existing-and-archive`, {
    method: 'POST',
    body: JSON.stringify({
      finalValues,
      adminNote: adminNote || null,
      sourceRequestId: sourceRequestId || null,
    }),
  });

/**
 * POST /api/duplicate-groups/{groupId}/resolve-update/preview
 * Dry-run — returns field-by-field diff without writing anything.
 */
export const resolveGroupUpdatePreview = (groupId, { directoryPersonId, finalValues }) =>
  groupRequest(`/api/duplicate-groups/${groupId}/resolve-update/preview`, {
    method: 'POST',
    body: JSON.stringify({ directoryPersonId, finalValues }),
  });

/**
 * POST /api/duplicate-groups/{groupId}/resolve-update
 * Case B — updates existing Directory record in-place.
 */
export const resolveGroupUpdate = (groupId, { directoryPersonId, finalValues, adminNote, sourceRequestId }) =>
  groupRequest(`/api/duplicate-groups/${groupId}/resolve-update`, {
    method: 'POST',
    body: JSON.stringify({
      directoryPersonId,
      finalValues,
      adminNote: adminNote || null,
      sourceRequestId: sourceRequestId || null,
    }),
  });

/**
 * POST /api/duplicate-groups/{groupId}/resolve-keep-existing
 * Case C — discards incoming requests without touching the Directory.
 */
export const resolveGroupKeepExisting = (groupId, { adminNote } = {}) =>
  groupRequest(`/api/duplicate-groups/${groupId}/resolve-keep-existing`, {
    method: 'POST',
    body: JSON.stringify({ adminNote: adminNote || null }),
  });

/**
 * POST /api/duplicate-groups/{groupId}/unlink
 * Removes requestId2 from the group. requestId1 (the representative) stays.
 * Persists the dismissed pair so the grouping engine never re-pairs them.
 */
export const unlinkGroupMember = (groupId, { requestId1, requestId2, strictSingle = false }) =>
  groupRequest(`/api/duplicate-groups/${groupId}/unlink`, {
    method: 'POST',
    body: JSON.stringify({ requestId1, requestId2, strictSingle: Boolean(strictSingle) }),
  });

/**
 * POST /api/duplicate-groups/{groupId}/reattach-lookalike
 * Move this group's sole open request onto a separated lookalike (Not the same person).
 * Requires peer history already merged to one request.
 */
export const reattachGroupLookalike = (groupId, { targetRequestId }) =>
  groupRequest(`/api/duplicate-groups/${groupId}/reattach-lookalike`, {
    method: 'POST',
    body: JSON.stringify({ targetRequestId }),
  });

/**
 * POST /api/duplicate-groups/{groupId}/merge-peers
 * Collapse Request History to one open request. Group stays active; Directory unchanged.
 */
export const mergeGroupPeers = (groupId, { finalValues, sourceRequestId }) =>
  groupRequest(`/api/duplicate-groups/${groupId}/merge-peers`, {
    method: 'POST',
    body: JSON.stringify({
      finalValues,
      sourceRequestId: sourceRequestId || null,
    }),
  });

/**
 * POST /api/duplicate-groups/{groupId}/resolve-delete-directory
 * Case D — Remove request with existing Directory match. Permanently deletes Directory record.
 */
export const resolveGroupDeleteFromDirectory = (groupId, { directoryPersonId, finalValues, adminNote }) =>
  groupRequest(`/api/duplicate-groups/${groupId}/resolve-delete-directory`, {
    method: 'POST',
    body: JSON.stringify({
      directoryPersonId,
      finalValues,
      adminNote: adminNote || null,
    }),
  });

/**
 * POST /api/duplicate-groups/{groupId}/resolve-mark-removed
 * Case E — Remove request without existing Directory match.
 */
export const resolveGroupMarkRemoved = (groupId, { finalValues, adminNote }) =>
  groupRequest(`/api/duplicate-groups/${groupId}/resolve-mark-removed`, {
    method: 'POST',
    body: JSON.stringify({
      finalValues,
      adminNote: adminNote || null,
    }),
  });
