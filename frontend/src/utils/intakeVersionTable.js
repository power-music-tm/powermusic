import { getPartnerTerminology } from './managerAuthBranding';
import { formatAttributedManagerFields } from './manualEntry';
import { formatPersonName } from './personDisplay';
import {
  formatIntakeEventWhen,
  intakeEventLabel,
  INTAKE_EVENT_AUTO,
  INTAKE_EVENT_DIRECTORY,
  channelKeyToEventType,
  eventsForChannel,
} from './intakeEvents';

function clean(value) {
  if (value == null) return '';
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return '';
  return text;
}

function personParts(person) {
  return {
    name: formatPersonName(person, { empty: '' }),
    email: clean(person?.email),
    location: clean(person?.location),
  };
}

function submitterParts(event, fallbackSubmittedBy) {
  const source = event?.submittedBy || fallbackSubmittedBy || null;
  const fields = formatAttributedManagerFields(source);
  return {
    managerName: fields.rawName || '',
    managerEmail: fields.rawEmail || '',
    managerLocation: fields.rawClub || '',
  };
}

const DIRECTORY_ROWS = [
  { key: 'matchedAt', label: 'Matched at' },
  { key: 'directoryName', label: 'Directory name' },
  { key: 'directoryStatus', label: 'Status' },
  { key: 'directoryId', label: 'Directory id', mono: true },
];

function rowsForChannel(channelKey, terms = getPartnerTerminology()) {
  const mTerm = terms.managerTerm;
  const lTerm = terms.locationTerm;
  const lTermLower = terms.locationTermLower;

  if (channelKey === 'auto') {
    return [
      { key: 'receivedAt', label: 'Received at' },
      { key: 'fromEmail', label: 'Received from', mono: true },
      { key: 'inboxEmail', label: 'Sent to (inbox)', mono: true },
      { key: 'subject', label: 'Subject' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email', mono: true },
      { key: 'location', label: lTerm },
      { key: 'details', label: 'Details' },
    ];
  }
  if (channelKey === 'admin' || channelKey === 'manager') {
    return [
      { key: 'submittedAt', label: 'Submitted at' },
      { key: 'managerName', label: `${mTerm} name` },
      { key: 'managerEmail', label: `${mTerm} email`, mono: true },
      { key: 'managerLocation', label: `${mTerm} ${lTermLower}` },
      { key: 'name', label: 'Person name' },
      { key: 'email', label: 'Person email', mono: true },
      { key: 'location', label: `Person ${lTermLower}` },
      { key: 'notes', label: 'Notes' },
    ];
  }
  return DIRECTORY_ROWS;
}

/**
 * Build a comparison-style table for versions of one channel.
 * Columns = each intake (#1, #2…); rows = channel-specific fields.
 */
export function buildChannelVersionTable(
  events,
  channelKey,
  {
    fallbackManagerSubmittedBy = null,
    fallbackAdminSubmittedBy = null,
    partnerName = null,
    partnerSlug = null,
  } = {},
) {
  const type = channelKeyToEventType(channelKey);
  const channelEvents = Array.isArray(events)
    ? (type ? events.filter((e) => e.type === type) : events)
    : [];
  if (!channelEvents.length) return null;

  const fallbackSubmittedBy = channelKey === 'admin'
    ? fallbackAdminSubmittedBy
    : channelKey === 'manager'
      ? fallbackManagerSubmittedBy
      : null;

  const terms = getPartnerTerminology(partnerName, partnerSlug);
  const channelRows = rowsForChannel(channelKey, terms);
  const shortLabel = intakeEventLabel(type || channelEvents[0]?.type);
  const sources = channelEvents.map((event, index) => ({
    key: event.id || `${channelKey}-${index}`,
    title: channelEvents.length > 1 ? `${shortLabel} #${index + 1}` : shortLabel,
    caption: formatIntakeEventWhen(event),
    values: valuesForEvent(event, channelKey, fallbackSubmittedBy),
  }));

  const fieldRows = channelRows.filter(({ key }) =>
    sources.some((source) => clean(source.values[key])),
  );

  return {
    channelKey,
    title: shortLabel,
    fieldRows: fieldRows.length ? fieldRows : channelRows,
    sources,
  };
}

/** Group all intakes into one version-table per channel (manager → admin → auto → directory). */
export function buildAllChannelVersionTables(
  events,
  fallbacks = {},
) {
  const order = ['manager', 'admin', 'auto', 'directory'];
  return order
    .map((channelKey) => {
      const channelEvents = eventsForChannel(events, channelKey);
      if (!channelEvents.length) return null;
      return buildChannelVersionTable(channelEvents, channelKey, fallbacks);
    })
    .filter(Boolean);
}
