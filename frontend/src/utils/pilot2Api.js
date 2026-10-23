// Pilot 2 API client — same base URL convention as the Pilot 1 pages
// (see utils/api.js: localhost in dev, same-origin in production).
import { fetchJson, authFetch } from './api.js';
import { removePendingRequestIdsFromBadge } from './adminUiHighlights.js';

const ADMIN_TIMEOUT_MS = 45000;

async function request(path, options = {}) {
  return fetchJson(path, {
    headers: { 'Content-Type': 'application/json' },
    timeout: ADMIN_TIMEOUT_MS,
    ...options,
  });
}

function isApiErrorPayload(data) {
  return (
    data != null
    && typeof data === 'object'
    && !Array.isArray(data)
    && typeof data.detail === 'string'
    && Object.keys(data).length === 1
  );
}

function isRateLimitError(err) {
  const msg = err?.message || '';
  return msg.includes('Too many requests') || msg.includes('429');
}

export { isRateLimitError };

function readSessionCache(key) {
  try {
    const cached = sessionStorage.getItem(`pm_cache_${key}`);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (isApiErrorPayload(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Synchronous cache read — never triggers a network GET. */
export function readCache(key) {
  return readSessionCache(key);
}

export const REQUESTS_PAGE_CACHE_KEY = 'requests_page_v3';

const inFlightFreshByKey = new Map();
/** Bumped on local mutations so in-flight GETs cannot overwrite newer cache/UI. */
const cacheEpochByKey = new Map();
const pendingMutationsByKey = new Map();

export function bumpCacheEpoch(key) {
  cacheEpochByKey.set(key, (cacheEpochByKey.get(key) || 0) + 1);
  inFlightFreshByKey.delete(key);
}

function currentCacheEpoch(key) {
  return cacheEpochByKey.get(key) || 0;
}

function hasPendingMutation(key) {
  return (pendingMutationsByKey.get(key) || 0) > 0;
}

/**
 * Open an optimistic-write window for `key`. Until the returned `settle()` runs,
 * no GET result is applied — a GET that started before the server committed
 * would otherwise repaint pre-mutation rows. `settle()` bumps the epoch again so
 * GETs that started inside the window are discarded too; refetch after it.
 */
export function beginCacheMutation(key) {
  pendingMutationsByKey.set(key, (pendingMutationsByKey.get(key) || 0) + 1);
  bumpCacheEpoch(key);
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    const left = (pendingMutationsByKey.get(key) || 1) - 1;
    if (left > 0) pendingMutationsByKey.set(key, left);
    else pendingMutationsByKey.delete(key);
    bumpCacheEpoch(key);
  };
}

async function fetchFreshWithRateLimitRetry(fetcher, cacheKey) {
  if (inFlightFreshByKey.has(cacheKey)) {
    return inFlightFreshByKey.get(cacheKey);
  }

  const startedEpoch = currentCacheEpoch(cacheKey);

  const run = async () => {
    try {
      const data = await fetcher();
      return { data, startedEpoch };
    } catch (err) {
      if (!isRateLimitError(err) || !readSessionCache(cacheKey)) {
        throw err;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const data = await fetcher();
      return { data, startedEpoch };
    }
  };

  const promise = run().finally(() => {
    if (inFlightFreshByKey.get(cacheKey) === promise) {
      inFlightFreshByKey.delete(cacheKey);
    }
  });
  inFlightFreshByKey.set(cacheKey, promise);
  return promise;
}

async function resolveFreshPayload(key, fetcher, { depth = 0 } = {}) {
  const { data, startedEpoch } = await fetchFreshWithRateLimitRetry(fetcher, key);
  // The mutation's settle() path refetches; applying now would undo optimistic UI.
  if (hasPendingMutation(key)) {
    return { data: null, stale: true };
  }
  if (currentCacheEpoch(key) !== startedEpoch) {
    if (depth >= 3) {
      return { data: readSessionCache(key), stale: true };
    }
    return resolveFreshPayload(key, fetcher, { depth: depth + 1 });
  }
  return { data, stale: false };
}

// Stale-while-revalidate: show the last known data instantly from
// sessionStorage, then fetch fresh data and update. `apply(data, isStale)`
// is called up to twice — once with cached data, once with fresh data.
export async function loadWithCache(key, fetcher, apply) {
  const cached = readSessionCache(key);
  if (cached) apply(cached, true);

  try {
    const { data: fresh, stale } = await resolveFreshPayload(key, fetcher);
    if (stale) {
      if (fresh) apply(fresh, true);
      return fresh;
    }
    if (isApiErrorPayload(fresh)) {
      throw new Error(fresh.detail);
    }
    try { sessionStorage.setItem(`pm_cache_${key}`, JSON.stringify(fresh)); } catch { /* quota */ }
    apply(fresh, false);
    return fresh;
  } catch (err) {
    if (cached && isRateLimitError(err)) {
      return cached;
    }
    throw err;
  }
}

// Network-only refresh for post-mutation revalidation. Skips the stale
// sessionStorage apply so optimistic updates are not briefly reverted.
export async function refreshCache(key, fetcher, apply) {
  try {
    const { data: fresh, stale } = await resolveFreshPayload(key, fetcher);
    if (stale) {
      // Epoch raced while this GET was in flight — still apply if we have a
      // usable payload so live pages (e.g. Group Detail) are not stuck on seed.
      if (fresh && !isApiErrorPayload(fresh)) {
        try { sessionStorage.setItem(`pm_cache_${key}`, JSON.stringify(fresh)); } catch { /* quota */ }
        apply(fresh, true);
      }
      return fresh;
    }
    if (isApiErrorPayload(fresh)) {
      throw new Error(fresh.detail);
    }
    try { sessionStorage.setItem(`pm_cache_${key}`, JSON.stringify(fresh)); } catch { /* quota */ }
    apply(fresh, false);
    return fresh;
  } catch (err) {
    const cached = readSessionCache(key);
    if (cached && isRateLimitError(err)) {
      apply(cached, true);
      return cached;
    }
    throw err;
  }
}

// Write-through: keep the cache in step with an optimistic local update so
// navigating away and back never shows the pre-change data.
export function writeCache(key, data) {
  try { sessionStorage.setItem(`pm_cache_${key}`, JSON.stringify(data)); } catch { /* quota */ }
}

export function clearCache(key) {
  try { sessionStorage.removeItem(`pm_cache_${key}`); } catch { /* ignore */ }
}

export function patchCache(key, patch) {
  try {
    const cached = sessionStorage.getItem(`pm_cache_${key}`);
    const existing = cached ? JSON.parse(cached) : {};
    if (!isApiErrorPayload(existing)) {
      sessionStorage.setItem(`pm_cache_${key}`, JSON.stringify({ ...existing, ...patch }));
    }
  } catch { /* quota */ }
}

export function removeRequestsFromCache(key, { requestIds = [], groupIds = [] } = {}) {
  const reqSet = new Set(requestIds.filter(Boolean));
  const grpSet = new Set(groupIds.filter(Boolean));
  if (reqSet.size === 0 && grpSet.size === 0) return;
  try {
    const cached = sessionStorage.getItem(`pm_cache_${key}`);
    if (!cached) return;
    const parsed = JSON.parse(cached);
    if (!parsed || !Array.isArray(parsed.requests)) return;
    const nextRequests = parsed.requests.filter(
      (r) => !reqSet.has(r.id) && !grpSet.has(r.duplicateGroupId),
    );
    sessionStorage.setItem(`pm_cache_${key}`, JSON.stringify({ ...parsed, requests: nextRequests }));
  } catch { /* quota */ }
}

function standaloneRequestRowFromMember(member, { stripDuplicateTags = true } = {}) {
  if (!member?.id) return null;
  const tags = Array.isArray(member.tags) ? member.tags : [];
  return {
    id: member.id,
    displayId: member.displayId || 0,
    receivedAt: member.receivedAt || null,
    person: member.person || {
      firstName: member.firstName || '',
      lastName: member.lastName || '',
      email: member.email || '',
      location: member.location || '',
      role: member.role || null,
    },
    action: member.action || 'Add',
    status: member.status || 'new',
    tags: stripDuplicateTags
      ? tags.filter((t) => !String(t).toLowerCase().includes('duplicate'))
      : tags,
    submittedBy: member.submittedBy || null,
    notes: member.notes || '',
    createdBy: member.createdBy || null,
    directorFirst: member.directorFirst || member.person?.directorFirst || null,
    directorLast: member.directorLast || member.person?.directorLast || null,
    duplicateGroupId: null,
    groupMembers: null,
    groupPreview: null,
    groupClassificationSummary: null,
    groupDirectoryPersonId: null,
    groupDirectoryPerson: null,
  };
}

/**
 * After "Not the same person" → New Requests: keep the list cache warm and
 * detach the unlinked member as its own row (groups are usually one list row).
 */
export function detachRequestFromGroupInCache(key, {
  requestId,
  groupId,
  member = null,
  remainingMembers = null,
} = {}) {
  if (!requestId) return;
  try {
    const cached = sessionStorage.getItem(`pm_cache_${key}`);
    if (!cached) return;
    const parsed = JSON.parse(cached);
    if (!parsed || !Array.isArray(parsed.requests)) return;

    const remaining = Array.isArray(remainingMembers)
      ? remainingMembers.filter((m) => m?.id && m.id !== requestId)
      : null;
    let detached = null;
    let nextRequests = [];

    for (const row of parsed.requests) {
      if (!row) continue;

      // Already a solo row for this request — clear any leftover group pointers.
      if (row.id === requestId) {
        detached = {
          ...row,
          duplicateGroupId: null,
          groupMembers: null,
          groupPreview: null,
          groupClassificationSummary: null,
          groupDirectoryPersonId: null,
          groupDirectoryPerson: null,
          tags: Array.isArray(row.tags)
            ? row.tags.filter((t) => !String(t).toLowerCase().includes('duplicate'))
            : row.tags,
        };
        continue;
      }

      const isSourceGroup = groupId && row.duplicateGroupId === groupId;
      if (!isSourceGroup) {
        nextRequests.push(row);
        continue;
      }

      // Pull member snapshot from the group preview when the parent did not pass one.
      if (!detached) {
        const previewMembers = Array.isArray(row.groupPreview?.members)
          ? row.groupPreview.members
          : (Array.isArray(row.groupMembers) ? row.groupMembers : []);
        const fromPreview = previewMembers.find((m) => m?.id === requestId) || null;
        detached = standaloneRequestRowFromMember(member || fromPreview);
      }

      if (remaining && remaining.length === 0) {
        // Group dissolved — drop the shell row.
        continue;
      }

      if (remaining && remaining.length === 1) {
        const sole = remaining[0];
        nextRequests.push({
          ...standaloneRequestRowFromMember(sole, { stripDuplicateTags: true }),
          // Keep id as the remaining request; no group shell.
        });
        continue;
      }

      if (remaining && remaining.length > 1) {
        const rep =
          remaining.find((m) => m.isRepresentative)
          || remaining[0];
        const preview = {
          ...(row.groupPreview && typeof row.groupPreview === 'object' ? row.groupPreview : {}),
          members: remaining,
          representativeRequestId: rep.id,
        };
        nextRequests.push({
          ...row,
          id: rep.id,
          displayId: rep.displayId || row.displayId || 0,
          receivedAt: rep.receivedAt || row.receivedAt || null,
          person: rep.person || row.person,
          action: rep.action || row.action,
          status: rep.status || row.status,
          tags: rep.tags || row.tags,
          submittedBy: rep.submittedBy || row.submittedBy,
          notes: rep.notes || row.notes,
          createdBy: rep.createdBy || row.createdBy,
          directorFirst: rep.directorFirst || rep.person?.directorFirst || row.directorFirst,
          directorLast: rep.directorLast || rep.person?.directorLast || row.directorLast,
          duplicateGroupId: groupId,
          groupMembers: remaining,
          groupPreview: preview,
        });
        continue;
      }

      // No remainingMembers hint — keep the group shell; network refresh will trim it.
      nextRequests.push(row);
    }

    if (!detached) {
      detached = standaloneRequestRowFromMember(member);
    }
    if (detached) {
      nextRequests = [detached, ...nextRequests.filter((r) => r?.id !== detached.id)];
    }

    sessionStorage.setItem(
      `pm_cache_${key}`,
      JSON.stringify({ ...parsed, requests: nextRequests }),
    );
  } catch { /* quota */ }
}

// Local tombstones so optimistic removals are not resurrected by a stale poll/SWR write.
const NEW_REQUESTS_SUPPRESS_KEY = 'pm_new_requests_suppress_v1';
const NEW_REQUESTS_SUPPRESS_TTL_MS = 10 * 60 * 1000;

function readNewRequestsSuppressions() {
  try {
    const raw = sessionStorage.getItem(NEW_REQUESTS_SUPPRESS_KEY);
    if (!raw) return { requestIds: {}, groupIds: {}, hardRequestIds: {} };
    const parsed = JSON.parse(raw);
    const asMap = (value) => (value && typeof value === 'object' ? value : {});
    return {
      requestIds: asMap(parsed?.requestIds),
      groupIds: asMap(parsed?.groupIds),
      hardRequestIds: asMap(parsed?.hardRequestIds),
    };
  } catch {
    return { requestIds: {}, groupIds: {}, hardRequestIds: {} };
  }
}

function writeNewRequestsSuppressions(state) {
  try {
    sessionStorage.setItem(NEW_REQUESTS_SUPPRESS_KEY, JSON.stringify(state));
  } catch { /* quota */ }
}

/**
 * Hide resolved/dismissed requests from New Requests until the server catches up.
 *
 * `hard: true` is for ids the server will never list as open again (deleted or
 * marked handled). A list GET that started before the mutation committed can
 * still return them — hard tombstones are not cleared by those responses.
 */
export function suppressNewRequests({ requestIds = [], groupIds = [], hard = false } = {}) {
  const state = readNewRequestsSuppressions();
  const until = Date.now() + NEW_REQUESTS_SUPPRESS_TTL_MS;
  const requestBucket = hard ? state.hardRequestIds : state.requestIds;
  for (const id of requestIds) {
    if (id) requestBucket[id] = until;
  }
  for (const id of groupIds) {
    if (id) state.groupIds[id] = until;
  }
  writeNewRequestsSuppressions(state);
  // Sidebar badge must drop in the same tick as the list (merge / Directory /
  // delete) — do not wait for the next /page poll.
  if (requestIds.length) {
    removePendingRequestIdsFromBadge(requestIds);
  }
}

/**
 * Remove suppression tombstones. Rollbacks (failed mutation) clear hard ones too;
 * server-reconcile callers pass `includeHard: false`.
 */
export function clearNewRequestsSuppressions({ requestIds = [], groupIds = [], includeHard = true } = {}) {
  const state = readNewRequestsSuppressions();
  for (const id of requestIds) {
    if (!id) continue;
    delete state.requestIds[id];
    if (includeHard) delete state.hardRequestIds[id];
  }
  for (const id of groupIds) {
    if (id) delete state.groupIds[id];
  }
  writeNewRequestsSuppressions(state);
}

/** Request ids deleted / handled this session (still within tombstone TTL). */
export function hardSuppressedRequestIds() {
  const state = readNewRequestsSuppressions();
  const now = Date.now();
  const ids = new Set();
  for (const [id, until] of Object.entries(state.hardRequestIds)) {
    if (until > now) ids.add(id);
  }
  return ids;
}

/** Filter suppressed rows while preserving tombstones for their full TTL. */
export function applyNewRequestsSuppressions(requests) {
  if (!Array.isArray(requests)) return requests;
  const state = readNewRequestsSuppressions();
  const now = Date.now();
  const activeRequestIds = new Set();
  const activeGroupIds = new Set();

  const live = (map) => {
    const next = {};
    for (const [id, until] of Object.entries(map)) {
      if (until > now) next[id] = until;
    }
    return next;
  };
  const nextRequestIds = live(state.requestIds);
  const nextHardRequestIds = live(state.hardRequestIds);
  const nextGroupIds = live(state.groupIds);
  Object.keys(nextRequestIds).forEach((id) => activeRequestIds.add(id));
  Object.keys(nextHardRequestIds).forEach((id) => activeRequestIds.add(id));
  Object.keys(nextGroupIds).forEach((id) => activeGroupIds.add(id));

  writeNewRequestsSuppressions({
    requestIds: nextRequestIds,
    groupIds: nextGroupIds,
    hardRequestIds: nextHardRequestIds,
  });

  if (activeRequestIds.size === 0 && activeGroupIds.size === 0) {
    return requests;
  }

  return requests.filter(
    (row) => !activeRequestIds.has(row.id) && !activeGroupIds.has(row.duplicateGroupId),
  );
}

/** Lightweight pending-queue + directory counts for nav badges / Overview. */
export const getKpis = (partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/kpis${query}`);
};

// Combined page payloads (one round trip per view)
export const getDashboard = (partnerId, startDate, endDate) => {
  const params = new URLSearchParams();
  if (partnerId) params.append('partner_id', partnerId);
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);
  const qs = params.toString();
  return request(`/api/dashboard${qs ? `?${qs}` : ''}`);
};

/** Fast Overview date-filter refresh (chart + handled counts only). */
export const getDashboardPeriod = (partnerId, startDate, endDate) => {
  const params = new URLSearchParams();
  if (partnerId) params.append('partner_id', partnerId);
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);
  const qs = params.toString();
  return request(`/api/dashboard/period${qs ? `?${qs}` : ''}`);
};
export const getPilot2Overview = () => request('/api/pilot2/overview');
/** `fetchedAt` = GET start time, so consumers can drop responses older than one already applied. */
export const getNewRequestsPage = async (partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  const fetchedAt = Date.now();
  const data = await request(`/api/admin/requests/page${query}`);
  return data && typeof data === 'object' && !Array.isArray(data) && !isApiErrorPayload(data)
    ? { ...data, fetchedAt }
    : data;
};
/** Single request by id — Request Detail must not rely only on the collapsed list page. */
export const getAdminRequest = (id) =>
  request(`/api/admin/requests/${encodeURIComponent(id)}`);
export const getPilot2Workspace = () => request('/api/pilot2/workspace');
export const dismissRequest = (id, { alsoDeleteIds } = {}) =>
  request(`/api/admin/requests/${id}/dismiss`, {
    method: 'POST',
    body: JSON.stringify({
      // Freeze confirmed siblings at Delete-confirm open — late arrivals stay.
      alsoDeleteIds: Array.isArray(alsoDeleteIds) ? alsoDeleteIds.filter(Boolean) : null,
    }),
  });
export const getDismissImpact = (id) => request(`/api/admin/requests/${id}/dismiss-impact`);
export const bulkDismissRequests = (ids, { alsoDeleteIds } = {}) =>
  request('/api/admin/requests/bulk-dismiss', {
    method: 'POST',
    body: JSON.stringify({
      ids,
      // Freeze confirmed siblings at Confirm bulk delete open — late arrivals stay.
      alsoDeleteIds: Array.isArray(alsoDeleteIds) ? alsoDeleteIds.filter(Boolean) : null,
    }),
  });

// Directory persons
export const updatePerson = (id, data, partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/persons/${id}${query}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
};

export const archivePerson = (id, partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/persons/${id}/archive${query}`, { method: 'POST' });
};

export const bulkArchivePersons = (ids, partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/persons/bulk-archive${query}`, { method: 'POST', body: JSON.stringify({ ids }) });
};

export const restorePerson = (id, partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/persons/${id}/restore${query}`, { method: 'POST' });
};

export const bulkRestorePersons = (ids, partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/persons/bulk-restore${query}`, { method: 'POST', body: JSON.stringify({ ids }) });
};

export const bulkDeletePersons = (ids, partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/persons/bulk-delete${query}`, { method: 'POST', body: JSON.stringify({ ids }) });
};

export const fetchArchivedPeople = (partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/persons/archived${query}`);
};


// Partners
export const getPartners = () => request('/api/partners');
export const getPartner = (id) => request(`/api/partners/${id}`);
export const createPartner = ({ name, allowedDomains = [], automatedSources = [] }) =>
  request('/api/partners', {
    method: 'POST',
    body: JSON.stringify({ name, allowedDomains, automatedSources }),
  });
export const updatePartner = (id, name) =>
  request(`/api/partners/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });

// --- Custom Manager Form API ---

export const getManagerPartnerBranding = (partnerId = null) => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/manager/partner-branding${query}`);
};

export const getPublicPartnerBranding = (email, partnerSlug = null) => {
  const params = new URLSearchParams({ email });
  if (partnerSlug) params.set('partner_slug', partnerSlug);
  return request(`/api/public/partner-branding?${params}`);
};

export const getPublicCustomForm = (partnerSlug) =>
  request(`/api/public/custom-form/${encodeURIComponent(partnerSlug)}`);

export const getPartnerCustomForm = (partnerId) =>
  request(`/api/partners/${partnerId}/custom-form`);

export const updatePartnerCustomForm = (partnerId, payload) =>
  request(`/api/partners/${partnerId}/custom-form`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export async function uploadPartnerLogo(partnerId, dataUrl) {
  // Send the image as a base64 data URL in JSON. Vercel's Python serverless
  // runtime does not reliably deliver multipart/form-data bodies, so a
  // multipart upload surfaced as "Failed to fetch" in production.
  return request(`/api/partners/${partnerId}/logo`, {
    method: 'POST',
    body: JSON.stringify({ logo_data_url: dataUrl }),
  });
}

export const deletePartnerLogo = (partnerId) =>
  request(`/api/partners/${partnerId}/logo`, { method: 'DELETE' });

// Inboxes
export const getInboxes = (partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/pilot2/inboxes${query}`);
};
export const connectInbox = (title, email = '', partnerId = '') =>
  request('/api/pilot2/inboxes/connect', {
    method: 'POST',
    body: JSON.stringify({ title, email: email || '', partnerId: partnerId || null }),
  });
export const disconnectInbox = (id) =>
  request(`/api/pilot2/inboxes/${id}/disconnect`, { method: 'POST' });
export const updateInbox = (id, title) =>
  request(`/api/pilot2/inboxes/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
export const deleteInbox = (id) =>
  request(`/api/pilot2/inboxes/${id}`, { method: 'DELETE' });

// Ignore list
export const getIgnoreList = (inbox) => {
  const query = inbox ? `?inbox=${encodeURIComponent(inbox)}` : '';
  return request(`/api/pilot2/ignore-list${query}`);
};
export const createIgnoreRule = (inbox, pattern) =>
  request('/api/pilot2/ignore-list', { method: 'POST', body: JSON.stringify({ inbox, pattern }) });
export const deleteIgnoreRule = (id) =>
  request(`/api/pilot2/ignore-list/${id}`, { method: 'DELETE' });

// Partner allowlists
export const getManagerDomains = (partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/admin/manager-domains${query}`);
};
export const createManagerDomain = (domain, partnerId) =>
  request('/api/admin/manager-domains', {
    method: 'POST',
    body: JSON.stringify({ domain, partnerId }),
  });
export const deleteManagerDomain = (id) =>
  request(`/api/admin/manager-domains/${id}`, { method: 'DELETE' });
export const getAutomatedSources = (partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/admin/automated-sources${query}`);
};
export const createAutomatedSource = (pattern, partnerId) =>
  request('/api/admin/automated-sources', {
    method: 'POST',
    body: JSON.stringify({ pattern, partnerId }),
  });
export const deleteAutomatedSource = (id) =>
  request(`/api/admin/automated-sources/${id}`, { method: 'DELETE' });

// Emails
export const getEmails = () => request('/api/pilot2/emails');
export const patchEmail = (id, patch) =>
  request(`/api/pilot2/emails/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const updateDraft = (id, draftBody) =>
  request(`/api/pilot2/emails/${id}/draft`, { method: 'PUT', body: JSON.stringify({ draftBody }) });
export const sendEmail = (id, finalBody) =>
  request(`/api/pilot2/emails/${id}/send`, { method: 'POST', body: JSON.stringify({ finalBody }) });
export const sendReplyAll = (id, finalBody, toEmails, ccEmails = []) =>
  request(`/api/pilot2/emails/${id}/reply-all`, {
    method: 'POST',
    body: JSON.stringify({ finalBody, toEmails, ccEmails }),
  });
export const sendForward = (id, finalBody, toEmails, ccEmails = []) =>
  request(`/api/pilot2/emails/${id}/forward`, {
    method: 'POST',
    body: JSON.stringify({ finalBody, toEmails, ccEmails }),
  });
export const composeMessage = ({ inbox, toEmails, ccEmails = [], bccEmails = [], subject, finalBody }) =>
  request('/api/pilot2/compose', {
    method: 'POST',
    body: JSON.stringify({ inbox, toEmails, ccEmails, bccEmails, subject, finalBody }),
  });

// Attachment bytes need the auth header, so we can't use a plain <a href>.
// Fetch the blob, then trigger a client-side download via an object URL.
export async function downloadAttachment(emailId, attachmentId, filename) {
  const res = await authFetch(
    `/api/pilot2/emails/${emailId}/attachments/${attachmentId}`,
  );
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(typeof detail === 'string' ? detail : 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'attachment';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
export const bulkPatchEmails = (ids, patch) =>
  request('/api/pilot2/emails/bulk-patch', { method: 'POST', body: JSON.stringify({ ids, ...patch }) });
export const deleteEmailForever = (id) =>
  request(`/api/pilot2/emails/${id}`, { method: 'DELETE' });
export const emptyBin = () =>
  request('/api/pilot2/emails/bin/empty', { method: 'POST' });

// Templates
export const getTemplates = (inbox) => {
  const query = inbox ? `?inbox=${encodeURIComponent(inbox)}` : '';
  return request(`/api/pilot2/templates${query}`);
};
export const getTemplatesForConnectedInboxes = async (inboxes) => {
  const connected = (inboxes ?? []).filter((inbox) => inbox.status === 'Connected');
  if (!connected.length) return getTemplates();
  const batches = await Promise.all(connected.map((inbox) => getTemplates(inbox.email)));
  const byId = new Map();
  for (const batch of batches) {
    for (const row of batch ?? []) byId.set(row.id, row);
  }
  return [...byId.values()];
};
export const createTemplate = (template) =>
  request('/api/pilot2/templates', { method: 'POST', body: JSON.stringify(template) });
export const updateTemplate = (id, template) =>
  request(`/api/pilot2/templates/${id}`, { method: 'PUT', body: JSON.stringify(template) });
export const deleteTemplate = (id) =>
  request(`/api/pilot2/templates/${id}`, { method: 'DELETE' });
export const restoreTemplate = (id) =>
  request(`/api/pilot2/templates/${id}/restore`, { method: 'POST' });
export const deleteTemplateForever = (id) =>
  request(`/api/pilot2/templates/${id}/forever`, { method: 'DELETE' });

// Template suggestions (AI learning)
export const getTemplateSuggestions = (inbox) => {
  const params = new URLSearchParams({ status: 'pending' });
  if (inbox) params.set('inbox', inbox);
  return request(`/api/pilot2/suggestions?${params.toString()}`);
};
export const approveTemplateSuggestion = (id) =>
  request(`/api/pilot2/suggestions/${id}/approve`, { method: 'POST' });
export const rejectTemplateSuggestion = (id) =>
  request(`/api/pilot2/suggestions/${id}/reject`, { method: 'POST' });
