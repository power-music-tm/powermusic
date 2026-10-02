const STORAGE_KEY = 'pilot2_selected_inbox';

export function readSelectedInbox() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function writeSelectedInbox(email) {
  if (!email) return;
  try {
    localStorage.setItem(STORAGE_KEY, email);
  } catch {
    /* quota / private mode */
  }
}

/** Pick the inbox both Email responses and Templates should show. */
export function resolveSelectedInbox(inboxRows, preferred = '') {
  const rows = inboxRows || [];
  if (!rows.length) return '';

  const exists = (email) =>
    email && rows.some((row) => row.email === email) ? email : null;

  const stored = exists(preferred || readSelectedInbox());
  if (stored) return stored;

  const connected = rows.filter((row) => row.status === 'Connected');
  if (connected.length) return connected[0].email;

  return rows[0]?.email || '';
}
