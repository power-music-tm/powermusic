import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '../utils/api';
import { isRateLimitError } from '../utils/pilot2Api';
import { normalizeDirectoryPerson } from '../utils/managerDirectory';
import { readDirectoryCache, writeDirectoryCache } from '../utils/managerDirectoryCache';
import { useBackgroundRefresh } from './useBackgroundRefresh';

function directoryErrorMessage(err) {
  const msg = err?.message || 'Could not load the directory.';
  if (msg.includes('Too many requests')) return null;
  if (msg.includes('Authorization header')) {
    return 'We could not load the directory. Sign out and sign in again.';
  }
  return msg;
}

export function useManagerDirectory(userId, accessToken, { enabled = true, outcome = 'Added', partnerId = null } = {}) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const hasLoadedRef = useRef(false);
  const inFlightRef = useRef(false);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!userId || !accessToken || !enabled) return;
      if (inFlightRef.current) return;

      const cached = readDirectoryCache(userId, outcome, partnerId || '');
      if (cached?.length && !hasLoadedRef.current) {
        setPeople(cached);
        setLoading(false);
      }

      inFlightRef.current = true;
      if (!silent && !hasLoadedRef.current) setLoading(true);

      try {
        const params = new URLSearchParams({ outcome });
        if (partnerId) {
          params.set('partner_id', partnerId);
        }
        const data = await fetchJson(`/api/manager/persons/directory?${params}`);
        const normalized = Array.isArray(data)
          ? data.map(normalizeDirectoryPerson).filter(Boolean)
          : [];
        setPeople(normalized);
        writeDirectoryCache(userId, normalized, outcome, partnerId || '');
        setError(null);
        hasLoadedRef.current = true;
      } catch (err) {
        console.error(err);
        const stale = readDirectoryCache(userId, outcome, partnerId || '');
        if (stale?.length) {
          setPeople(stale);
        } else if (!isRateLimitError(err)) {
          setPeople([]);
          setError(directoryErrorMessage(err));
        }
      } finally {
        setLoading(false);
        inFlightRef.current = false;
      }
    },
    [userId, accessToken, enabled, outcome, partnerId],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    hasLoadedRef.current = false;
    setPeople([]);
    setLoading(true);
    load();
    return undefined;
  }, [enabled, load, outcome, partnerId]);

  useBackgroundRefresh(() => load({ silent: true }), { enabled: enabled && Boolean(userId) });

  return { people, loading, error };
}
