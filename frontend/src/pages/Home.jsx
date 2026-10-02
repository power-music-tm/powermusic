import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { formatDashboardActivity } from '../utils/dateTime';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Inbox,
  Mail,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import PageHeader from '../components/layout/PageHeader';
import { loadWithCache, getDashboard } from '../utils/pilot2Api';
import { AdminPageScroll, DottedScroll, PanelListSkeleton, DateFilter } from '../components/ui';
import StatusTag from '../components/ui/Tag';
import { calculateDateBounds, getDateFilterLabel } from '../utils/dateFilters';
import {
  TAG_ALREADY_EXISTS,
  TAG_ALREADY_REMOVED,
  TAG_CONFIRMED_DUPLICATE,
  TAG_POTENTIAL_DUPLICATE,
  TAG_PARTNER_REQUEST,
  TAG_AUTO_MAIL,
} from '../utils/requestTags';
import { usePartners } from '../context/PartnerContext';

const CHART = {
  pink: '#e94560',
  pinkSoft: 'rgba(233, 69, 96, 0.18)',
  blue: '#3b6ea5',
  blueSoft: 'rgba(59, 110, 165, 0.18)',
  grey: '#9ca3af',
  greySoft: 'rgba(156, 163, 175, 0.22)',
  track: '#e8eaef',
};

const EMPTY_INSIGHTS = {
  pendingAdd: 0,
  pendingRemove: 0,
  awaitingPartner: 0,
  duplicates: 0,
  autoMail: 0,
  partnerReq: 0,
  usersAdded: 0,
  usersRemoved: 0,
  usersInLedger: 0,
  usersArchived: 0,
  handledThisWeek: 0,
  receivedThisWeek: 0,
  handledInPeriod: 0,
  receivedInPeriod: 0,
  granularity: 'daily',
  weeklyTrend: [],
};



function InsightCard({ label, badge, value, hint, icon: Icon, accent, onClick }) {
  const accents = {
    pink: { well: 'bg-[var(--color-brand-accent)]/10', icon: 'text-[var(--color-brand-accent)]' },
    blue: { well: 'bg-[#3b6ea5]/10', icon: 'text-[#3b6ea5]' },
    grey: { well: 'bg-[var(--color-surface-highlight)]', icon: 'text-[var(--color-text-secondary)]' },
  };
  const tone = accents[accent] || accents.grey;
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`h-full rounded-2xl border border-[var(--color-border-default)] bg-white p-3.5 text-left shadow-sm transition-colors sm:p-4 ${
        onClick ? 'cursor-pointer hover:border-[#c5daf3] hover:bg-[#f7fafc]' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              {label}
            </p>
            {badge ? (
              <span className="inline-flex items-center rounded-md bg-[var(--color-brand-accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-brand-accent)] truncate max-w-[130px]">
                {badge}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--color-text-primary)] sm:text-2xl">
            {value}
          </p>
          {hint && (
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] leading-snug">{hint}</p>
          )}
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.well}`}>
          <Icon className={`h-4 w-4 ${tone.icon}`} aria-hidden="true" />
        </div>
      </div>
    </Tag>
  );
}

function ChartCard({ title, badge, subtitle, legend, children, className = '' }) {
  return (
    <section
      className={`flex h-full min-h-0 flex-col rounded-2xl border border-[var(--color-border-default)] bg-white p-4 shadow-sm ${className}`}
    >
      <div className="mb-4 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="min-w-0 text-sm font-bold text-[var(--color-text-primary)]">{title}</h2>
            {badge && (
              <span className="px-2 py-0.5 rounded text-xs font-semibold text-red-600 bg-red-50 border border-red-200 shrink-0">
                {badge}
              </span>
            )}
          </div>
          {legend ? <div className="shrink-0">{legend}</div> : null}
        </div>
        {subtitle ? (
          <p className="text-xs leading-snug text-[var(--color-text-secondary)]">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function PanelScrollBody({ children, className = '' }) {
  return (
    <DottedScroll
      className={`-mr-4 min-h-0 flex-1 ${className}`.trim()}
      scrollClassName="h-full overflow-y-auto scrollbar-hide"
      indicatorPlacement="gutter"
    >
      {children}
    </DottedScroll>
  );
}

function PanelHeader({ title, subtitle, action }) {
  return (
    <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-[var(--color-text-primary)]">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs leading-snug text-[var(--color-text-secondary)]">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 pt-0.5">{action}</div> : null}
    </div>
  );
}

function QueueLink({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="whitespace-nowrap text-xs font-semibold text-[#3b6ea5] hover:underline cursor-pointer"
    >
      Open queue
    </button>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

function niceTicks(maxValue, count = 3) {
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

function RequestFlowChart({ days }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const rawMax = Math.max(1, ...days.flatMap((d) => [d.received, d.handled]));
  const { ticks, top } = niceTicks(rawMax, 4);
  const count = Math.max(days.length, 1);
  const chartH = 110;
  const topPad = 8;
  const leftPad = 36;
  const rightPad = 16;
  const bottomPad = 24;

  let barW = 10;
  let gap = 14;
  if (count > 25) {
    barW = 5;
    gap = 7;
  } else if (count > 16) {
    barW = 7;
    gap = 10;
  } else if (count > 8) {
    barW = 10;
    gap = 14;
  } else if (count <= 4) {
    barW = 16;
    gap = 24;
  }

  const groupW = barW * 2 + 3;
  const stepSize = groupW + gap;
  const totalGroupsWidth = count * groupW + (count - 1) * gap;
  const plotW = Math.max(totalGroupsWidth + 12, 280);
  const width = leftPad + plotW + rightPad;
  const height = chartH + topPad + bottomPad;
  const startX = leftPad + 8;

  const minLabelSpacing = 48;
  const labelStride = count <= 7 ? 1 : Math.max(1, Math.ceil(minLabelSpacing / stepSize));

  const visibleIndices = new Set();
  for (let i = 0; i < count; i += labelStride) {
    visibleIndices.add(i);
  }
  const lastIndex = count - 1;
  const lastVisible = Math.floor((count - 1) / labelStride) * labelStride;
  if (lastIndex !== lastVisible && (lastIndex - lastVisible) * stepSize >= minLabelSpacing * 0.75) {
    visibleIndices.add(lastIndex);
  }

  // Minimum visible bar height (in pixels) for any non-zero count to ensure easy visibility & hoverability
  const MIN_BAR_H = 7;

  return (
    <div className="flex h-full w-full min-h-[9.5rem] items-end overflow-x-auto scrollbar-hide">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[9.5rem] w-full min-w-[280px]"
        role="img"
        aria-label="Request flow: received versus handled requests"
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((tick, index) => {
          const y = topPad + chartH - (tick / top) * chartH;
          return (
            <g key={`tick-${index}`}>
              <line
                x1={leftPad}
                x2={width - rightPad}
                y1={y}
                y2={y}
                stroke={CHART.track}
                strokeWidth="1"
              />
              <text
                x={leftPad - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-[var(--color-text-muted)]"
                style={{ fontSize: 10, fontWeight: 600 }}
              >
                {tick}
              </text>
            </g>
          );
        })}
        <line
          x1={leftPad}
          x2={leftPad}
          y1={topPad}
          y2={topPad + chartH}
          stroke={CHART.track}
          strokeWidth="1"
        />
        {days.map((day, index) => {
          const x = startX + index * (groupW + gap);
          
          const receivedH = day.received > 0 ? Math.max((day.received / top) * chartH, MIN_BAR_H) : 0;
          const handledH = day.handled > 0 ? Math.max((day.handled / top) * chartH, MIN_BAR_H) : 0;
          const receivedY = topPad + chartH - receivedH;
          const handledY = topPad + chartH - handledH;

          const showLabel = visibleIndices.has(index);
          const isHovered = hoveredIdx === index;

          return (
            <g
              key={`${day.date}-${index}`}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIdx(index)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Interactive full-height hit area for effortless hoverability */}
              <rect
                x={x - 2}
                y={topPad}
                width={groupW + 4}
                height={chartH + 2}
                fill={isHovered ? 'rgba(44, 95, 143, 0.05)' : 'transparent'}
                rx="4"
                pointerEvents="all"
              >
                <title>{`${day.label}\nReceived: ${day.received}\nHandled: ${day.handled}`}</title>
              </rect>

              {/* Received Bar */}
              {day.received > 0 && (
                <rect
                  x={x}
                  y={receivedY}
                  width={barW}
                  height={receivedH}
                  rx="2.5"
                  fill={CHART.blue}
                  opacity={isHovered ? 0.85 : 1}
                  className="transition-opacity"
                >
                  <title>{`${day.label}: ${day.received} received`}</title>
                </rect>
              )}

              {/* Handled Bar */}
              {day.handled > 0 && (
                <rect
                  x={x + barW + 2}
                  y={handledY}
                  width={barW}
                  height={handledH}
                  rx="2.5"
                  fill={CHART.pink}
                  opacity={isHovered ? 0.85 : 1}
                  className="transition-opacity"
                >
                  <title>{`${day.label}: ${day.handled} handled`}</title>
                </rect>
              )}

              {/* X-Axis Date Label */}
              {showLabel ? (
                <text
                  x={x + groupW / 2}
                  y={topPad + chartH + 16}
                  textAnchor="middle"
                  className={isHovered ? 'fill-[var(--color-brand-secondary)] font-bold' : 'fill-[var(--color-text-muted)]'}
                  style={{ fontSize: 10, fontWeight: isHovered ? 700 : 600 }}
                >
                  {day.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DonutChart({ segments, centerLabel, centerValue }) {
  const size = 128;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;

  let offset = 0;
  const arcs = segments.map((segment) => {
    const length = (segment.value / total) * circumference;
    const arc = {
      ...segment,
      dasharray: `${length} ${circumference - length}`,
      dashoffset: -offset,
    };
    offset += length;
    return arc;
  });

  return (
    <div className="flex h-full min-h-[9.5rem] flex-col items-center justify-center gap-4 sm:flex-row sm:justify-center sm:gap-8">
      <div className="relative shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={CHART.track}
            strokeWidth={stroke}
          />
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={stroke}
              strokeDasharray={arc.dasharray}
              strokeDashoffset={arc.dashoffset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">{centerValue}</p>
          <p className="text-[10px] font-medium text-[var(--color-text-muted)]">{centerLabel}</p>
        </div>
      </div>
      <ul className="w-full max-w-[9rem] space-y-2.5">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-2 text-[var(--color-text-secondary)]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
              {segment.label}
            </span>
            <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">
              {segment.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArrivalSourceList({ partnerReq, autoMail, onOpenQueue, partnerLabel = 'Partner' }) {
  const total = Math.max(partnerReq + autoMail, 1);
  const rows = [
    {
      key: 'partner',
      sentVia: TAG_PARTNER_REQUEST,
      label: `${partnerLabel} requests`,
      detail: `${Math.round((partnerReq / total) * 100)}% of pending`,
      value: partnerReq,
      pct: (partnerReq / total) * 100,
      color: CHART.blue,
      Icon: Inbox,
      accent: 'border-l-[#3b6ea5]',
      well: 'bg-[#3b6ea5]/10',
      iconClass: 'text-[#3b6ea5]',
    },
    {
      key: 'auto',
      sentVia: TAG_AUTO_MAIL,
      label: 'Automated email',
      detail: `${Math.round((autoMail / total) * 100)}% of pending`,
      value: autoMail,
      pct: (autoMail / total) * 100,
      color: CHART.pink,
      Icon: Mail,
      accent: 'border-l-[var(--color-brand-accent)]',
      well: 'bg-[var(--color-brand-accent)]/10',
      iconClass: 'text-[var(--color-brand-accent)]',
    },
  ];

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => {
        const Icon = row.Icon;
        return (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onOpenQueue(row.sentVia)}
              className={`flex w-full items-start gap-2.5 rounded-xl border border-[var(--color-border-default)] border-l-[3px] ${row.accent} bg-white px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-surface-panel)] cursor-pointer`}
            >
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${row.well}`}>
                <Icon className={`h-3.5 w-3.5 ${row.iconClass}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                    {row.label}
                  </p>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-[var(--color-text-primary)]">
                    {row.value}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{row.detail}</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-highlight)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${row.pct}%`, backgroundColor: row.color }}
                  />
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedPartnerId, partnerLabel } = usePartners();
  const [pendingRequests, setPendingRequests] = useState([]);
  const [kpis, setKpis] = useState({ pendingRequests: 0, usersInLedger: 0 });
  const [insights, setInsights] = useState(EMPTY_INSIGHTS);
  const [activity, setActivity] = useState([]);
  const [ready, setReady] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [dateFilter, setDateFilter] = useState({ type: 'all', value: null });

  const activePeriodLabel = useMemo(() => getDateFilterLabel(dateFilter), [dateFilter]);

  useEffect(() => {
    const bounds = calculateDateBounds(dateFilter.type, dateFilter.value);
    const startIso = bounds.start ? bounds.start.toISOString() : '';
    const endIso = bounds.end ? bounds.end.toISOString() : '';

    const applyDashboard = (data) => {
      setPendingRequests(data.pendingRequests || []);
      setKpis(data.kpis || { pendingRequests: 0, usersInLedger: 0 });
      setInsights(data.insights || EMPTY_INSIGHTS);
      setActivity(data.activity || []);
      setReady(true);
      setFetching(false);
    };
    const load = () => {
      setFetching(true);
      loadWithCache(
        `home_dashboard_v3:${selectedPartnerId || ''}:${startIso}:${endIso}`,
        () => getDashboard(selectedPartnerId, startIso, endIso),
        applyDashboard,
      ).catch((err) => {
        console.error(err);
        setReady(true);
        setFetching(false);
      });
    };
    load();
    const refresh = () => {
      if (!document.hidden) load();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [location.key, selectedPartnerId, dateFilter]);

  const priorityAlerts = useMemo(() => {
    const list = Array.isArray(pendingRequests) ? pendingRequests : [];
    const ALERT_TAGS = [
      TAG_ALREADY_EXISTS,
      TAG_ALREADY_REMOVED,
      TAG_CONFIRMED_DUPLICATE,
      TAG_POTENTIAL_DUPLICATE,
    ];
    return list
      .filter((req) => {
        const tags = req.tags || [];
        const hasAlertTag = ALERT_TAGS.some((t) => tags.includes(t));
        const hasDirMatch = Boolean(req.directoryMatch);
        const groupSummary = req.groupClassificationSummary;
        const hasGroupAlert = Boolean(
          groupSummary && (
            groupSummary.alreadyExists ||
            groupSummary.alreadyRemoved ||
            (groupSummary.duplicateCount || 0) > 0 ||
            (groupSummary.potentialCount || 0) > 0
          )
        );
        return hasAlertTag || hasDirMatch || hasGroupAlert;
      })
      .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
  }, [pendingRequests]);

  const arrivalCounts = useMemo(() => {
    const list = Array.isArray(pendingRequests) ? pendingRequests : [];
    let partner = 0;
    let auto = 0;
    for (const req of list) {
      const tags = req.tags || [];
      const hasPartner = tags.includes(TAG_PARTNER_REQUEST);
      const hasAuto = tags.includes(TAG_AUTO_MAIL);
      if (hasPartner && !hasAuto) partner += 1;
      else if (hasAuto && !hasPartner) auto += 1;
    }
    return { partner, auto };
  }, [pendingRequests]);

  const recentActivity = useMemo(
    () => (Array.isArray(activity) ? activity : []).slice(0, 5),
    [activity],
  );

  const actionSegments = [
    { label: 'Add', value: insights.pendingAdd, color: CHART.blue },
    { label: 'Remove', value: insights.pendingRemove, color: CHART.pink },
  ];

  const trendDays = Array.isArray(insights.weeklyTrend) ? insights.weeklyTrend : [];
  const handledCount = insights.handledInPeriod ?? insights.handledThisWeek ?? 0;
  const receivedCount = insights.receivedInPeriod ?? insights.receivedThisWeek ?? 0;

  function getAlertBadge(req) {
    const tags = req.tags || [];
    if (tags.includes(TAG_CONFIRMED_DUPLICATE)) {
      return { label: 'Duplicate', variant: 'duplicate-confirmed' };
    }
    if (tags.includes(TAG_POTENTIAL_DUPLICATE)) {
      return { label: 'Potential Duplicate', variant: 'duplicate-potential' };
    }
    if (tags.includes(TAG_ALREADY_REMOVED)) {
      return { label: 'Already Removed', variant: 'already-removed' };
    }
    if (tags.includes(TAG_ALREADY_EXISTS) || req.directoryMatch) {
      return { label: 'Exists in Directory', variant: 'already-exists' };
    }
    if (req.groupClassificationSummary?.duplicateCount > 0) {
      return { label: 'Duplicate', variant: 'duplicate-confirmed' };
    }
    if (req.groupClassificationSummary?.potentialCount > 0) {
      return { label: 'Similar requests found', variant: 'duplicate-potential' };
    }
    if (req.groupClassificationSummary?.alreadyRemoved) {
      return { label: 'Already Removed', variant: 'already-removed' };
    }
    if (req.groupClassificationSummary?.alreadyExists) {
      return { label: 'Exists in Directory', variant: 'already-exists' };
    }
    return { label: 'Review needed', variant: 'already-exists' };
  }

  const activityIcon = (type) => {
    if (type === 'marked_added') return UserPlus;
    if (type === 'marked_removed') return UserMinus;
    if (type === 'automated_email') return Mail;
    if (type === 'tag_applied') return AlertTriangle;
    return Inbox;
  };

  return (
    <AdminPageScroll
      contentClassName="flex flex-col gap-2 select-none pb-4 lg:h-full lg:min-h-0 lg:overflow-hidden lg:pb-4"
      scrollClassName="h-full w-full overflow-y-auto scrollbar-hide lg:overflow-hidden"
    >
      <PageHeader
        section="Overview"
        title="Hello Andrea."
        description={`A live view of ${partnerLabel} requests, Users Directory, and what needs your attention.`}
        borderless
        className="shrink-0"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <DateFilter value={dateFilter} onChange={setDateFilter} loading={fetching} />
          </div>
        }
      />

      {!ready ? (
        <div className="space-y-4 pb-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-24 animate-pulse rounded-2xl bg-[var(--color-surface-highlight)]" />
            ))}
          </div>
          <PanelListSkeleton rows={3} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 pb-4 lg:min-h-0 lg:overflow-hidden lg:pb-0">
          <div className="grid shrink-0 grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            <InsightCard
              label="Pending requests"
              value={kpis.pendingRequests}
              hint={`${insights.awaitingPartner} awaiting ${partnerLabel} confirmation`}
              icon={Inbox}
              accent="blue"
              onClick={() => navigate('/new-requests')}
            />
            <InsightCard
              label="Users in Directory"
              value={kpis.usersInLedger}
              hint={`${insights.usersArchived} in archive`}
              icon={Users}
              accent="grey"
              onClick={() => navigate('/directory')}
            />
            <InsightCard
              label="Handled"
              badge={activePeriodLabel}
              value={handledCount}
              hint={`${receivedCount} requests received in period`}
              icon={CheckCircle2}
              accent="pink"
              onClick={() => navigate('/directory')}
            />
          </div>

          <div className="grid shrink-0 grid-cols-1 gap-3 xl:grid-cols-5">
            <div className="h-[14rem] xl:col-span-3 xl:h-[16rem]">
              <ChartCard
                title="Request flow"
                badge={activePeriodLabel}
                subtitle="Requests received vs handled"
                legend={(
                  <div className="flex items-center gap-3">
                    <LegendDot color={CHART.blue} label="Received" />
                    <LegendDot color={CHART.pink} label="Handled" />
                  </div>
                )}
              >
                <RequestFlowChart days={trendDays} />
              </ChartCard>
            </div>

            <div className="h-[14rem] xl:col-span-2 xl:h-[16rem]">
              <ChartCard
                title="Pending by action"
                subtitle="What is waiting in New Requests"
              >
                <DonutChart
                  segments={actionSegments}
                  centerValue={kpis.pendingRequests}
                  centerLabel="pending"
                />
              </ChartCard>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3 lg:items-stretch lg:overflow-hidden">
            <section className="flex min-h-[18rem] flex-col overflow-hidden rounded-2xl border border-[var(--color-border-default)] bg-white p-4 shadow-sm lg:min-h-0 lg:h-full">
              <PanelHeader
                title="How pending requests arrived"
                subtitle={`${partnerLabel} form vs automated email`}
                action={<QueueLink onClick={() => navigate('/new-requests')} />}
              />
              <PanelScrollBody>
                <ArrivalSourceList
                  partnerReq={arrivalCounts.partner}
                  autoMail={arrivalCounts.auto}
                  partnerLabel={partnerLabel}
                  onOpenQueue={(sentVia) =>
                    navigate(sentVia ? `/new-requests?sentVia=${encodeURIComponent(sentVia)}` : '/new-requests')
                  }
                />
              </PanelScrollBody>
            </section>

            <section className="flex min-h-[18rem] flex-col overflow-hidden rounded-2xl border border-[var(--color-border-default)] bg-white p-4 shadow-sm lg:min-h-0 lg:h-full">
              <PanelHeader
                title="Priority alerts"
                subtitle={priorityAlerts.length ? `${priorityAlerts.length} ${priorityAlerts.length === 1 ? 'alert' : 'alerts'} pending` : 'All clear'}
                action={(
                  <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-[var(--color-brand-accent)]/10 px-2 py-0.5 text-xs font-bold text-[var(--color-brand-accent)]">
                    {priorityAlerts.length}
                  </span>
                )}
              />
              {priorityAlerts.length === 0 ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl bg-[var(--color-surface-panel)] px-3 py-4 text-center">
                  <CheckCircle2 className="mb-1.5 h-6 w-6 text-[var(--color-signal-green)]" />
                  <p className="text-sm font-medium text-[var(--color-text-secondary)]">No priority alerts</p>
                </div>
              ) : (
                <PanelScrollBody>
                  <ul className="space-y-1.5">
                    {priorityAlerts.map((req) => {
                      const alertBadge = getAlertBadge(req);
                      return (
                        <li key={req.id}>
                          <button
                            type="button"
                            onClick={() => navigate(`/new-requests/${encodeURIComponent(req.id)}`)}
                            className="flex w-full items-start gap-2.5 rounded-xl border border-[var(--color-border-default)] border-l-[3px] border-l-[var(--color-brand-accent)] bg-white px-2.5 py-2 text-left transition-colors hover:bg-[#fff7f8] cursor-pointer"
                          >
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-accent)]/10">
                              <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-brand-accent)]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1.5">
                                <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                                  {`${req.person?.firstName || ''} ${req.person?.lastName || ''}`.trim() || 'Unknown'}
                                </p>
                                {alertBadge && (
                                  <StatusTag variant={alertBadge.variant} label={alertBadge.label} fit compact />
                                )}
                              </div>
                              <p className="truncate text-xs text-[var(--color-text-secondary)]">{req.person?.email}</p>
                              <p className="mt-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
                                {formatDashboardActivity(req.receivedAt)}
                              </p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </PanelScrollBody>
              )}
            </section>

            <section className="flex min-h-[18rem] flex-col overflow-hidden rounded-2xl border border-[var(--color-border-default)] bg-white p-4 shadow-sm lg:min-h-0 lg:h-full">
              <PanelHeader
                title="Recent activity"
                subtitle="Latest request events"
              />
              {recentActivity.length === 0 ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl bg-[var(--color-surface-panel)] px-3 py-4 text-center">
                  <p className="text-sm font-medium text-[var(--color-text-secondary)]">No recent activity</p>
                </div>
              ) : (
                <PanelScrollBody>
                  <ul className="space-y-1.5">
                    {recentActivity.map((item) => {
                      const Icon = activityIcon(item.type);
                      const clickable = Boolean(item.linkedRequestId);
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            disabled={!clickable}
                            onClick={() => {
                              if (!item.linkedRequestId) return;
                              const handled = item.type === 'marked_added' || item.type === 'marked_removed';
                              navigate(
                                handled
                                  ? `/directory?id=${encodeURIComponent(item.linkedRequestId)}`
                                  : `/new-requests/${encodeURIComponent(item.linkedRequestId)}`,
                              );
                            }}
                            className={`flex w-full items-start gap-2.5 rounded-xl border border-[var(--color-border-default)] bg-white px-2.5 py-2 text-left transition-colors ${
                              clickable ? 'cursor-pointer hover:bg-[var(--color-surface-panel)]' : 'cursor-default'
                            }`}
                          >
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-highlight)]">
                              <Icon className="h-3.5 w-3.5 text-[#3b6ea5]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-semibold leading-snug text-[var(--color-text-primary)]">
                                  {item.description}
                                </p>
                                {clickable ? (
                                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
                                ) : null}
                              </div>
                              <p className="mt-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                                {formatDashboardActivity(item.timestamp)}
                              </p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </PanelScrollBody>
              )}
            </section>
          </div>
        </div>
      )}
    </AdminPageScroll>
  );
}
