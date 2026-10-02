import { formatPersonFields, formatPersonName } from './personDisplay';
import { formatAdminDateTime } from './requestDisplayId';
import { formatAttributedManagerFields } from './manualEntry';
import { getPartnerTerminology } from './managerAuthBranding';

export const INTAKE_EVENT_MANAGER = 'manager';
export const INTAKE_EVENT_ADMIN = 'admin';
export const INTAKE_EVENT_AUTO = 'auto_mail';
export const INTAKE_EVENT_DIRECTORY = 'directory';

const EVENT_LABELS = {
  [INTAKE_EVENT_MANAGER]: 'Manager form',
  [INTAKE_EVENT_ADMIN]: 'Admin form',
  [INTAKE_EVENT_AUTO]: 'Auto mail',
  [INTAKE_EVENT_DIRECTORY]: 'Already in directory',
};

const PERSON_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'location', label: 'Location' },
];

function clean(value) {
  if (value == null) return '';
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return '';
  return text;
}

function personFieldMap(person) {
  if (!person) return { name: '', email: '', location: '' };
  return {
    name: formatPersonName(person, { empty: '' }),
    email: clean(person.email),
    location: clean(person.location),
  };
}

export function readIntakeEvents(request) {
  const events = Array.isArray(request?.intakeEvents) ? request.intakeEvents : [];
  return events
    .filter((event) => event && typeof event === 'object' && event.type)
    .slice()
    .sort((a, b) => {
      const aAt = Date.parse(a.at || '') || 0;
      const bAt = Date.parse(b.at || '') || 0;
      return aAt - bAt;
    });
}

export function intakeEventLabel(type) {
  return EVENT_LABELS[type] || 'Intake';
}

export function formatIntakeEventWhen(event) {
  if (!event?.at) return '-';
  return formatAdminDateTime(event.at) || '-';
}

export function intakeEventCounts(events = []) {
  const counts = {
    total: events.length,
    manager: 0,
    admin: 0,
    auto: 0,
    directory: 0,
  };
  events.forEach((event) => {
    if (event.type === INTAKE_EVENT_MANAGER) counts.manager += 1;
    else if (event.type === INTAKE_EVENT_ADMIN) counts.admin += 1;
    else if (event.type === INTAKE_EVENT_AUTO) counts.auto += 1;
    else if (event.type === INTAKE_EVENT_DIRECTORY) counts.directory += 1;
  });
  return counts;
}

/** Compact channel breakdown for headers, e.g. "2 auto · 1 manager · 1 admin". */
export function formatIntakeCountSummary(events = []) {
  const counts = intakeEventCounts(events);
  if (!counts.total) return '';
  const parts = [];
  if (counts.manager) parts.push(`${counts.manager} manager`);
  if (counts.admin) parts.push(`${counts.admin} admin`);
  if (counts.auto) parts.push(`${counts.auto} auto`);
  if (counts.directory) parts.push(`${counts.directory} directory`);
  return parts.join(' · ');
}

export function formatIntakeEventWho(event, options = {}) {
  if (!event) return '';
  if (event.type === INTAKE_EVENT_DIRECTORY) {
    return String(event.meta?.directoryName || '').trim() || 'Directory match';
  }
  if (event.type === INTAKE_EVENT_AUTO) {
    const from = String(event.meta?.fromEmail || '').trim();
    return from || 'Automated email';
  }
  const submitter = formatAttributedManagerFields(event.submittedBy, options);
  if (submitter.hasAny && submitter.rawName) return submitter.rawName;
  if (submitter.hasAny && submitter.rawEmail) return submitter.rawEmail;
  if (event.type === INTAKE_EVENT_ADMIN) return 'Admin';
  const terms = getPartnerTerminology(options.partnerName, options.partnerSlug);
  return terms.managerTerm;
}

export function formatIntakeEventSummary(event) {
  if (!event) return '';
  if (event.type === INTAKE_EVENT_DIRECTORY) {
    const status = String(event.meta?.directoryStatus || '').trim();
    const name = String(event.meta?.directoryName || '').trim();
    if (status && name) return `${status} · ${name}`;
    return status || name || 'Matched in directory';
  }
  if (event.type === INTAKE_EVENT_AUTO) {
    const from = String(event.meta?.fromEmail || '').trim();
    const subject = String(event.meta?.subject || '').trim();
    if (from && subject) return `${from} · ${subject}`;
    return from || subject || 'Automated email';
  }
  const person = formatPersonName(event.person, { empty: '' });
  const email = formatPersonFields(event.person).email;
  if (person && email && email !== 'No email') return `${person} · ${email}`;
  return person || (email !== 'No email' ? email : '') || intakeEventLabel(event.type);
}

/**
 * Fields on this intake that differ from the request's current display person
 * (and previous same-type intake when useful).
 */
export function intakeEventDiffLabels(event, baselinePerson, previousSameTypeEvent = null) {
  if (!event || event.type === INTAKE_EVENT_DIRECTORY) return [];
  const current = personFieldMap(event.person);
  const baseline = personFieldMap(baselinePerson);
  const previous = previousSameTypeEvent ? personFieldMap(previousSameTypeEvent.person) : null;
  const labels = [];

  PERSON_FIELDS.forEach(({ key, label }) => {
    const value = current[key];
    if (!value) return;
    const vsBaseline = baseline[key] && value.toLowerCase() !== baseline[key].toLowerCase();
    const vsPrevious = previous
      && previous[key]
      && value.toLowerCase() !== previous[key].toLowerCase();
    if (vsBaseline || vsPrevious) labels.push(label);
  });

  return labels;
}

export function formatIntakeEventPersonLine(event) {
  if (!event?.person) return '';
  const fields = personFieldMap(event.person);
  return [fields.name, fields.email, fields.location].filter(Boolean).join(' · ');
}

/** Map comparison column keys → intake event types. */
export function channelKeyToEventType(channelKey) {
  if (channelKey === 'manager') return INTAKE_EVENT_MANAGER;
  if (channelKey === 'admin') return INTAKE_EVENT_ADMIN;
  if (channelKey === 'auto') return INTAKE_EVENT_AUTO;
  if (channelKey === 'directory') return INTAKE_EVENT_DIRECTORY;
  return null;
}

export function eventsForChannel(events = [], channelKey) {
  const type = channelKeyToEventType(channelKey);
  if (!type) return [];
  return events.filter((event) => event.type === type);
}

/**
 * Cue for a comparison column when a channel has multiple intakes, e.g. "3 autos · 2 differ".
 * Returns null when there is nothing extra to show (0–1 intake, no within-channel diffs).
 */
export function summarizeChannelIntakes(events = [], channelKey, baselinePerson = null) {
  const channelEvents = eventsForChannel(events, channelKey);
  const count = channelEvents.length;
  if (count <= 1) return null;

  let differing = 0;
  let previous = null;
  channelEvents.forEach((event) => {
    if (intakeEventDiffLabels(event, baselinePerson, previous).length > 0) {
      differing += 1;
    }
    previous = event;
  });

  const nouns = {
    manager: ['manager', 'managers'],
    admin: ['admin', 'admins'],
    auto: ['auto', 'autos'],
    directory: ['directory', 'directory'],
  };
  const [one, many] = nouns[channelKey] || ['intake', 'intakes'];
  const countLabel = `${count} ${count === 1 ? one : many}`;
  const cue = differing > 0
    ? `${countLabel} · ${differing} differ`
    : countLabel;

  return {
    channelKey,
    count,
    differing,
    cue,
    events: channelEvents,
  };
}
