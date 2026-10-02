/**
 * Timezone-aware display helpers.
 * Store UTC on the server; format in Mountain Time (America/Denver) for Andrea / Admin Dashboard.
 *
 * All users of this application operate within the same timezone, so every
 * timestamp is displayed in Mountain Time (America/Denver) regardless of
 * the viewer's browser or device settings.
 */

const APP_TIMEZONE = 'America/Denver';

export function getUserTimeZone() {
  return APP_TIMEZONE;
}

export function getUserTimeZoneLabel(timeZone = getUserTimeZone()) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone,
      timeZoneName: 'long',
    }).formatToParts(new Date());
    return parts.find((part) => part.type === 'timeZoneName')?.value || timeZone;
  } catch {
    return timeZone;
  }
}

function parseInstant(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calendarKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function isTodayInTimeZone(date, timeZone = getUserTimeZone()) {
  return calendarKey(date, timeZone) === calendarKey(new Date(), timeZone);
}

export function isYesterdayInTimeZone(date, timeZone = getUserTimeZone()) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return calendarKey(date, timeZone) === calendarKey(yesterday, timeZone);
}

export function formatDateTime(isoString, options = {}, timeZone = getUserTimeZone()) {
  const date = parseInstant(isoString);
  if (!date) return isoString || '';
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(date);
  } catch {
    return isoString;
  }
}

export function formatAdminDateTime(isoString, timeZone = getUserTimeZone()) {
  return formatDateTime(isoString, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }, timeZone);
}

export function formatAdminDate(isoString, timeZone = getUserTimeZone()) {
  return formatDateTime(isoString, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }, timeZone);
}

export function formatListTime(isoString, timeZone = getUserTimeZone()) {
  const date = parseInstant(isoString);
  if (!date) return isoString || '';
  if (isTodayInTimeZone(date, timeZone)) {
    return formatDateTime(isoString, { hour: 'numeric', minute: '2-digit', hour12: true }, timeZone);
  }
  if (isYesterdayInTimeZone(date, timeZone)) return 'Yesterday';
  return formatDateTime(isoString, { day: 'numeric', month: 'short' }, timeZone);
}

export function formatDetailTime(isoString, timeZone = getUserTimeZone()) {
  return formatDateTime(isoString, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }, timeZone);
}

export function getDateGroupLabel(isoString, timeZone = getUserTimeZone()) {
  const date = parseInstant(isoString);
  if (!date) return 'Earlier';
  if (isTodayInTimeZone(date, timeZone)) return 'Today';
  if (isYesterdayInTimeZone(date, timeZone)) return 'Yesterday';
  return formatDateTime(isoString, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }, timeZone);
}

// ─── Additional helpers (replace scattered date-fns format() calls) ──────────

/** "d MMM yyyy" — e.g. "5 Jun 2025" */
export function formatShortDate(isoString, timeZone = getUserTimeZone()) {
  return formatDateTime(isoString, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }, timeZone);
}

/** "dd MMM yyyy, hh:mm a" — e.g. "24 Jun 2025, 02:15 PM" */
export function formatShortDateAndTime(isoString, timeZone = getUserTimeZone()) {
  return formatDateTime(isoString, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }, timeZone);
}

/** "HH:mm" — e.g. "14:30" (24-hour) */
export function formatTimeOnly(isoString, timeZone = getUserTimeZone()) {
  return formatDateTime(isoString, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }, timeZone);
}

/** "h:mm a · d MMM" — e.g. "2:30 PM · 5 Jun" (ReplyTargetPicker style) */
export function formatDayTimeShort(isoString, timeZone = getUserTimeZone()) {
  const date = parseInstant(isoString);
  if (!date) return isoString || '';
  try {
    const timePart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
    const datePart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      day: 'numeric',
      month: 'short',
    }).format(date);
    return `${timePart} · ${datePart}`;
  } catch {
    return isoString;
  }
}

/** "EEE, d MMM · HH:mm" — e.g. "Tue, 5 Jun · 14:30" (ThreadHistory style) */
export function formatWeekdayDayTime(isoString, timeZone = getUserTimeZone()) {
  const date = parseInstant(isoString);
  if (!date) return isoString || '';
  try {
    const dayPart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date);
    const timePart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
    return `${dayPart} · ${timePart}`;
  } catch {
    return isoString;
  }
}

/** { date: "dd MMM yyyy", time: "hh:mm a" } — table timestamp split */
export function formatTimestampSplit(isoString, timeZone = getUserTimeZone()) {
  const date = parseInstant(isoString);
  if (!date) return { date: isoString || '', time: '' };
  try {
    const datePart = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
    const timePart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
    return { date: datePart, time: timePart };
  } catch {
    return { date: isoString, time: '' };
  }
}

/** "dd MMM yyyy at HH:mm" — e.g. "24 Jun 2025 at 14:30" (FlaggedEmails detail) */
export function formatDetailReceived(isoString, timeZone = getUserTimeZone()) {
  const date = parseInstant(isoString);
  if (!date) return isoString || '';
  try {
    const datePart = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
    const timePart = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
    return `${datePart} at ${timePart}`;
  } catch {
    return isoString;
  }
}

/** "Today, HH:mm" / "Yesterday, HH:mm" / "d MMM yyyy" — activity/request timestamps */
export function formatActivityTimestamp(isoString, timeZone = getUserTimeZone()) {
  const date = parseInstant(isoString);
  if (!date) return isoString || '';
  if (isTodayInTimeZone(date, timeZone)) {
    return `Today, ${formatTimeOnly(isoString, timeZone)}`;
  }
  if (isYesterdayInTimeZone(date, timeZone)) {
    return `Yesterday, ${formatTimeOnly(isoString, timeZone)}`;
  }
  return formatShortDate(isoString, timeZone);
}

/** "Today, HH:mm" / "Yesterday, HH:mm" / "dd MMM, HH:mm" — dashboard activity */
export function formatDashboardActivity(isoString, timeZone = getUserTimeZone()) {
  const date = parseInstant(isoString);
  if (!date) return isoString || '';
  if (isTodayInTimeZone(date, timeZone)) {
    return `Today, ${formatTimeOnly(isoString, timeZone)}`;
  }
  if (isYesterdayInTimeZone(date, timeZone)) {
    return `Yesterday, ${formatTimeOnly(isoString, timeZone)}`;
  }
  const datePart = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
  }).format(date);
  const timePart = formatTimeOnly(isoString, timeZone);
  return `${datePart}, ${timePart}`;
}

/** "yyyy-MM-dd" — ISO date for form values (TemplateEditor save) */
export function formatISODate(date = new Date(), timeZone = getUserTimeZone()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
