// Pilot 2 API client — same base URL convention as the Pilot 1 pages
// (see utils/api.js: localhost in dev, same-origin in production).
import { fetchJson, authFetch } from './api';

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

export const REQUESTS_PAGE_CACHE_KEY = 'requests_page_v3';

const inFlightFreshByKey = new Map();
/** Bumped on local mutations so in-flight GETs cannot overwrite newer cache/UI. */
const cacheEpochByKey = new Map();

export function bumpCacheEpoch(key) {
  cacheEpochByKey.set(key, (cacheEpochByKey.get(key) || 0) + 1);
  inFlightFreshByKey.delete(key);
}

function currentCacheEpoch(key) {
  return cacheEpochByKey.get(key) || 0;
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

// Local tombstones so optimistic removals are not resurrected by a stale poll/SWR write.
const NEW_REQUESTS_SUPPRESS_KEY = 'pm_new_requests_suppress_v1';
const NEW_REQUESTS_SUPPRESS_TTL_MS = 10 * 60 * 1000;

function readNewRequestsSuppressions() {
  try {
    const raw = sessionStorage.getItem(NEW_REQUESTS_SUPPRESS_KEY);
    if (!raw) return { requestIds: {}, groupIds: {} };
    const parsed = JSON.parse(raw);
    return {
      requestIds: parsed?.requestIds && typeof parsed.requestIds === 'object' ? parsed.requestIds : {},
      groupIds: parsed?.groupIds && typeof parsed.groupIds === 'object' ? parsed.groupIds : {},
    };
  } catch {
    return { requestIds: {}, groupIds: {} };
  }
}

function writeNewRequestsSuppressions(state) {
  try {
    sessionStorage.setItem(NEW_REQUESTS_SUPPRESS_KEY, JSON.stringify(state));
  } catch { /* quota */ }
}

/** Hide resolved/dismissed requests from New Requests until the server catches up. */
export function suppressNewRequests({ requestIds = [], groupIds = [] } = {}) {
  const state = readNewRequestsSuppressions();
  const until = Date.now() + NEW_REQUESTS_SUPPRESS_TTL_MS;
  for (const id of requestIds) {
    if (id) state.requestIds[id] = until;
  }
  for (const id of groupIds) {
    if (id) state.groupIds[id] = until;
  }
  writeNewRequestsSuppressions(state);
}

/** Filter suppressed rows; drop tombstones once the server no longer returns them. */
export function applyNewRequestsSuppressions(requests) {
  if (!Array.isArray(requests)) return requests;
  const state = readNewRequestsSuppressions();
  const now = Date.now();
  const activeRequestIds = new Set();
  const activeGroupIds = new Set();

  for (const [id, until] of Object.entries(state.requestIds)) {
    if (until > now) activeRequestIds.add(id);
  }
  for (const [id, until] of Object.entries(state.groupIds)) {
    if (until > now) activeGroupIds.add(id);
  }

  if (activeRequestIds.size === 0 && activeGroupIds.size === 0) {
    if (Object.keys(state.requestIds).length || Object.keys(state.groupIds).length) {
      writeNewRequestsSuppressions({ requestIds: {}, groupIds: {} });
    }
    return requests;
  }

  const filtered = requests.filter(
    (row) => !activeRequestIds.has(row.id) && !activeGroupIds.has(row.duplicateGroupId),
  );

  const stillPresentIds = new Set(requests.map((row) => row.id));
  const stillPresentGroups = new Set(
    requests.map((row) => row.duplicateGroupId).filter(Boolean),
  );

  const nextRequestIds = {};
  const nextGroupIds = {};
  for (const id of activeRequestIds) {
    // Keep suppression while server still returns the row (lag); drop once gone.
    if (stillPresentIds.has(id)) nextRequestIds[id] = state.requestIds[id];
  }
  for (const id of activeGroupIds) {
    if (stillPresentGroups.has(id)) nextGroupIds[id] = state.groupIds[id];
  }
  writeNewRequestsSuppressions({ requestIds: nextRequestIds, groupIds: nextGroupIds });

  return filtered;
}

// Combined page payloads (one round trip per view)
export const getDashboard = (partnerId, startDate, endDate) => {
  const params = new URLSearchParams();
  if (partnerId) params.append('partner_id', partnerId);
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);
  const qs = params.toString();
  return request(`/api/dashboard${qs ? `?${qs}` : ''}`);
};
export const getPilot2Overview = () => request('/api/pilot2/overview');
export const getNewRequestsPage = (partnerId = '') => {
  const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
  return request(`/api/admin/requests/page${query}`);
};
export const getPilot2Workspace = () => request('/api/pilot2/workspace');
export const dismissRequest = (id) => request(`/api/admin/requests/${id}/dismiss`, { method: 'POST' });
export const getDismissImpact = (id) => request(`/api/admin/requests/${id}/dismiss-impact`);
export const bulkDismissRequests = (ids) => request('/api/admin/requests/bulk-dismiss', { method: 'POST', body: JSON.stringify({ ids }) });

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
