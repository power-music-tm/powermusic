/** Canonical URL Supabase redirects to after magic-link / email confirmation. */
export function getAuthCallbackUrl() {
  return `${window.location.origin}/auth/callback`;
}

/** Supabase default OTP / magic-link lifetime (seconds). Match Dashboard → Auth → Email if changed. */
export const AUTH_LINK_EXPIRY_SECONDS = 3600;

export function getAuthLinkExpiryLabel() {
  const hours = AUTH_LINK_EXPIRY_SECONDS / 3600;
  if (hours >= 1 && Number.isInteger(hours)) {
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  const minutes = Math.round(AUTH_LINK_EXPIRY_SECONDS / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
