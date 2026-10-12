import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDateBounds,
  filterByDateRange,
  getDateFilterLabel,
  getDirectoryRecordTimestamp,
} from '../src/utils/dateFilters.js';

test('calculateDateBounds all / missing returns nulls', () => {
  assert.deepEqual(calculateDateBounds('all'), { start: null, end: null });
  assert.deepEqual(calculateDateBounds('month', null), { start: null, end: null });
  assert.deepEqual(calculateDateBounds('unknown'), { start: null, end: null });
});

test('month / year / custom bounds are UTC day-aligned', () => {
  const month = calculateDateBounds('month', '2026-07');
  assert.equal(month.start.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(month.end.toISOString(), '2026-07-31T23:59:59.999Z');

  const yearPast = calculateDateBounds('year', '2025');
  assert.equal(yearPast.start.toISOString(), '2025-01-01T00:00:00.000Z');
  assert.equal(yearPast.end.toISOString(), '2025-12-31T23:59:59.999Z');

  const custom = calculateDateBounds('custom', { start: '2026-08-01', end: '2026-08-12' });
  assert.equal(custom.start.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(custom.end.toISOString(), '2026-08-12T23:59:59.999Z');
});

test('thisMonth / current year clamp end to today (no future empty days)', () => {
  const now = new Date();
  const todayEnd = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999),
  );

  const thisMonth = calculateDateBounds('thisMonth');
  assert.equal(thisMonth.start.toISOString(), new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString());
  assert.equal(thisMonth.end.toISOString(), todayEnd.toISOString());

  const thisYear = calculateDateBounds('year', String(now.getFullYear()));
  assert.equal(thisYear.end.toISOString(), todayEnd.toISOString());
});

test('getDateFilterLabel humanizes filters without em dashes', () => {
  assert.equal(getDateFilterLabel({ type: 'all' }), 'All Time');
  assert.equal(getDateFilterLabel({ type: 'thisWeek' }), 'This Week');
  assert.equal(getDateFilterLabel({ type: 'month', value: '2026-07' }), 'July 2026');
  assert.equal(getDateFilterLabel({ type: 'year', value: '2026' }), '2026');
  const custom = getDateFilterLabel({
    type: 'custom',
    value: { start: '2026-08-01', end: '2026-08-12' },
  });
  assert.match(custom, /01 Aug 2026 - 12 Aug 2026/);
  assert.equal(custom.includes('—'), false);
});

test('filterByDateRange inclusive bounds', () => {
  const bounds = calculateDateBounds('custom', { start: '2026-01-01', end: '2026-01-31' });
  const items = [
    { at: '2025-12-31T23:00:00.000Z' },
    { at: '2026-01-15T12:00:00.000Z' },
    { at: '2026-02-01T00:00:00.000Z' },
  ];
  const kept = filterByDateRange(items, (i) => i.at, bounds);
  assert.deepEqual(kept.map((i) => i.at), ['2026-01-15T12:00:00.000Z']);
});

test('getDirectoryRecordTimestamp prefers lifecycle history', () => {
  const user = {
    dateAdded: '2020-01-01T00:00:00.000Z',
    archivedAt: '2024-01-01T00:00:00.000Z',
    requestHistory: [
      { at: '2023-06-01T00:00:00.000Z', outcome: 'added' },
      { at: '2024-02-01T00:00:00.000Z', outcome: 'removed' },
    ],
  };
  assert.equal(getDirectoryRecordTimestamp(user, 'active'), '2023-06-01T00:00:00.000Z');
  assert.equal(getDirectoryRecordTimestamp(user, 'archived'), '2024-02-01T00:00:00.000Z');
  assert.equal(getDirectoryRecordTimestamp(null), null);
});
