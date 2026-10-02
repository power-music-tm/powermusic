const KEY = 'manager-intended-partner-slug';

export function setManagerIntendedPartnerSlug(slug) {
  const value = String(slug || '').trim().toLowerCase();
  if (!value) return;
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    /* ignore */
  }
}

export function readManagerIntendedPartnerSlug() {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function clearManagerIntendedPartnerSlug() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
