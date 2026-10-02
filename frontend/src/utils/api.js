// Backend base URL.
// - Local dev: same-origin /api/* via Vite proxy (see vite.config.js).
// - VITE_API_URL overrides both if the backend ever lives elsewhere.
const API_BASE =
  import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : '');

const DEFAULT_TIMEOUT_MS = import.meta.env.PROD ? 45000 : 12000;

const DEV_BACKEND_HINT =
  'Check that the backend is running: cd backend && .venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000';

function timeoutErrorMessage() {
  if (import.meta.env.PROD) {
    return 'The server is taking longer than usual. Please wait a moment and refresh, or try again shortly.';
  }
  return `The API did not respond in time. ${DEV_BACKEND_HINT}`;
}

function networkErrorMessage() {
  if (import.meta.env.PROD) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return `Could not reach the API. Start the backend: ${DEV_BACKEND_HINT}`;
}

let accessTokenProvider = null;

/** Register a function that returns the current Supabase access token (or null). */
export function setAccessTokenProvider(provider) {
  accessTokenProvider = provider;
}

export const getApiUrl = (path) => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
};

import { readStoredSession } from './authBootstrap';

function getActivePartnerContext() {
  if (typeof window === 'undefined') return {};
  try {
    const rawIntro = sessionStorage.getItem('manager-portal-intro-branding');
    if (rawIntro) {
      const parsed = JSON.parse(rawIntro);
      if (parsed?.partnerId) {
        return { partnerId: parsed.partnerId };
      }
    }
    const slug = sessionStorage.getItem('manager-intended-partner-slug');
    if (slug) {
      const slugKey = `pm_cache_partner_branding_${slug}`;
      const slugCached = sessionStorage.getItem(slugKey) || (typeof localStorage !== 'undefined' ? localStorage.getItem(slugKey) : null);
      if (slugCached) {
        const parsedSlug = JSON.parse(slugCached);
        if (parsedSlug?.partnerId) {
          return { partnerId: parsedSlug.partnerId, partnerSlug: slug };
        }
      }
      return { partnerSlug: slug };
    }
  } catch {
    /* ignore */
  }
  return {};
}

async function buildAuthHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };

  const partnerCtx = getActivePartnerContext();
  if (partnerCtx.partnerId && !headers['X-Partner-Id']) {
    headers['X-Partner-Id'] = partnerCtx.partnerId;
  }
  if (partnerCtx.partnerSlug && !headers['X-Partner-Slug']) {
    headers['X-Partner-Slug'] = partnerCtx.partnerSlug;
  }

  if (accessTokenProvider) {
    try {
      const token = await accessTokenProvider();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
        return headers;
      }
    } catch {
      /* fall through to stored session */
    }
  }

  const stored = readStoredSession();
  if (stored?.access_token) {
    headers.Authorization = `Bearer ${stored.access_token}`;
  }

  return headers;
}

function isUserAbort(err, userSignal) {
  return err?.name === 'AbortError' && userSignal?.aborted;
}

function formatApiErrorDetail(detail) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((entry) => entry?.msg || 'Invalid request').join(' ');
  }
  if (detail && typeof detail === 'object' && detail.msg) return detail.msg;
  return JSON.stringify(detail);
}

/** Fetch JSON from the API; throws with server `detail` on non-2xx. */
export async function fetchJson(path, options = {}) {
  const { signal: userSignal, timeout = DEFAULT_TIMEOUT_MS, ...rest } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);

  const onUserAbort = () => controller.abort();
  if (userSignal) {
    if (userSignal.aborted) controller.abort();
    else userSignal.addEventListener('abort', onUserAbort);
  }

  try {
    const headers = await buildAuthHeaders(rest.headers || {});
    const res = await fetch(getApiUrl(path), {
      cache: 'no-store',
      ...rest,
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail ?? detail;
      } catch {
        /* keep statusText */
      }
      if (res.status === 401 && headers.Authorization) {
        // Token was sent and rejected (expired/invalid). Sign the user out.
        // Skip when no Bearer was attached — that is often a race (e.g. an
        // admin-only call before role is known), not a dead session.
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      }
      throw new Error(formatApiErrorDetail(detail));
    }
    return res.json();
  } catch (err) {
    if (isUserAbort(err, userSignal)) throw err;
    if (err?.name === 'AbortError') {
      throw new Error(timeoutErrorMessage());
    }
    if (err instanceof TypeError) {
      throw new Error(networkErrorMessage());
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
    if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
  }
}

/** Authenticated fetch for non-JSON responses or custom handling. */
export async function authFetch(path, options = {}) {
  const headers = await buildAuthHeaders(options.headers || {});
  return fetch(getApiUrl(path), { ...options, headers });
}

export default API_BASE;
