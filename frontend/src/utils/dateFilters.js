import {
  startOfWeek,
  endOfWeek,
  subDays,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  startOfDay,
  endOfDay,
  parseISO,
  format,
} from 'date-fns';

/**
 * Calculate the start and end Date objects for a given filter.
 * Returns { start: Date|null, end: Date|null } in clean UTC-aligned bounds.
 */
export function calculateDateBounds(type, value) {
  const now = new Date();

  switch (type) {
    case 'all':
      return { start: null, end: null };
    case 'thisWeek': {
      const s = startOfWeek(now, { weekStartsOn: 1 });
      const e = endOfWeek(now, { weekStartsOn: 1 });
      return {
        start: new Date(Date.UTC(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0)),
        end: new Date(Date.UTC(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59, 999)),
      };
    }
    case 'last30Days': {
      const past = subDays(now, 29);
      return {
        start: new Date(Date.UTC(past.getFullYear(), past.getMonth(), past.getDate(), 0, 0, 0, 0)),
        end: new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)),
      };
    }
    case 'thisMonth': {
      const y = now.getFullYear();
      const m = now.getMonth();
      const lastDay = new Date(y, m + 1, 0).getDate();
      return {
        start: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
        end: new Date(Date.UTC(y, m, lastDay, 23, 59, 59, 999)),
      };
    }
    case 'month': {
      // value is like '2026-07'
      if (!value) return { start: null, end: null };
      const [yearStr, monthStr] = value.split('-');
      const y = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10) - 1;
      const lastDay = new Date(y, m + 1, 0).getDate();
      return {
        start: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
        end: new Date(Date.UTC(y, m, lastDay, 23, 59, 59, 999)),
      };
    }
    case 'year': {
      // value is like '2026'
      if (!value) return { start: null, end: null };
      const y = parseInt(value, 10);
      return {
        start: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
        end: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
      };
    }
    case 'custom': {
      // value is like { start: '2026-08-01', end: '2026-08-12' }
      if (!value?.start || !value?.end) return { start: null, end: null };
      const [sy, sm, sd] = value.start.split('-').map(Number);
      const [ey, em, ed] = value.end.split('-').map(Number);
      return {
        start: new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0, 0)),
        end: new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59, 999)),
      };
    }
    default:
      return { start: null, end: null };
  }
}

/**
 * Get human-readable description of the active date filter.
 * Note: Never uses em dashes.
 */
export function getDateFilterLabel(filter) {
  if (!filter || filter.type === 'all') return 'All Time';
  if (filter.type === 'thisWeek') return 'This Week';
  if (filter.type === 'last30Days') return 'Last 30 Days';
  if (filter.type === 'thisMonth') return 'This Month';
  if (filter.type === 'month' && filter.value) {
    try {
      const [yearStr, monthStr] = filter.value.split('-');
      const target = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1);
      return format(target, 'MMMM yyyy');
    } catch {
      return filter.value;
    }
  }
  if (filter.type === 'year' && filter.value) {
    return String(filter.value);
  }
  if (filter.type === 'custom' && filter.value) {
    try {
      const { start, end } = filter.value;
      if (start && end) {
        const parseLocal = (ymd) => {
          const [y, m, d] = ymd.split('-');
          return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        };
        const s = parseLocal(start);
        const e = parseLocal(end);
        return `${format(s, 'dd MMM yyyy')} - ${format(e, 'dd MMM yyyy')}`;
      }
    } catch {
      return 'Custom Range';
    }
  }
  return 'Selected Period';
}

/**
 * Extract the relevant lifecycle event timestamp for directory filtering.
 * For Active directory: latest addition, update, or restore event from history, falling back to dateAdded.
 * For Archived directory: latest removal or archive event from history, falling back to archivedAt.
 */
export function getDirectoryRecordTimestamp(user, directoryView = 'active') {
  if (!user) return null;
  const history = Array.isArray(user.requestHistory) ? [...user.requestHistory] : [];

  history.sort((a, b) => {
    const tA = a.at ? new Date(a.at).getTime() : 0;
    const tB = b.at ? new Date(b.at).getTime() : 0;
    return tB - tA;
  });

  if (directoryView === 'archived') {
    for (const ev of history) {
      const outcome = (ev.outcome || '').toLowerCase();
      const action = (ev.action || '').toLowerCase();
      const type = (ev.type || '').toLowerCase();
      const title = (ev.title || '').toLowerCase();
      if (
        outcome === 'removed' ||
        action === 'remove' ||
        type === 'removed' ||
        type === 'archive' ||
        type === 'archived' ||
        title.includes('removed') ||
        title.includes('archived')
      ) {
        if (ev.at) return ev.at;
      }
    }
    return user.archivedAt || user.dateAdded || null;
  }

  // Active view: look for latest active state transition (Added / Updated / Restored)
  for (const ev of history) {
    const outcome = (ev.outcome || '').toLowerCase();
    const action = (ev.action || '').toLowerCase();
    const type = (ev.type || '').toLowerCase();
    const title = (ev.title || '').toLowerCase();
    if (
      outcome === 'added' ||
      outcome === 'updated' ||
      action === 'add' ||
      action === 'update' ||
      type === 'added' ||
      type === 'updated' ||
      type === 'restored' ||
      title.includes('added') ||
      title.includes('updated') ||
      title.includes('restored') ||
      title.includes('moved to active')
    ) {
      if (ev.at) return ev.at;
    }
  }

  return user.dateAdded || user.requestReceivedAt || null;
}

/**
 * Filter an array of items based on a date range.
 * @param {Array} items
 * @param {Function} timestampGetter - function(item) returns ISO string or Date
 * @param {Object} bounds - { start, end } Date objects
 */
export function filterByDateRange(items, timestampGetter, bounds) {
  if (!Array.isArray(items)) return items;
  if (!bounds || (!bounds.start && !bounds.end)) return items;

  const startMs = bounds.start ? bounds.start.getTime() : -Infinity;
  const endMs = bounds.end ? bounds.end.getTime() : Infinity;

  return items.filter((item) => {
    const ts = timestampGetter(item);
    if (!ts) return false;

    let timeMs;
    if (ts instanceof Date) {
      timeMs = ts.getTime();
    } else {
      const parsed = parseISO(ts);
      if (isNaN(parsed.getTime())) return false;
      timeMs = parsed.getTime();
    }

    return timeMs >= startMs && timeMs <= endMs;
  });
}
