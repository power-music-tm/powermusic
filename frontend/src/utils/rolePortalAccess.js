import { isAdminEmail } from './adminAccess';
import { readAuthCache } from './authCache';

export function readCachedAuthRole(userId) {
  if (!userId) return null;
  return readAuthCache(userId)?.role ?? null;
}

export function isLikelyAdminSession(user, role) {
  if (role === 'admin') return true;
  if (user?.email && isAdminEmail(user.email)) return true;
  return readCachedAuthRole(user?.id) === 'admin';
}

export function isLikelyManagerSession(user, role) {
  if (role === 'manager') return true;
  return readCachedAuthRole(user?.id) === 'manager';
}

/** True when session is admin and must not enter manager portal routes. */
export function isAdminOnManagerPortal(user, role) {
  return Boolean(user && isLikelyAdminSession(user, role) && !isLikelyManagerSession(user, role));
}

/** True when session is manager and must not enter admin portal routes. */
export function isManagerOnAdminPortal(user, role) {
  return Boolean(user && isLikelyManagerSession(user, role) && !isLikelyAdminSession(user, role));
}
