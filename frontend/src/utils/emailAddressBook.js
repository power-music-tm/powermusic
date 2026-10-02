// Derives a lightweight "address book" from the emails already loaded in
// the workspace so the Forward / Reply-all composer can suggest recipients
// without a separate contacts API. Matches Gmail's implicit behavior of
// autocompleting from people you've corresponded with.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(addr) {
  return typeof addr === 'string' && EMAIL_RE.test(addr.trim());
}

/** Parse a free-text recipient string into a de-duplicated address list. */
export function parseRecipientList(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const raw of text.replace(/;/g, ',').split(',')) {
    const addr = raw.trim();
    if (!addr) continue;
    const low = addr.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(addr);
  }
  return out;
}

/** Primary To recipient for a reply / reply-all (mirrors backend send_reply). */
export function getReplyAllPrimaryTo(email) {
  if (!email) return '';
  if (email.isForward && email.originalFromEmail) {
    return email.originalFromEmail.trim();
  }
  return (email.fromEmail || '').trim();
}

/**
 * Everyone who gets a reply-all in Cc — original To/Cc minus Andrea's inbox
 * and the primary recipient. Mirrors gmail.send_reply_all.
 */
export function buildReplyAllCcList(email) {
  if (!email) return [];
  const selfEmail = (email.inbox || '').toLowerCase();
  const primaryLower = getReplyAllPrimaryTo(email).toLowerCase();
  const seen = new Set();
  const out = [];

  for (const addr of [...(email.toEmails || []), ...(email.ccEmails || [])]) {
    if (!addr) continue;
    const trimmed = addr.trim();
    const low = trimmed.toLowerCase();
    if (low === selfEmail || low === primaryLower) continue;
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(trimmed);
  }
  return out;
}

export function formatReplyAllCc(email) {
  return buildReplyAllCcList(email).join(', ');
}

export function seedReplyAllRecipients(email) {
  return {
    to: getReplyAllPrimaryTo(email),
    cc: formatReplyAllCc(email),
  };
}

/** Build address book entries { email, name } from the loaded email set. */
export function buildAddressBook(emails, { excludeInboxes = [] } = {}) {
  const excluded = new Set(excludeInboxes.map((e) => (e || '').toLowerCase()));
  const map = new Map();

  const record = (email, name) => {
    if (!email) return;
    const low = email.toLowerCase();
    if (excluded.has(low)) return;
    if (!EMAIL_RE.test(low)) return;
    // Keep the first (usually best) display-name we see. Names carried on
    // outbound Sent rows are Andrea's — ignore those.
    if (!map.has(low)) map.set(low, { email, name: name || email });
  };

  for (const email of emails || []) {
    if (!email.gmailIsOutbound && email.draftStatus !== 'Sent') {
      record(email.fromEmail, email.from);
    }
    for (const addr of email.toEmails || []) record(addr, addr);
    for (const addr of email.ccEmails || []) record(addr, addr);
    if (email.originalFromEmail) record(email.originalFromEmail, email.originalFromName);
  }

  return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Suggestions for the *current* token the user is typing. Splits on commas
 * so earlier tokens are considered "committed" and only the tail is matched.
 */
export function suggestFor(text, book, { limit = 6 } = {}) {
  if (!book?.length) return { tokenStart: 0, matches: [] };
  const lastCommaIdx = Math.max(text.lastIndexOf(','), text.lastIndexOf(';'));
  const tokenStart = lastCommaIdx + 1;
  const query = text.slice(tokenStart).trim().toLowerCase();
  if (!query) return { tokenStart, matches: [] };
  const already = new Set(parseRecipientList(text.slice(0, tokenStart)).map((a) => a.toLowerCase()));
  const matches = [];
  for (const entry of book) {
    if (matches.length >= limit) break;
    if (already.has(entry.email.toLowerCase())) continue;
    if (
      entry.email.toLowerCase().includes(query) ||
      entry.name.toLowerCase().includes(query)
    ) {
      matches.push(entry);
    }
  }
  return { tokenStart, matches };
}
