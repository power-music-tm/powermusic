import { normalizeDirectoryPerson } from './managerDirectory';

const CACHE_KEY = 'pm_manager_directory_snapshot';
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheStorageKey(outcome = 'Added', partnerId = '') {
  return `${CACHE_KEY}:${outcome}${partnerId ? `:${partnerId}` : ''}`;
}

export function readDirectoryCache(userId, outcome = 'Added', partnerId = '') {
  if (!userId || typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(cacheStorageKey(outcome, partnerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.userId !== userId || !Array.isArray(parsed.people)) return null;
    if (Date.now() - (parsed.cachedAt || 0) > CACHE_TTL_MS) return null;
    return parsed.people.map(normalizeDirectoryPerson).filter(Boolean);
  } catch {
    return null;
  }
}

export function writeDirectoryCache(userId, people, outcome = 'Added', partnerId = '') {
  if (!userId || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      cacheStorageKey(outcome, partnerId),
      JSON.stringify({
        userId,
        cachedAt: Date.now(),
        people: people.map(normalizeDirectoryPerson).filter(Boolean),
      }),
    );
  } catch {
    /* quota or private mode */
  }
}

export function clearDirectoryCache(outcome) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (outcome) {
      sessionStorage.removeItem(cacheStorageKey(outcome));
      return;
    }
    sessionStorage.removeItem(cacheStorageKey('Added'));
    sessionStorage.removeItem(cacheStorageKey('Removed'));
  } catch {
    /* ignore */
  }
}
