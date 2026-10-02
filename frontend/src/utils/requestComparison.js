import { TAG_AUTO_MAIL, TAG_PARTNER_REQUEST, TAG_SENT_BY_ADMIN } from './requestTags';

export function hasDiffs(match) {
  return Boolean(match?.fields?.some((field) => field.status === 'differs'));
}

function normPersonPart(value) {
  return String(value || '').trim().toLowerCase();
}

function personDisplayName(person) {
  if (!person) return '';
  const first = (person.firstName || '').trim();
  const last = (person.lastName || '').trim();
  return [first, last].filter((part) => part && part.toLowerCase() !== 'null').join(' ');
}

/** True when admin person fields disagree with partner (left) or auto (right) intake values. */
export function hasAdminPersonDiffs(adminPerson, intakeMatch) {
  if (!adminPerson) return false;
  const adminName = normPersonPart(personDisplayName(adminPerson));
  const adminEmail = normPersonPart(adminPerson.email);
  const adminLocation = normPersonPart(adminPerson.location);
  if (!adminName && !adminEmail && !adminLocation) return false;

  const fields = intakeMatch?.fields || [];
  const sides = ['leftValue', 'rightValue'];
  for (const side of sides) {
    const name = normPersonPart(fields.find((f) => f.field === 'name')?.[side]);
    const email = normPersonPart(fields.find((f) => f.field === 'email')?.[side]);
    const location = normPersonPart(fields.find((f) => f.field === 'location')?.[side]);
    if (!name && !email && !location) continue;
    if (
      (adminName && name && adminName !== name)
      || (adminEmail && email && adminEmail !== email)
      || (adminLocation && location && adminLocation !== location)
    ) {
      return true;
    }
  }
  return false;
}

export function hasComparisonContext(intakeMatch, directoryMatch, tags = [], adminPerson = null) {
  if (intakeMatch || directoryMatch || adminPerson) return true;
  const list = tags || [];
  return list.includes(TAG_AUTO_MAIL)
    || list.includes(TAG_PARTNER_REQUEST)
    || list.includes(TAG_SENT_BY_ADMIN);
}

/**
 * True when the detail matrix would have 2+ source columns
 * (manager form, admin form, automated email, and/or directory).
 */
export function hasMultipleComparisonSources({
  tags = [],
  intakeMatch = null,
  directoryMatch = null,
  hasAutoMail = false,
  adminPerson = null,
} = {}) {
  const list = tags || [];
  const hasAdminOverlay = list.includes(TAG_SENT_BY_ADMIN) || Boolean(adminPerson);
  const hasManagerForm = list.includes(TAG_PARTNER_REQUEST)
    || Boolean(intakeMatch?.fields?.some((field) => (field.leftValue || '').trim()));
  const hasAuto = hasAutoMail
    || list.includes(TAG_AUTO_MAIL)
    || Boolean(intakeMatch?.fields?.some((field) => (field.rightValue || '').trim()));
  const hasDirectory = Boolean(directoryMatch);
  // Overlay adds a distinct Admin form column alongside Manager request.
  const managerCol = hasManagerForm;
  const adminCol = hasAdminOverlay;
  return [managerCol, adminCol, hasAuto, hasDirectory].filter(Boolean).length >= 2;
}

/** Auto-mail receipt from a directory person's timeline (may predate this request). */
export function autoMailFromDirectoryRecord(directoryRecord) {
  const history = Array.isArray(directoryRecord?.requestHistory)
    ? directoryRecord.requestHistory
    : [];
  const autoEvent = history.find((event) => event?.type === 'auto_mail');
  if (!autoEvent) return null;
  return {
    fromEmail: (autoEvent.fromEmail || '').trim(),
    subject: (autoEvent.subject || autoEvent.detail || '').trim(),
    receivedAt: autoEvent.at || null,
    inboxEmail: (autoEvent.inboxEmail || '').trim(),
  };
}

export function hasAnyDataDiffs(intakeMatch, directoryMatch, adminPerson = null) {
  return hasDiffs(intakeMatch)
    || hasDiffs(directoryMatch)
    || hasAdminPersonDiffs(adminPerson, intakeMatch);
}

export function differingFields(match) {
  return (match?.fields || []).filter((field) => field.status === 'differs');
}

export function matchingFields(match) {
  return (match?.fields || []).filter((field) => field.status === 'same');
}

export function formatFieldList(labels) {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
