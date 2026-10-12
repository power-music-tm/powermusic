/** Comma-separated admin emails allowed to request a magic link (lowercase). */
export function getAdminAllowlist() {
  const raw =
    (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_ADMIN_ALLOWED_EMAILS) ||
    'andrea@powermusic.com';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return getAdminAllowlist().includes((email || '').trim().toLowerCase());
}
