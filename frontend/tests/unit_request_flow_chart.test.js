import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatTrendTooltipDate,
  getRequestFlowBarLayout,
  getRequestFlowFillLayout,
  getVisibleLabelIndices,
  getVisibleLabelIndicesForWidth,
  niceTicks,
  trendGranularityForSpan,
} from '../src/utils/requestFlowChart.js';

test('niceTicks scales Y axis above the raw max', () => {
  assert.deepEqual(niceTicks(0, 4).ticks[0], 0);
  assert.ok(niceTicks(14, 4).top >= 14);
  assert.deepEqual(niceTicks(14, 4).ticks, [0, 5, 10, 15]);
  assert.ok(niceTicks(1, 4).top >= 1);
});

test('bar layout widens for few buckets and shrinks for many', () => {
  const few = getRequestFlowBarLayout(4);
  const yearMonths = getRequestFlowBarLayout(12);
  const monthDays = getRequestFlowBarLayout(30);
  assert.equal(few.barW, 16);
  assert.ok(yearMonths.barW < few.barW || yearMonths.gap <= few.gap);
  assert.equal(monthDays.barW, 5);
  assert.ok(monthDays.plotW > yearMonths.plotW);
  assert.ok(monthDays.plotW > few.plotW);
});

test('fill layout spreads buckets across the full plot width', () => {
  const fill = getRequestFlowFillLayout(22, 800);
  assert.equal(fill.plotW, 800);
  assert.ok(Math.abs(fill.slotW * 22 - 800) < 0.01);
  assert.ok(fill.groupW < fill.slotW);
});

test('width-based labels always include first and last and fill the axis', () => {
  const { visibleIndices } = getVisibleLabelIndicesForWidth(22, 800, 56);
  assert.equal(visibleIndices[0], 0);
  assert.equal(visibleIndices[visibleIndices.length - 1], 21);
  // Wide plot → many labels; narrow plot → fewer
  const wide = getVisibleLabelIndicesForWidth(22, 900, 56).visibleIndices.length;
  const narrow = getVisibleLabelIndicesForWidth(22, 280, 56).visibleIndices.length;
  assert.ok(wide >= narrow);
  assert.ok(wide >= 8);
  assert.ok(narrow >= 2);
});

test('label stride skips x labels when many buckets', () => {
  const dense = getRequestFlowBarLayout(30);
  const { labelStride, visibleIndices } = getVisibleLabelIndices(30, dense.stepSize);
  assert.ok(labelStride > 1);
  assert.ok(visibleIndices.length < 30);
  assert.equal(visibleIndices[0], 0);
});

test('trend granularity matches backend span rules', () => {
  assert.equal(trendGranularityForSpan(7), 'daily');
  assert.equal(trendGranularityForSpan(30), 'daily');
  assert.equal(trendGranularityForSpan(35), 'daily');
  assert.equal(trendGranularityForSpan(36, 2), 'weekly');
  assert.equal(trendGranularityForSpan(90, 2), 'weekly');
  assert.equal(trendGranularityForSpan(65, 3), 'monthly');
  assert.equal(trendGranularityForSpan(121, 5), 'monthly');
  assert.equal(trendGranularityForSpan(365, 12), 'monthly');
  assert.equal(trendGranularityForSpan(730, 24), 'yearly');
  assert.equal(trendGranularityForSpan(731, 25), 'yearly');
  assert.equal(trendGranularityForSpan(2800, 94), 'yearly');
});

test('tooltip date uses a full date, not the short axis label', () => {
  assert.equal(formatTrendTooltipDate('2026-09-26', 'daily'), 'Sat, 26 Sep 2026');
  assert.equal(formatTrendTooltipDate('2026-09-21', 'weekly'), '21 Sep – 27 Sep 2026');
  assert.equal(formatTrendTooltipDate('2026-09', 'monthly'), 'September 2026');
  assert.equal(formatTrendTooltipDate('2026', 'yearly'), '2026');
});
