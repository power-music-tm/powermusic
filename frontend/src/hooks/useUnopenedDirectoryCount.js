import { useCallback, useEffect, useState } from 'react';
import {
  ADMIN_DIRECTORY_BADGE_EVENT,
  countUnopenedDirectoryPeople,
} from '../utils/adminUiHighlights';

/**
 * Sidebar Directory badge: active Directory additions not opened this session.
 * Archive / Removed rows are never counted (call sites + prune on Directory load).
 */
export function useUnopenedDirectoryCount() {
  const [count, setCount] = useState(() => countUnopenedDirectoryPeople());

  const readLocal = useCallback(() => {
    setCount(countUnopenedDirectoryPeople());
  }, []);

  useEffect(() => {
    const onBadge = () => readLocal();
    window.addEventListener(ADMIN_DIRECTORY_BADGE_EVENT, onBadge);
    return () => window.removeEventListener(ADMIN_DIRECTORY_BADGE_EVENT, onBadge);
  }, [readLocal]);

  useEffect(() => {
    const onFocusOrVisible = () => {
      if (document.hidden) return;
      readLocal();
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [readLocal]);

  return count;
}
