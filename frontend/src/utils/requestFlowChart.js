import { addDays, format, parseISO } from 'date-fns';

/** Y-axis tick helpers and horizontal bar layout for Overview Request flow. */

export function niceTicks(maxValue, count = 3) {
  const capped = Math.max(1, maxValue);
  const rough = capped / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const stepBase = normalized <= 1.5 ? 1 : normalized <= 3 ? 2 : normalized <= 7 ? 5 : 10;
  const step = stepBase * magnitude;
  const top = Math.ceil(capped / step) * step;
  const ticks = [];
  for (let value = 0; value <= top + 1e-9; value += step) {
    ticks.push(Math.round(value));
  }
  if (ticks[ticks.length - 1] !== top) ticks.push(top);
  return { ticks, top: Math.max(top, 1) };
}

/**
 * Fixed-size bar layout (legacy / tests). Prefer getRequestFlowFillLayout for UI.
 * @param {number} count number of x-axis buckets (days/weeks/months/years)
 */
export function getRequestFlowBarLayout(count) {
  const n = Math.max(count, 1);
  let barW = 10;
  let gap = 14;
  if (n > 25) {
    barW = 5;
    gap = 7;
  } else if (n > 16) {
    barW = 7;
    gap = 10;
  } else if (n > 8) {
    barW = 10;
    gap = 14;
  } else if (n <= 4) {
    barW = 16;
    gap = 24;
  }

  const groupW = barW * 2 + 3;
  const stepSize = groupW + gap;
  const totalGroupsWidth = n * groupW + (n - 1) * gap;
  const plotW = Math.max(totalGroupsWidth + 12, 280);
  return { barW, gap, groupW, stepSize, plotW, count: n };
}

/**
 * Spread buckets evenly across the full plot width (no empty right/left band).
 * @param {number} count
 * @param {number} plotWidth available px for bars (inside axis pads)
 */
export function getRequestFlowFillLayout(count, plotWidth) {
  const n = Math.max(count, 1);
  const plotW = Math.max(plotWidth, 120);
  const slotW = plotW / n;
  // Pair of bars + 2px gap, capped so dense months stay readable.
  const groupW = Math.min(Math.max(slotW * 0.72, 10), 40);
  const barW = Math.max(3, Math.min((groupW - 2) / 2, 14));
  const gap = Math.max(2, slotW - groupW);
  const stepSize = slotW;
  return { barW, gap, groupW, stepSize, plotW, count: n, slotW };
}

/**
 * Evenly spaced labels that fill the axis — always includes first + last.
 * @param {number} count
 * @param {number} plotWidth
 * @param {number} [minLabelSpacing=56] min px between label centers
 */
export function getVisibleLabelIndicesForWidth(count, plotWidth, minLabelSpacing = 56) {
  const n = Math.max(count, 1);
  if (n <= 1) return { labelStride: 1, visibleIndices: [0] };

  const plotW = Math.max(plotWidth, 120);
  const maxLabels = Math.max(2, Math.floor(plotW / Math.max(minLabelSpacing, 1)) + 1);
  // How many labels we can show without overlap.
  const labelCount = Math.min(n, maxLabels);
  if (labelCount >= n) {
    return { labelStride: 1, visibleIndices: Array.from({ length: n }, (_, i) => i) };
  }

  const visible = new Set([0, n - 1]);
  // Distribute remaining labels evenly across the interior.
  const interior = labelCount - 2;
  for (let k = 1; k <= interior; k += 1) {
    const idx = Math.round((k * (n - 1)) / (labelCount - 1));
    visible.add(Math.min(n - 1, Math.max(0, idx)));
  }
  const visibleIndices = [...visible].sort((a, b) => a - b);
  const labelStride = Math.max(1, Math.round((n - 1) / (visibleIndices.length - 1)));
  return { labelStride, visibleIndices };
}

/**
 * Which x labels to show so they do not collide when the range is large.
 * @param {number[]} [preferIndices] optional indexes to favor (still spacing-thinned)
 * @deprecated prefer getVisibleLabelIndicesForWidth for fill layouts
 */
export function getVisibleLabelIndices(count, stepSize, minLabelSpacing = 48, preferIndices = []) {
  const n = Math.max(count, 1);
  const labelStride = n <= 7 ? 1 : Math.max(1, Math.ceil(minLabelSpacing / Math.max(stepSize, 1)));
  const minIndexGap = Math.max(1, labelStride);

  const fits = (chosen, idx) => {
    for (const existing of chosen) {
      if (Math.abs(existing - idx) < minIndexGap) return false;
    }
    return true;
  };

  const visible = [];
  for (let i = 0; i < n; i += labelStride) {
    visible.push(i);
  }
  const lastIndex = n - 1;
  if (lastIndex > 0 && fits(visible, lastIndex)) {
    visible.push(lastIndex);
  }

  for (const idx of preferIndices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) continue;
    if (fits(visible, idx)) visible.push(idx);
  }

  return { labelStride, visibleIndices: [...new Set(visible)].sort((a, b) => a - b) };
}

/**
 * Backend buckets by calendar span (mirrors dashboard_insights.py).
 * @param {number} daysDelta inclusive day count of the selected filter
 * @param {number} [monthSpan=1] inclusive calendar-month count
 */
export function trendGranularityForSpan(daysDelta, monthSpan = 1) {
  const days = Math.max(daysDelta, 1);
  const months = Math.max(monthSpan, 1);
  if (months >= 24 || days > 730) return 'yearly';
  if (months >= 3 || days > 90) return 'monthly';
  if (days > 35) return 'weekly';
  return 'daily';
}

/**
 * Full date for the Request flow hover card (not the short axis label).
 * @param {string} dateKey ISO day, YYYY-MM, or year
 * @param {string} [granularity]
 */
export function formatTrendTooltipDate(dateKey, granularity = 'daily') {
  if (!dateKey) return '';
  if (granularity === 'yearly' || /^\d{4}$/.test(dateKey)) {
    return String(dateKey);
  }
  if (granularity === 'monthly' || /^\d{4}-\d{2}$/.test(dateKey)) {
    const [year, month] = String(dateKey).split('-');
    const parsed = new Date(Number(year), Number(month) - 1, 1);
    if (Number.isNaN(parsed.getTime())) return String(dateKey);
    return format(parsed, 'MMMM yyyy');
  }
  const parsed = /^\d{4}-\d{2}-\d{2}/.test(dateKey) ? parseISO(dateKey) : new Date(dateKey);
  if (Number.isNaN(parsed.getTime())) return String(dateKey);
  if (granularity === 'weekly') {
    const weekEnd = addDays(parsed, 6);
    return `${format(parsed, 'd MMM')} – ${format(weekEnd, 'd MMM yyyy')}`;
  }
  return format(parsed, 'EEE, d MMM yyyy');
}
