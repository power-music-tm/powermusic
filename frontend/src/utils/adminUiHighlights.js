const DIRECTORY_EMAILS_KEY = 'pm_admin_directory_highlight_emails';
const DIRECTORY_VIEWED_KEY = 'pm_admin_directory_highlight_viewed';
const DIRECTORY_VISIT_DEDUPE_KEY = 'pm_admin_directory_visit_dedupe';

const UNSEEN_REQUESTS_KEY = 'pm_admin_unseen_request_ids';
const VIEWED_REQUESTS_KEY = 'pm_admin_viewed_request_ids';
const REQUESTS_VISIT_DEDUPE_KEY = 'pm_admin_requests_visit_dedupe';
const ADMIN_NEW_REQUESTS_KNOWN_IDS_KEY = 'pm_admin_new_requests_known_ids';
const ADMIN_NEW_REQUESTS_SYNC_BOOTSTRAPPED_KEY = 'pm_admin_new_requests_sync_bootstrapped';
const ADMIN_NEW_REQUESTS_DEPARTED_AT_KEY = 'pm_admin_new_requests_departed_at';
const ADMIN_SESSION_STARTED_AT_KEY = 'pm_admin_session_started_at';
/** Queue ids for the sidebar unopened badge (session). */
const PENDING_REQUEST_IDS_BADGE_KEY = 'pm_admin_pending_request_ids_badge_v2';
/** Start time of the list GET that last wrote pending ids — older responses are ignored. */
const PENDING_REQUEST_IDS_FETCHED_AT_KEY = 'pm_admin_pending_request_ids_fetched_at_v2';
/** Opened this session — badge drops immediately; not cleared on page re-visit. */
const OPENED_REQUEST_IDS_BADGE_KEY = 'pm_admin_opened_request_ids_badge_v2';
export const ADMIN_NEW_REQUESTS_BADGE_EVENT = 'pm-admin-new-requests-badge';
export const ADMIN_DIRECTORY_BADGE_EVENT = 'pm-admin-directory-badge';

const MANAGER_HANDLED_UNSEEN_KEY = 'pm_manager_handled_unseen_request_ids';
const MANAGER_HANDLED_VIEWED_KEY = 'pm_manager_handled_viewed_request_ids';
const MANAGER_HANDLED_VISIT_DEDUPE_KEY = 'pm_manager_handled_visit_dedupe';
const MANAGER_KNOWN_STATES_KEY = 'pm_manager_request_known_states';
const MANAGER_PENDING_UNSEEN_KEY = 'pm_manager_pending_unseen_request_ids';
const MANAGER_KNOWN_PENDING_KEY = 'pm_manager_known_pending_request_ids';
const MANAGER_PENDING_BOOTSTRAPPED_KEY = 'pm_manager_pending_bootstrapped';

/** LinkedIn-style unseen row highlight (admin + manager) — background only, no left bar. */
export const ADMIN_NEW_ROW_HIGHLIGHT_CLASS =
  'bg-[var(--color-surface-highlight)] hover:bg-[var(--color-surface-highlight-strong)]';

const SCOPES = {
  adminNewRequests: {
    unseenKey: UNSEEN_REQUESTS_KEY,
    viewedKey: VIEWED_REQUESTS_KEY,
    visitDedupeKey: REQUESTS_VISIT_DEDUPE_KEY,
  },
  adminDirectory: {
    unseenKey: DIRECTORY_EMAILS_KEY,
    viewedKey: DIRECTORY_VIEWED_KEY,
    visitDedupeKey: DIRECTORY_VISIT_DEDUPE_KEY,
  },
  managerHandled: {
    unseenKey: MANAGER_HANDLED_UNSEEN_KEY,
    viewedKey: MANAGER_HANDLED_VIEWED_KEY,
    visitDedupeKey: MANAGER_HANDLED_VISIT_DEDUPE_KEY,
  },
};

function readJson(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

function readSet(key) {
  return new Set(readJson(key, []));
}

function writeSet(key, set) {
  writeJson(key, [...set]);
}

function normalizeHighlightId(id) {
  return String(id || '').trim().toLowerCase();
}

function markHighlightUnseen(scope, rawId) {
  const id = normalizeHighlightId(rawId);
  if (!id) return;
  const unseen = readSet(scope.unseenKey);
  unseen.add(id);
  writeSet(scope.unseenKey, unseen);
  const viewed = readSet(scope.viewedKey);
  viewed.delete(id);
  writeSet(scope.viewedKey, viewed);
}

function isHighlightUnseen(scope, rawId) {
  const id = normalizeHighlightId(rawId);
  if (!id) return false;
  return readSet(scope.unseenKey).has(id);
}

/** User opened the item — keep highlighted until the next page visit. */
function markHighlightViewed(scope, rawId) {
  const id = normalizeHighlightId(rawId);
  if (!id) return;
  if (!readSet(scope.unseenKey).has(id)) return;
  const viewed = readSet(scope.viewedKey);
  viewed.add(id);
  writeSet(scope.viewedKey, viewed);
}

function removeHighlight(scope, rawId) {
  const id = normalizeHighlightId(rawId);
  if (!id) return;
  const unseen = readSet(scope.unseenKey);
  unseen.delete(id);
  writeSet(scope.unseenKey, unseen);
  const viewed = readSet(scope.viewedKey);
  viewed.delete(id);
  writeSet(scope.viewedKey, viewed);
}

function dismissAllHighlights(scope) {
  writeSet(scope.unseenKey, new Set());
  writeSet(scope.viewedKey, new Set());
  sessionStorage.removeItem(scope.visitDedupeKey);
}

function countHighlightUnseen(scope) {
  return readSet(scope.unseenKey).size;
}

function notifyNewRequestsBadgeChanged() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(ADMIN_NEW_REQUESTS_BADGE_EVENT));
  } catch {
    // ignore
  }
}

/**
 * Keep sidebar badge pending-ids in sync with the live New Requests queue.
 * Pass `fetchedAt` (GET start time) so a slower, older response cannot
 * overwrite a newer one — the sidebar and New Requests both fetch the list.
 */
export function syncPendingRequestIdsForBadge(requestIds, { fetchedAt } = {}) {
  const at = Number(fetchedAt) || Date.now();
  const lastAt = Number(readJson(PENDING_REQUEST_IDS_FETCHED_AT_KEY, 0)) || 0;
  if (at < lastAt) return null;

  const ids = [
    ...new Set(
      (requestIds || [])
        .map((id) => normalizeHighlightId(id))
        .filter(Boolean),
    ),
  ];
  writeJson(PENDING_REQUEST_IDS_FETCHED_AT_KEY, at);
  const prev = readJson(PENDING_REQUEST_IDS_BADGE_KEY, []);
  const same = Array.isArray(prev)
    && prev.length === ids.length
    && prev.every((id, i) => id === ids[i]);
  if (!same) {
    writeJson(PENDING_REQUEST_IDS_BADGE_KEY, ids);
    notifyNewRequestsBadgeChanged();
  }
  return ids;
}

/**
 * Instant badge drop for merge / delete / Directory — do not wait for the next
 * list GET. Leaves fetchedAt alone (it orders server GETs only): a local clock
 * stamp would make an in-flight, newer GET look older and drop new arrivals.
 * Suppression tombstones keep removed ids from coming back.
 */
export function removePendingRequestIdsFromBadge(requestIds) {
  const drop = new Set(
    (requestIds || []).map((id) => normalizeHighlightId(id)).filter(Boolean),
  );
  if (drop.size === 0) return false;
  const pending = readJson(PENDING_REQUEST_IDS_BADGE_KEY, []);
  if (!Array.isArray(pending) || pending.length === 0) return false;
  const next = pending.filter((id) => id && !drop.has(normalizeHighlightId(id)));
  if (next.length === pending.length) return false;
  writeJson(PENDING_REQUEST_IDS_BADGE_KEY, next);
  notifyNewRequestsBadgeChanged();
  return true;
}

/**
 * Instant badge rise when the visible queue gains rows (e.g. optimistic list
 * patch) without a full syncPending replace.
 */
export function addPendingRequestIdsToBadge(requestIds) {
  const add = [
    ...new Set(
      (requestIds || []).map((id) => normalizeHighlightId(id)).filter(Boolean),
    ),
  ];
  if (add.length === 0) return false;
  const pending = readJson(PENDING_REQUEST_IDS_BADGE_KEY, []);
  const prev = Array.isArray(pending) ? pending : [];
  const have = new Set(prev.map((id) => normalizeHighlightId(id)));
  const merged = [...prev];
  let changed = false;
  for (const id of add) {
    if (have.has(id)) continue;
    have.add(id);
    merged.push(id);
    changed = true;
  }
  if (!changed) return false;
  writeJson(PENDING_REQUEST_IDS_BADGE_KEY, merged);
  notifyNewRequestsBadgeChanged();
  return true;
}

/** Unopened = still in the queue and not opened this session. */
export function countUnopenedNewRequests() {
  const pending = readJson(PENDING_REQUEST_IDS_BADGE_KEY, []);
  if (!Array.isArray(pending) || pending.length === 0) return 0;
  const opened = readSet(OPENED_REQUEST_IDS_BADGE_KEY);
  let n = 0;
  for (const id of pending) {
    const key = normalizeHighlightId(id);
    if (key && !opened.has(key)) n += 1;
  }
  return n;
}

/**
 * Call once per real navigation to a page (pass a stable dedupe key, e.g. location.key).
 * Items the user already viewed are unhighlighted on the next visit.
 */
function registerHighlightPageVisit(scope, dedupeKey) {
  if (dedupeKey) {
    const seen = sessionStorage.getItem(scope.visitDedupeKey);
    if (seen === dedupeKey) return;
    sessionStorage.setItem(scope.visitDedupeKey, dedupeKey);
  }

  const viewed = readSet(scope.viewedKey);
  if (viewed.size === 0) return;

  const unseen = readSet(scope.unseenKey);
  viewed.forEach((id) => unseen.delete(id));
  writeSet(scope.unseenKey, unseen);
  writeSet(scope.viewedKey, new Set());
}

// ── Admin · New Requests ─────────────────────────────────────────────────────

export function registerNewRequestsPageVisit(dedupeKey) {
  registerHighlightPageVisit(SCOPES.adminNewRequests, dedupeKey);
}

/** Drop highlight from requests the admin already opened (e.g. tab switch). */
export function flushViewedRequestHighlights() {
  const viewed = readSet(SCOPES.adminNewRequests.viewedKey);
  if (viewed.size === 0) return;
  const unseen = readSet(SCOPES.adminNewRequests.unseenKey);
  viewed.forEach((id) => unseen.delete(id));
  writeSet(SCOPES.adminNewRequests.unseenKey, unseen);
  writeSet(SCOPES.adminNewRequests.viewedKey, new Set());
}

function adminSessionStartedAt() {
  let started = readJson(ADMIN_SESSION_STARTED_AT_KEY, 0);
  if (!started) {
    started = Date.now();
    writeJson(ADMIN_SESSION_STARTED_AT_KEY, started);
  }
  return started;
}

function newRequestHighlightBaseline() {
  return Math.max(readJson(ADMIN_NEW_REQUESTS_DEPARTED_AT_KEY, 0), adminSessionStartedAt());
}

/** Remember when the admin left New Requests so arrivals while away can highlight. */
export function recordNewRequestsPageDeparted() {
  writeJson(ADMIN_NEW_REQUESTS_DEPARTED_AT_KEY, Date.now());
}

/**
 * Detect new partner requests vs the last known queue snapshot (session-persisted).
 * Returns true when at least one row was newly marked unseen.
 */
export function syncAdminNewRequestHighlights(
  requests,
  { isManualEntry = () => false, fetchedAt } = {},
) {
  const list = requests || [];
  // Sidebar badge tracks the full visible queue (including manual entries).
  syncPendingRequestIdsForBadge(list.map((req) => req.id), { fetchedAt });

  const eligible = list.filter((req) => !isManualEntry(req.submittedBy));
  const currentIds = eligible
    .map((req) => normalizeHighlightId(req.id))
    .filter(Boolean);
  const currentSet = new Set(currentIds);
  let changed = false;

  if (!readJson(ADMIN_NEW_REQUESTS_SYNC_BOOTSTRAPPED_KEY, false)) {
    const baseline = newRequestHighlightBaseline();
    eligible.forEach((req) => {
      const id = normalizeHighlightId(req.id);
      if (!id) return;
      const receivedMs = req.receivedAt ? new Date(req.receivedAt).getTime() : 0;
      if (receivedMs > baseline) {
        markHighlightUnseen(SCOPES.adminNewRequests, id);
        changed = true;
      }
    });
    writeSet(ADMIN_NEW_REQUESTS_KNOWN_IDS_KEY, currentSet);
    writeJson(ADMIN_NEW_REQUESTS_SYNC_BOOTSTRAPPED_KEY, true);
    return changed;
  }

  const known = readSet(ADMIN_NEW_REQUESTS_KNOWN_IDS_KEY);
  eligible.forEach((req) => {
    const id = normalizeHighlightId(req.id);
    if (!id || known.has(id)) return;
    known.add(id);
    markHighlightUnseen(SCOPES.adminNewRequests, id);
    changed = true;
  });

  [...known].forEach((id) => {
    if (!currentSet.has(id)) known.delete(id);
  });
  writeSet(ADMIN_NEW_REQUESTS_KNOWN_IDS_KEY, known);
  return changed;
}

export function markRequestUnseen(requestId) {
  markHighlightUnseen(SCOPES.adminNewRequests, requestId);
  notifyNewRequestsBadgeChanged();
}

export function isRequestUnseen(requestId) {
  return isHighlightUnseen(SCOPES.adminNewRequests, requestId);
}

export function markRequestViewed(requestId) {
  markRequestsViewed([requestId]);
}

/**
 * Batch open (e.g. every member of a group). Badge counts them as opened
 * immediately; row highlight may stay until the next page visit.
 */
export function markRequestsViewed(requestIds) {
  const opened = readSet(OPENED_REQUEST_IDS_BADGE_KEY);
  let changed = false;
  let sawId = false;
  for (const rawId of requestIds || []) {
    markHighlightViewed(SCOPES.adminNewRequests, rawId);
    const id = normalizeHighlightId(rawId);
    if (!id) continue;
    sawId = true;
    if (!opened.has(id)) {
      opened.add(id);
      changed = true;
    }
  }
  if (changed) writeSet(OPENED_REQUEST_IDS_BADGE_KEY, opened);
  // Always notify when opening — sidebar must drop in the same click, even if
  // the opened set was already warm from a prior seed / StrictMode pass.
  if (sawId) notifyNewRequestsBadgeChanged();
}

/** @deprecated Use markRequestViewed — kept for gradual migration */
export function clearRequestHighlight(requestId) {
  markRequestViewed(requestId);
}

export function removeRequestHighlight(requestId) {
  removeHighlight(SCOPES.adminNewRequests, requestId);
  const id = normalizeHighlightId(requestId);
  if (!id) return;
  const known = readSet(ADMIN_NEW_REQUESTS_KNOWN_IDS_KEY);
  if (known.delete(id)) {
    writeSet(ADMIN_NEW_REQUESTS_KNOWN_IDS_KEY, known);
  }
  const opened = readSet(OPENED_REQUEST_IDS_BADGE_KEY);
  if (opened.delete(id)) {
    writeSet(OPENED_REQUEST_IDS_BADGE_KEY, opened);
  }
  // Sidebar must re-read even when the id was already absent from pending.
  if (!removePendingRequestIdsFromBadge([id])) {
    notifyNewRequestsBadgeChanged();
  }
}

export function countUnseenRequests() {
  return countHighlightUnseen(SCOPES.adminNewRequests);
}

// ── Admin · Directory ────────────────────────────────────────────────────────

function notifyDirectoryBadgeChanged() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(ADMIN_DIRECTORY_BADGE_EVENT));
  } catch {
    // ignore
  }
}

export function registerDirectoryPageVisit(dedupeKey) {
  registerHighlightPageVisit(SCOPES.adminDirectory, dedupeKey);
  notifyDirectoryBadgeChanged();
}

/**
 * Mark an active Directory addition as unopened.
 * Archive / Removed rows must not call this — they are not Directory badge targets.
 */
export function markDirectoryPersonHighlight(email) {
  markHighlightUnseen(SCOPES.adminDirectory, email);
  notifyDirectoryBadgeChanged();
}

export function isDirectoryPersonHighlighted(email) {
  return isHighlightUnseen(SCOPES.adminDirectory, email);
}

export function markDirectoryPersonViewed(email) {
  markHighlightViewed(SCOPES.adminDirectory, email);
  notifyDirectoryBadgeChanged();
}

/** @deprecated Use markDirectoryPersonViewed */
export function clearDirectoryPersonHighlight(email) {
  markDirectoryPersonViewed(email);
}

export function removeDirectoryPersonHighlight(email) {
  removeHighlight(SCOPES.adminDirectory, email);
  notifyDirectoryBadgeChanged();
}

/** Unopened = highlighted and not opened this session (viewed set). */
export function countUnopenedDirectoryPeople() {
  const unseen = readSet(SCOPES.adminDirectory.unseenKey);
  if (unseen.size === 0) return 0;
  const viewed = readSet(SCOPES.adminDirectory.viewedKey);
  let n = 0;
  for (const id of unseen) {
    if (id && !viewed.has(id)) n += 1;
  }
  return n;
}

/**
 * Drop highlights for emails no longer in the active Directory list
 * (e.g. archived / deleted) so the sidebar never counts archive rows.
 */
export function pruneDirectoryHighlightsToActiveEmails(emails) {
  const active = new Set(
    (emails || []).map((email) => normalizeHighlightId(email)).filter(Boolean),
  );
  const unseen = readSet(SCOPES.adminDirectory.unseenKey);
  const viewed = readSet(SCOPES.adminDirectory.viewedKey);
  let changed = false;
  for (const id of [...unseen]) {
    if (!active.has(id)) {
      unseen.delete(id);
      viewed.delete(id);
      changed = true;
    }
  }
  if (!changed) return false;
  writeSet(SCOPES.adminDirectory.unseenKey, unseen);
  writeSet(SCOPES.adminDirectory.viewedKey, viewed);
  notifyDirectoryBadgeChanged();
  return true;
}

// ── Manager · Handled requests ───────────────────────────────────────────────

export function registerManagerHandledPageVisit(dedupeKey) {
  registerHighlightPageVisit(SCOPES.managerHandled, dedupeKey);
}

export function markManagerHandledRequestUnseen(requestId) {
  markHighlightUnseen(SCOPES.managerHandled, requestId);
}

export function isManagerHandledRequestUnseen(requestId) {
  return isHighlightUnseen(SCOPES.managerHandled, requestId);
}

export function markManagerHandledRequestViewed(requestId) {
  markHighlightViewed(SCOPES.managerHandled, requestId);
}

export function dismissAllManagerHandledHighlights() {
  dismissAllHighlights(SCOPES.managerHandled);
}

export function countManagerHandledRequestUnseen() {
  return countHighlightUnseen(SCOPES.managerHandled);
}

/** First load: record existing pending without notifying. Later: new pending ids only. */
export function syncManagerPendingHighlights(requests) {
  const currentPending = requests
    .filter((req) => req.status === 'new')
    .map((req) => normalizeHighlightId(req.id))
    .filter(Boolean);
  const pendingSet = new Set(currentPending);

  if (!readJson(MANAGER_PENDING_BOOTSTRAPPED_KEY, false)) {
    writeSet(MANAGER_KNOWN_PENDING_KEY, pendingSet);
    writeJson(MANAGER_PENDING_BOOTSTRAPPED_KEY, true);
    return false;
  }

  const known = readSet(MANAGER_KNOWN_PENDING_KEY);
  const unseen = readSet(MANAGER_PENDING_UNSEEN_KEY);
  let changed = false;

  currentPending.forEach((id) => {
    if (!known.has(id)) {
      known.add(id);
      unseen.add(id);
      changed = true;
    }
  });

  [...known].forEach((id) => {
    if (!pendingSet.has(id)) {
      known.delete(id);
      if (unseen.delete(id)) changed = true;
    }
  });

  writeSet(MANAGER_KNOWN_PENDING_KEY, known);
  if (changed) writeSet(MANAGER_PENDING_UNSEEN_KEY, unseen);
  return changed;
}

export function countManagerPendingUnseen() {
  return readSet(MANAGER_PENDING_UNSEEN_KEY).size;
}

export function isManagerPendingRequestUnseen(requestId) {
  const id = normalizeHighlightId(requestId);
  if (!id) return false;
  return readSet(MANAGER_PENDING_UNSEEN_KEY).has(id);
}

/** Clear pending tab notification after the manager views tabs or closes the modal. */
export function dismissManagerPendingHighlights(requests = []) {
  const currentPending = requests
    .filter((req) => req.status === 'new')
    .map((req) => normalizeHighlightId(req.id))
    .filter(Boolean);
  writeSet(MANAGER_PENDING_UNSEEN_KEY, new Set());
  writeSet(MANAGER_KNOWN_PENDING_KEY, new Set(currentPending));
}

/** Detect pending → handled transitions and mark unseen (session-persisted). */
export function syncManagerHandledHighlights(requests) {
  const known = readJson(MANAGER_KNOWN_STATES_KEY, {});
  let changed = false;
  const nextKnown = { ...known };

  requests.forEach((req) => {
    const state = `${req.status}|${req.handledAt || ''}`;
    const prev = known[req.id];
    if (prev && prev.startsWith('new|') && state.startsWith('handled|')) {
      markHighlightUnseen(SCOPES.managerHandled, req.id);
      changed = true;
    }
    nextKnown[req.id] = state;
  });

  writeJson(MANAGER_KNOWN_STATES_KEY, nextKnown);
  return changed;
}
