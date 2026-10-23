import { useCallback, useEffect, useRef, useState } from 'react';
import { applyNewRequestsSuppressions } from '../utils/pilot2Api';
import {
  fetchRequestsPage,
  scheduleRequestsPageRefetch,
  subscribeRequestsPage,
} from '../utils/requestsPageStore';
import {
  ADMIN_NEW_REQUESTS_BADGE_EVENT,
  countUnopenedNewRequests,
  syncPendingRequestIdsForBadge,
} from '../utils/adminUiHighlights';
import { useRealtimeBroadcast } from './useRealtimeBroadcast';

/** Backup when realtime is quiet — local suppress/open already update instantly. */
const POLL_MS = 15_000;

/**
 * Sidebar badge: queue rows not opened this session.
 * Drops instantly on open; rises when new requests arrive.
 * Shares New Requests' GETs via requestsPageStore, so both show one snapshot.
 */
export function useUnopenedNewRequestsCount(partnerId) {
  const [count, setCount] = useState(() => countUnopenedNewRequests());
  const partnerRef = useRef(partnerId);
  partnerRef.current = partnerId;

  const readLocal = useCallback(() => {
    setCount(countUnopenedNewRequests());
  }, []);

  useEffect(() => subscribeRequestsPage(({ partnerId: forPartnerId, data }) => {
    if (String(forPartnerId || '') !== String(partnerRef.current || '')) return;
    const requests = applyNewRequestsSuppressions(
      Array.isArray(data?.requests) ? data.requests : [],
    );
    // Only refresh pending ids for the badge — do not re-run highlight bootstrap here.
    syncPendingRequestIdsForBadge(requests.map((row) => row.id), { fetchedAt: data?.fetchedAt });
    setCount(countUnopenedNewRequests());
  }), []);

  useEffect(() => {
    // Partner switch: re-fetch that gym's queue for the badge.
    fetchRequestsPage(partnerId || '').catch(() => readLocal());
  }, [partnerId, readLocal]);

  useEffect(() => {
    const onBadge = () => readLocal();
    window.addEventListener(ADMIN_NEW_REQUESTS_BADGE_EVENT, onBadge);
    return () => window.removeEventListener(ADMIN_NEW_REQUESTS_BADGE_EVENT, onBadge);
  }, [readLocal]);

  useRealtimeBroadcast('requests-changed', () => {
    if (document.hidden) return;
    scheduleRequestsPageRefetch(partnerRef.current || '', { invalidate: true });
  });

  useEffect(() => {
    const onFocusOrVisible = () => {
      if (document.hidden) return;
      scheduleRequestsPageRefetch(partnerRef.current || '');
    };
    const onPoll = () => {
      if (document.hidden) return;
      scheduleRequestsPageRefetch(partnerRef.current || '', { minAgeMs: POLL_MS - 1000 });
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    const poll = window.setInterval(onPoll, POLL_MS);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      window.clearInterval(poll);
    };
  }, []);

  return count;
}
