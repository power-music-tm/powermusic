/** Comma-separated admin emails allowed to request a magic link (lowercase).
 *  Set VITE_ADMIN_ALLOWED_EMAILS in frontend/.env.local and Vercel — no hardcoded default.
 */
export function getAdminAllowlist() {
  const raw =
    (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_ADMIN_ALLOWED_EMAILS) || '';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return getAdminAllowlist().includes((email || '').trim().toLowerCase());
}
