// One fetcher, many subscribers for /api/admin/requests/page (per gym).
//
// New Requests and the sidebar badge used to poll this endpoint independently,
// so they raced each other and painted different snapshots. Everything now
// goes through here: triggers are coalesced into one GET, in-flight GETs are
// shared, and every subscriber receives the same server snapshot.
import {
  REQUESTS_PAGE_CACHE_KEY,
  bumpCacheEpoch,
  getNewRequestsPage,
  refreshCache,
} from './pilot2Api.js';

const subscribers = new Set();
const lastFetchStartByKey = new Map();
const lastPublishedByKey = new Map();
const scheduledByKey = new Map();

export function requestsPageCacheKey(partnerId) {
  return partnerId ? `${REQUESTS_PAGE_CACHE_KEY}:${partnerId}` : REQUESTS_PAGE_CACHE_KEY;
}

/** `listener({ partnerId, data })` runs for every fresh server snapshot. */
export function subscribeRequestsPage(listener) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function publish(partnerId, data) {
  const key = requestsPageCacheKey(partnerId);
  const last = lastPublishedByKey.get(key);
  // Joined callers share one response object; never step back to an older GET.
  if (last === data) return;
  if (last && Number(data?.fetchedAt) < Number(last.fetchedAt)) return;
  lastPublishedByKey.set(key, data);
  for (const listener of [...subscribers]) {
    try {
      listener({ partnerId: partnerId || '', data });
    } catch (err) {
      console.error(err);
    }
  }
}

/**
 * Network refetch, shared with any in-flight GET for the same gym.
 * `invalidate: true` = the server said data changed, so a GET that started
 * earlier must not be reused.
 */
export function fetchRequestsPage(partnerId = '', { invalidate = false } = {}) {
  const key = requestsPageCacheKey(partnerId);
  if (invalidate) bumpCacheEpoch(key);
  lastFetchStartByKey.set(key, Date.now());
  return refreshCache(
    key,
    () => getNewRequestsPage(partnerId || ''),
    (data, isStale) => {
      // Stale = cache fallback; pages already painted it on mount.
      if (!isStale) publish(partnerId, data);
    },
  );
}

/**
 * Coalesce bursts (realtime + focus + visibility + polls from several
 * components) into a single GET that starts after the last trigger.
 * `minAgeMs` skips the GET when one started that recently (poll backoff).
 */
export function scheduleRequestsPageRefetch(
  partnerId = '',
  { invalidate = false, minAgeMs = 0, delayMs = 150 } = {},
) {
  const key = requestsPageCacheKey(partnerId);
  const pending = scheduledByKey.get(key);
  if (pending) {
    pending.invalidate = pending.invalidate || invalidate;
    return;
  }
  if (!invalidate && minAgeMs > 0) {
    const lastStart = lastFetchStartByKey.get(key) || 0;
    if (Date.now() - lastStart < minAgeMs) return;
  }
  const entry = { invalidate, timer: null };
  entry.timer = window.setTimeout(() => {
    scheduledByKey.delete(key);
    fetchRequestsPage(partnerId, { invalidate: entry.invalidate }).catch(() => {});
  }, delayMs);
  scheduledByKey.set(key, entry);
}
