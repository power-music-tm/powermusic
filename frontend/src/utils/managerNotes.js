export const MANAGER_NOTES_EMPTY_LABEL = 'No notes.';

function isAutomatedNotesBlock(text) {
  const lower = String(text || '').trim().toLowerCase();
  return (
    lower.startsWith('automated roster email')
    || lower.startsWith('automated puregym email')
  );
}

function isSeedNotesBlock(text) {
  return String(text || '').trim().toLowerCase().startsWith('seed:');
}

function isSystemNotesBlock(text) {
  return isAutomatedNotesBlock(text) || isSeedNotesBlock(text);
}

/** Strip seed/automail text; keep only notes the manager entered on the form. */
export function stripAutomatedManagerNotes(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (isSystemNotesBlock(text)) return '';

  const parts = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return text;

  const managerParts = parts.filter((part) => !isSystemNotesBlock(part));
  return managerParts.join('\n\n').trim();
}

export function readAutomatedNotes(source) {
  if (!source) return '';
  const fromMeta = String(source.automatedEmail?.details || '').trim();
  if (fromMeta) return fromMeta;

  const raw = String(source.managerNotes ?? source.notes ?? '').trim();
  if (!raw || isSeedNotesBlock(raw)) return '';
  if (isAutomatedNotesBlock(raw)) return raw;

  const parts = raw
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.filter((part) => isAutomatedNotesBlock(part)).join('\n\n').trim();
}

/** Prefer the stored email subject; fall back to a Subject: line in details. */
export function readAutomatedSubject(source) {
  if (!source) return '';
  const fromMeta = String(source.automatedEmail?.subject || '').trim();
  if (fromMeta) return fromMeta;

  const details = readAutomatedNotes(source);
  if (!details) return '';
  const match = details.match(/(?:^|\n)\s*Subject:\s*(.+?)(?:\n|$)/i);
  if (match) return match[1].trim();
  return '';
}

/** Extract a Leave date value from automatedEmail.details or notes (stored as "Leave date: YYYY-MM-DD"). */
export function readLeaveDate(source) {
  if (!source) return '';
  const candidates = [
    source.automatedEmail?.details,
    source.managerNotes,
    source.notes,
    source.details,
  ];
  for (const text of candidates) {
    if (!text) continue;
    const match = String(text).match(/(?:^|\n)\s*Leave date:\s*(.+?)(?:\r?\n|$)/i);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }
  return '';
}

export function readManagerNotes(source) {
  if (!source) return '';
  const raw = source.managerNotes ?? source.notes ?? '';
  return stripAutomatedManagerNotes(raw);
}

export function formatManagerNotes(source) {
  return readManagerNotes(source) || MANAGER_NOTES_EMPTY_LABEL;
}

export function managerNotesIsEmpty(source) {
  return !readManagerNotes(source);
}
