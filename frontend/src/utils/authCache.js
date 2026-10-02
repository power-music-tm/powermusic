const CACHE_KEY = 'powerMusicOps.authProfile';
const LEGACY_SESSION_CACHE_KEY = 'powerMusicOps.authProfile';

function readRawCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return raw;
    const legacy = sessionStorage.getItem(LEGACY_SESSION_CACHE_KEY);
    if (legacy) {
      localStorage.setItem(CACHE_KEY, legacy);
      sessionStorage.removeItem(LEGACY_SESSION_CACHE_KEY);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

export function readAuthCache(userId) {
  try {
    const raw = readRawCache();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.userId !== userId || !parsed.profile?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeAuthCache(userId, profile) {
  if (!userId || !profile?.role) return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        userId,
        role: profile.role,
        profile,
        cachedAt: Date.now(),
      }),
    );
  } catch {
    // ignore quota / private mode
  }
}

export function clearAuthCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_CACHE_KEY);
  } catch {
    // ignore
  }
}
