import { isSupabaseConfigured, SUPABASE_AUTH_STORAGE_KEY } from '../supabaseClient';
import { readAuthCache } from './authCache';

function getLegacyStorageKey() {
  const url = import.meta.env.VITE_SUPABASE_URL || '';
  try {
    const ref = new URL(url).hostname.split('.')[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
}

/** True when the session's access token is already (or almost) expired. */
export function isSessionExpired(session) {
  const exp = session?.expires_at;
  if (typeof exp !== 'number') return false;
  return exp * 1000 <= Date.now() + 30_000; // 30s safety margin
}

function parseStoredSession(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    let session = null;
    if (parsed?.access_token && parsed?.user) session = parsed;
    else if (parsed?.currentSession?.access_token) session = parsed.currentSession;
    else if (parsed?.session?.access_token) session = parsed.session;
    // An expired token must never drive the UI or API calls (it renders a
    // dashboard whose every request 401s). The Supabase client still owns the
    // raw storage entry and can silently refresh it — we just don't trust it.
    if (session && isSessionExpired(session)) return null;
    return session;
  } catch {
    return null;
  }
}

/** Read Supabase session from localStorage synchronously (before first paint). */
export function readStoredSession() {
  if (typeof window === 'undefined') return null;

  const keys = [SUPABASE_AUTH_STORAGE_KEY];
  const legacyKey = getLegacyStorageKey();
  if (legacyKey && legacyKey !== SUPABASE_AUTH_STORAGE_KEY) {
    keys.push(legacyKey);
  }

  for (const key of keys) {
    const raw = localStorage.getItem(key);
    const session = parseStoredSession(raw);
    if (!session) continue;

    if (key !== SUPABASE_AUTH_STORAGE_KEY && raw) {
      localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, raw);
      localStorage.removeItem(key);
    }

    return session;
  }

  return null;
}

/** Remove persisted Supabase session keys from localStorage. */
export function clearStoredSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
  const legacyKey = getLegacyStorageKey();
  if (legacyKey) localStorage.removeItem(legacyKey);
}

/**
 * Instant auth state for React initial render — same idea as Facebook reading
 * the session cookie before painting the page.
 */
export function readInitialAuthState() {
  if (!isSupabaseConfigured()) {
    return { user: null, session: null, role: null, profile: null };
  }

  const session = readStoredSession();
  const user = session?.user ?? null;

  if (!user) {
    return { user: null, session: null, role: null, profile: null };
  }

  const cached = readAuthCache(user.id);
  return {
    user,
    session,
    role: cached?.role ?? null,
    profile: cached?.profile ?? null,
  };
}
