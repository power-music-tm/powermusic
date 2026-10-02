import { useState, useRef, useEffect, useMemo, useTransition } from 'react';
import { Loader2, Calendar, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { format, subMonths, addMonths, subYears, addYears, getYear, getMonth, isAfter, isFuture } from 'date-fns';

const VIEW_MAIN = 'main';
const VIEW_MONTH = 'month';
const VIEW_YEAR = 'year';
const VIEW_CUSTOM = 'custom';

export default function DateFilter({ value, onChange, loading = false, className = '', variant = 'default' }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(VIEW_MAIN);
  const rootRef = useRef(null);
  const [isPending, startTransition] = useTransition();

  // For Month/Year pickers, track the page we're viewing (not necessarily selected)
  const [navDate, setNavDate] = useState(new Date());

  // For Custom Date Range inputs
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setView(VIEW_MAIN);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const handleSelectType = (type, val = null) => {
    setOpen(false);
    setView(VIEW_MAIN);
    startTransition(() => {
      onChange({ type, value: val });
    });
  };

  const currentLabel = useMemo(() => {
    if (!value || value.type === 'all') return 'All time';
    if (value.type === 'thisWeek') return 'This week';
    if (value.type === 'last30Days') return 'Last 30 days';
    if (value.type === 'thisMonth') return 'This month';
    if (value.type === 'month' && value.value) {
      const [y, m] = value.value.split('-');
      const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
      return format(d, 'MMMM yyyy');
    }
    if (value.type === 'year' && value.value) return value.value;
    if (value.type === 'custom' && value.value) {
      const startFormat = value.value.start ? format(new Date(value.value.start), 'dd MMM yyyy') : '';
      const endFormat = value.value.end ? format(new Date(value.value.end), 'dd MMM yyyy') : '';
      return `${startFormat} - ${endFormat}`;
    }
    return 'Filter by';
  }, [value]);

  const now = new Date();
  const currentYear = getYear(now);
  const currentMonth = getMonth(now);

  const renderMainMenu = () => (
    <div className="py-1 min-w-[200px]">
      {[
        { label: 'All time', type: 'all' },
        { label: 'This week', type: 'thisWeek' },
        { label: 'Last 30 days', type: 'last30Days' },
        { label: 'This month', type: 'thisMonth' },
      ].map((opt) => (
        <button
          key={opt.type}
          type="button"
          onClick={() => handleSelectType(opt.type)}
          className={`block w-full text-left px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-surface-highlight)] ${
            value?.type === opt.type ? 'text-[var(--color-brand-primary)] bg-[var(--color-surface-highlight-strong)]' : 'text-[var(--color-text-primary)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
      <div className="my-1 border-t border-[var(--color-border-default)]" />
      {[
        { label: 'Month', nextView: VIEW_MONTH },
        { label: 'Year', nextView: VIEW_YEAR },
        { label: 'Custom date range', nextView: VIEW_CUSTOM },
      ].map((opt) => (
        <button
          key={opt.nextView}
          type="button"
          onClick={() => setView(opt.nextView)}
          className="block w-full text-left px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)] transition-colors flex items-center justify-between"
        >
          <span>{opt.label}</span>
          <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
        </button>
      ))}
    </div>
  );

  const renderMonthMenu = () => {
    const navYear = getYear(navDate);
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(navYear, i, 1);
      return {
        label: format(d, 'MMMM'),
        value: format(d, 'yyyy-MM'),
        disabled: navYear === currentYear && i > currentMonth,
      };
    });

    return (
      <div className="p-2 min-w-[240px]">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => setView(VIEW_MAIN)}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-[var(--color-text-primary)]">{navYear}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setNavDate(subYears(navDate, 1))}
              className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors rounded hover:bg-gray-100"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={navYear >= currentYear}
              onClick={() => setNavDate(addYears(navDate, 1))}
              className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {months.map((m) => (
            <button
              key={m.value}
              disabled={m.disabled}
              type="button"
              onClick={() => handleSelectType('month', m.value)}
              className={`px-2 py-1.5 text-sm font-medium rounded-md text-center transition-colors ${
                m.disabled
                  ? 'text-gray-300 cursor-not-allowed'
                  : value?.type === 'month' && value?.value === m.value
                    ? 'bg-[var(--color-brand-primary)] text-white'
                    : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderYearMenu = () => {
    // Show a 12-year window
    const baseYear = getYear(navDate);
    const startDecade = Math.floor(baseYear / 10) * 10;
    const years = Array.from({ length: 12 }, (_, i) => {
      const y = startDecade - 1 + i;
      return {
        label: y.toString(),
        value: y.toString(),
        disabled: y > currentYear,
      };
    });

    return (
      <div className="p-2 min-w-[240px]">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => setView(VIEW_MAIN)}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-[var(--color-text-primary)]">
            {years[1].label} - {years[10].label}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setNavDate(subYears(navDate, 10))}
              className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors rounded hover:bg-gray-100"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={startDecade + 10 > currentYear}
              onClick={() => setNavDate(addYears(navDate, 10))}
              className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {years.map((y, i) => {
            const isOutside = i === 0 || i === 11;
            return (
              <button
                key={y.value}
                disabled={y.disabled}
                type="button"
                onClick={() => handleSelectType('year', y.value)}
                className={`px-2 py-1.5 text-sm font-medium rounded-md text-center transition-colors ${
                  y.disabled
                    ? 'text-gray-300 cursor-not-allowed'
                    : value?.type === 'year' && value?.value === y.value
                      ? 'bg-[var(--color-brand-primary)] text-white'
                      : isOutside
                        ? 'text-gray-400 hover:bg-[var(--color-surface-highlight)]'
                        : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)]'
                }`}
              >
                {y.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCustomMenu = () => {
    return (
      <div className="p-3 min-w-[260px]">
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => setView(VIEW_MAIN)}
            className="p-1 -ml-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-[var(--color-text-primary)]">Custom range</span>
        </div>
        
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">Start date</label>
            <input
              type="date"
              max={format(now, 'yyyy-MM-dd')}
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[var(--color-border-default)] text-sm focus:outline-none focus:border-[var(--color-brand-primary)] focus:ring-1 focus:ring-[var(--color-brand-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">End date</label>
            <input
              type="date"
              max={format(now, 'yyyy-MM-dd')}
              min={customStart}
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[var(--color-border-default)] text-sm focus:outline-none focus:border-[var(--color-brand-primary)] focus:ring-1 focus:ring-[var(--color-brand-primary)]"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={!customStart || !customEnd || customStart > customEnd}
          onClick={() => handleSelectType('custom', { start: customStart, end: customEnd })}
          className="w-full h-9 rounded-lg bg-[var(--color-brand-primary)] text-white text-sm font-semibold hover:bg-[var(--color-surface-sidebar-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Apply range
        </button>
      </div>
    );
  };

  const hasFilter = value && value.type !== 'all';

  if (variant === 'slot') {
    return (
      <div ref={rootRef} className={`relative min-w-0 max-w-full ${className}`}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`h-9 px-3 w-full flex items-center justify-between gap-2 rounded-lg text-sm font-medium transition-colors border cursor-pointer focus:outline-none ${
            hasFilter
              ? 'bg-white border-[var(--color-brand-primary)]/40 text-[var(--color-brand-primary)] font-semibold shadow-sm'
              : 'bg-white border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:border-[var(--color-border-focus)]'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 truncate">
            {isPending || loading ? (
              <Loader2 className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0 animate-spin" />
            ) : (
              <Calendar className={`w-3.5 h-3.5 shrink-0 ${hasFilter ? 'text-[var(--color-brand-primary)]' : 'text-[var(--color-text-muted)]'}`} />
            )}
            <span className="truncate text-left">{hasFilter ? currentLabel : 'All'}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {hasFilter && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectType('all');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    handleSelectType('all');
                  }
                }}
                className="p-0.5 text-[var(--color-text-muted)] hover:text-red-600 rounded transition-colors cursor-pointer"
                title="Reset date filter"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {open && (
          <div className="absolute left-0 top-[calc(100%+6px)] z-30 bg-white border border-[var(--color-border-default)] rounded-xl shadow-[var(--shadow-modal)] overflow-hidden">
            {view === VIEW_MAIN && renderMainMenu()}
            {view === VIEW_MONTH && renderMonthMenu()}
            {view === VIEW_YEAR && renderYearMenu()}
            {view === VIEW_CUSTOM && renderCustomMenu()}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`h-9 px-3 flex items-center gap-2 rounded-lg text-sm font-medium transition-colors border ${
            hasFilter
              ? 'bg-[var(--color-brand-primary)]/5 border-[var(--color-brand-primary)]/20 text-[var(--color-brand-primary)] hover:bg-[var(--color-brand-primary)]/10'
              : 'bg-white border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-gray-50'
          }`}
        >
          {isPending || loading ? (
            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
          ) : (
            <Calendar className="w-4 h-4 shrink-0" />
          )}
          <span className="whitespace-nowrap">Filter by{hasFilter ? `: ${currentLabel}` : ''}</span>
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {hasFilter && (
          <button
            type="button"
            onClick={() => handleSelectType('all')}
            className="p-2 text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Clear filter"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 bg-white border border-[var(--color-border-default)] rounded-xl shadow-[var(--shadow-modal)] overflow-hidden">
          {view === VIEW_MAIN && renderMainMenu()}
          {view === VIEW_MONTH && renderMonthMenu()}
          {view === VIEW_YEAR && renderYearMenu()}
          {view === VIEW_CUSTOM && renderCustomMenu()}
        </div>
      )}
    </div>
  );
}
