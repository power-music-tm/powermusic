/**
 * Resolve the admin's visible name from server profile first, then auth metadata.
 * Never invent a personal name like "Andrea".
 */
export function resolveAdminDisplayName(profile, user) {
  const full = (profile?.full_name || '').trim();
  if (full) return full;

  const meta = (
    user?.user_metadata?.full_name
    || user?.user_metadata?.firstName
    || ''
  ).trim();
  if (meta) return meta;

  const email = (profile?.email || user?.email || '').trim();
  const local = email.includes('@') ? email.split('@')[0].trim() : '';
  if (local) return local;

  return 'Admin';
}

/** First name / greeting token for "Hello X." and welcome splash. */
export function resolveAdminFirstName(profile, user) {
  const first = (profile?.first_name || '').trim();
  if (first) return first;

  const full = resolveAdminDisplayName(profile, user);
  const part = full.split(/\s+/).filter(Boolean)[0] || '';
  return part || full;
}
