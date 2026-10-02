import { useEffect, useRef } from 'react';
import { getSupabase } from '../supabaseClient';

export const REALTIME_CHANNEL =
  import.meta.env.VITE_PILOT2_REALTIME_CHANNEL || 'pilot2-workspace';

/**
 * Subscribe to a Supabase Realtime broadcast nudge on the shared workspace channel.
 * Uses a private channel + JWT so it works when public Realtime access is disabled.
 */
export function useRealtimeBroadcast(event, onEvent, { enabled = true } = {}) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return undefined;

    const sb = getSupabase();
    if (!sb) return undefined;

    let cancelled = false;
    let channel = null;
    let authSubscription = null;

    const subscribe = async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (session?.access_token) {
        await sb.realtime.setAuth(session.access_token);
      }

      if (cancelled) return;

      channel = sb
        .channel(REALTIME_CHANNEL, { config: { private: true } })
        .on('broadcast', { event }, () => {
          if (!cancelled) onEventRef.current?.();
        })
        .subscribe();
    };

    void subscribe();

    const { data } = sb.auth.onAuthStateChange((_authEvent, session) => {
      if (session?.access_token) {
        void sb.realtime.setAuth(session.access_token);
      }
    });
    authSubscription = data.subscription;

    return () => {
      cancelled = true;
      authSubscription?.unsubscribe();
      if (channel) sb.removeChannel(channel);
    };
  }, [enabled, event]);
}
