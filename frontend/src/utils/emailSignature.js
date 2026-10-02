export const SIGNATURE_PERSON = 'Andrea Petty';
export const SIGNATURE_COMPANY = 'Power Music Inc.';
export const LEGACY_SIGNATURE = 'Kind regards,\nPower Music Team';

const LEGACY_SIGNATURE_RE = /\n*Kind regards,?\s*\n\s*Power Music Team\s*$/i;
const NEW_SIGNATURE_MARKER = `Thank you.\n\n${SIGNATURE_PERSON}`;

// Any 3-line block that opens with "Andrea Petty" and closes with "Power Music Inc." —
// captures every duplicate the model might have baked into the body, regardless
// of which inbox title sits between them.
const EMBEDDED_SIG_BLOCK_RE = /Andrea Petty[ \t]*\n[^\n]*\n[ \t]*Power Music(?:\s*Inc\.?)?[ \t]*/gi;
// Standalone "Thank you." / "Thanks." lines that belong to the closing.
const THANK_YOU_LINE_RE = /^[ \t]*(thank you|thanks)[.!]?[ \t]*$/gim;
// Leading greeting the composer emits: "Hi Xxx," / "Hello Xxx," / "Hey Xxx," / "Dear Xxx," at start.
const LEADING_GREETING_RE = /^[ \t]*(hi|hello|hey|dear)\b[^\n]*[,!]?[ \t]*\n+/i;

export function buildEmailSignature(inboxTitle) {
  const title = (inboxTitle || '').trim() || 'Power Music';
  return `Thank you.\n\n${SIGNATURE_PERSON}\n${title}\n${SIGNATURE_COMPANY}`;
}

export function resolveInboxTitle(inboxes, accountEmail) {
  const match = (inboxes || []).find((row) => row.email === accountEmail);
  return match?.title?.trim() || accountEmail || 'Power Music';
}

/** Remove lines that open with thank-you phrasing (signature handles closing thanks). */
export function stripGratitudePhrases(text) {
  if (!text?.trim()) return text;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return !/^(thanks|thank you)\b/i.test(trimmed);
  });
  return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function stripLegacySignature(text) {
  return text.replace(/\r\n/g, '\n').replace(LEGACY_SIGNATURE_RE, '').trimEnd();
}

export function hasNewSignature(text) {
  return text.includes(NEW_SIGNATURE_MARKER);
}

// The greeting and the sign-off are owned by the render layer, not the model.
// Everything the model returns is squeezed through this so any embedded signature
// blocks, leading greetings, and trailing "Thank you." lines are stripped —
// even if the model repeats them several times.
export function extractDraftBody(rawBody) {
  if (!rawBody?.trim()) return '';
  let text = rawBody.replace(/\r\n/g, '\n');
  text = text.replace(LEGACY_SIGNATURE_RE, '');
  text = text.replace(EMBEDDED_SIG_BLOCK_RE, '');
  text = text.replace(THANK_YOU_LINE_RE, '');
  text = text.replace(LEADING_GREETING_RE, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/** Normalize stored drafts: strip embedded/legacy signatures + gratitudes, then re-close with the canonical inbox signature. */
export function normalizeDraftSignature(body, inboxTitle) {
  const stripped = extractDraftBody(body);
  if (!stripped) return body;
  return `${stripped}\n\n${buildEmailSignature(inboxTitle)}`;
}

export function splitDraftBody(body, inboxTitle) {
  const text = normalizeDraftSignature(body, inboxTitle);
  const signature = buildEmailSignature(inboxTitle);
  if (text.endsWith(signature)) {
    const main = text.slice(0, text.length - signature.length).replace(/\s+$/, '');
    return { main, signature };
  }
  return { main: text, signature: null };
}

/** Full outbound reply text: greeting + editable middle + canonical signature. */
export function composeOutboundReply(body, inboxTitle, firstName) {
  const title = (inboxTitle || '').trim() || 'Power Music';
  const greetingName = (firstName || '').trim() || 'there';
  const middle = extractDraftBody(body);
  const signature = buildEmailSignature(title);
  if (!middle) {
    return body?.trim() ? body : `Hi ${greetingName},\n\n${signature}`;
  }
  return `Hi ${greetingName},\n\n${middle}\n\n${signature}`;
}
