import { useEffect } from 'react';

/** Silent refresh on tab focus and on an interval (same pattern as admin pages). */
export function useBackgroundRefresh(callback, { enabled = true, intervalMs = 60000 } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;

    const tick = () => {
      if (!document.hidden) callback();
    };

    window.addEventListener('focus', tick);
    const interval = window.setInterval(tick, intervalMs);
    return () => {
      window.removeEventListener('focus', tick);
      window.clearInterval(interval);
    };
  }, [callback, enabled, intervalMs]);
}
