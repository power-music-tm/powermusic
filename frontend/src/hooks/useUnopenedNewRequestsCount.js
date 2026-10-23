import { useCallback, useEffect, useRef, useState } from 'react';
import { applyNewRequestsSuppressions, getNewRequestsPage } from '../utils/pilot2Api';
import {
  ADMIN_NEW_REQUESTS_BADGE_EVENT,
  countUnopenedNewRequests,
  syncPendingRequestIdsForBadge,
} from '../utils/adminUiHighlights';
import { useRealtimeBroadcast } from './useRealtimeBroadcast';

const POLL_MS = 60_000;

/**
 * Sidebar badge: queue rows not opened this session.
 * Drops instantly on open; rises when new requests arrive.
 * NewRequests also pushes pending ids via syncPendingRequestIdsForBadge.
 */
export function useUnopenedNewRequestsCount(partnerId) {
  const [count, setCount] = useState(() => countUnopenedNewRequests());
  const partnerRef = useRef(partnerId);
  partnerRef.current = partnerId;

  const readLocal = useCallback(() => {
    setCount(countUnopenedNewRequests());
  }, []);

  const refreshFromNetwork = useCallback(async () => {
    const id = partnerRef.current;
    try {
      const data = await getNewRequestsPage(id || '');
      const requests = applyNewRequestsSuppressions(
        Array.isArray(data?.requests) ? data.requests : [],
      );
      // Only refresh pending ids for the badge — do not re-run highlight bootstrap here.
      syncPendingRequestIdsForBadge(requests.map((row) => row.id), { fetchedAt: data?.fetchedAt });
      setCount(countUnopenedNewRequests());
    } catch {
      readLocal();
    }
  }, [readLocal]);

  useEffect(() => {
    // Partner switch: re-fetch that gym's queue for the badge.
    void refreshFromNetwork();
  }, [partnerId, refreshFromNetwork]);

  useEffect(() => {
    const onBadge = () => readLocal();
    window.addEventListener(ADMIN_NEW_REQUESTS_BADGE_EVENT, onBadge);
    return () => window.removeEventListener(ADMIN_NEW_REQUESTS_BADGE_EVENT, onBadge);
  }, [readLocal]);

  useRealtimeBroadcast('requests-changed', () => {
    if (document.hidden) return;
    void refreshFromNetwork();
  });

  useEffect(() => {
    const onFocusOrVisible = () => {
      if (document.hidden) return;
      void refreshFromNetwork();
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    const poll = window.setInterval(onFocusOrVisible, POLL_MS);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      window.clearInterval(poll);
    };
  }, [refreshFromNetwork]);

  return count;
}
