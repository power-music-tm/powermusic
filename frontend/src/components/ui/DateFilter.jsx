import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Calendar, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  format,
  subYears,
  getYear,
  getMonth,
  startOfYear,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameDay,
  isSameMonth,
  isBefore,
  isAfter,
  parseISO,
} from 'date-fns';

const VIEW_MAIN = 'main';
const VIEW_CUSTOM = 'custom';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toYmd(date) {
  return format(date, 'yyyy-MM-dd');
}

function clampYmd(ymd, minYmd, maxYmd) {
  if (!ymd) return '';
  if (ymd < minYmd) return minYmd;
  if (ymd > maxYmd) return maxYmd;
  return ymd;
}

function parseYmd(ymd) {
  if (!ymd) return null;
  try {
    return parseISO(ymd);
  } catch {
    return null;
  }
}

const CAL_DAYS = 'days';
const CAL_MONTHS = 'months';
const CAL_YEARS = 'years';

function DayCalendar({
  month,
  onMonthChange,
  selectedYmd,
  minYmd,
  maxYmd,
  onSelect,
  onClear,
  onToday,
}) {
  const [panel, setPanel] = useState(CAL_DAYS);
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const leadingBlanks = monthStart.getDay(); // 0 = Sunday
  const selected = parseYmd(selectedYmd);
  const minDate = parseYmd(minYmd);
  const maxDate = parseYmd(maxYmd);
  const today = new Date();
  const todayYmd = toYmd(today);
  const viewYear = getYear(month);
  const viewMonth = getMonth(month);
  const minYear = minDate ? getYear(minDate) : viewYear;
  const maxYear = maxDate ? getYear(maxDate) : viewYear;

  const canPrev = !minDate || isAfter(monthStart, startOfMonth(minDate));
  const canNext = !maxDate || isBefore(monthStart, startOfMonth(maxDate));

  const isMonthDisabled = (year, monthIndex) => {
    const candidate = new Date(year, monthIndex, 1);
    if (minDate && isBefore(endOfMonth(candidate), minDate)) return true;
    if (maxDate && isAfter(startOfMonth(candidate), maxDate)) return true;
    return false;
  };

  const pickYear = (year) => {
    const next = new Date(year, viewMonth, 1);
    // Clamp month into allowed range for that year
    let clamped = next;
    if (minDate && isBefore(endOfMonth(clamped), minDate)) {
      clamped = startOfMonth(minDate);
    } else if (maxDate && isAfter(startOfMonth(clamped), maxDate)) {
      clamped = startOfMonth(maxDate);
    }
    onMonthChange(clamped);
    setPanel(CAL_MONTHS);
  };

  const pickMonth = (monthIndex) => {
    onMonthChange(new Date(viewYear, monthIndex, 1));
    setPanel(CAL_DAYS);
  };

  const years = [];
  for (let y = minYear; y <= maxYear; y += 1) years.push(y);

  const headerBtn =
    'rounded-md px-1.5 py-0.5 text-sm font-bold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-highlight)]';

  return (
    <div className="rounded-xl border border-[var(--color-border-default)] bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          disabled={panel !== CAL_DAYS || !canPrev}
          onClick={() => onMonthChange(subMonths(month, 1))}
          className="rounded-md p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-highlight)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {panel === CAL_DAYS && (
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={() => setPanel(CAL_MONTHS)} className={headerBtn}>
              {format(month, 'MMMM')}
            </button>
            <button type="button" onClick={() => setPanel(CAL_YEARS)} className={headerBtn}>
              {format(month, 'yyyy')}
            </button>
          </div>
        )}
        {panel === CAL_MONTHS && (
          <button type="button" onClick={() => setPanel(CAL_YEARS)} className={headerBtn}>
            {viewYear}
          </button>
        )}
        {panel === CAL_YEARS && (
          <span className="text-sm font-bold text-[var(--color-text-primary)]">Year</span>
        )}

        <button
          type="button"
          disabled={panel !== CAL_DAYS || !canNext}
          onClick={() => onMonthChange(addMonths(month, 1))}
          className="rounded-md p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-highlight)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {panel === CAL_YEARS && (
        <div className="grid grid-cols-2 gap-1 py-1">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => pickYear(y)}
              className={`rounded-md px-2 py-2.5 text-center text-sm font-medium transition-colors ${
                y === viewYear
                  ? 'bg-[var(--color-brand-primary)] text-white'
                  : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)]'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      {panel === CAL_MONTHS && (
        <div className="grid grid-cols-3 gap-1 py-1">
          {Array.from({ length: 12 }, (_, i) => {
            const label = format(new Date(viewYear, i, 1), 'MMM');
            const disabled = isMonthDisabled(viewYear, i);
            const active = i === viewMonth;
            return (
              <button
                key={label}
                type="button"
                disabled={disabled}
                onClick={() => pickMonth(i)}
                className={`rounded-md px-2 py-2 text-center text-sm font-medium transition-colors ${
                  disabled
                    ? 'cursor-not-allowed text-gray-300'
                    : active
                      ? 'bg-[var(--color-brand-primary)] text-white'
                      : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {panel === CAL_DAYS && (
        <>
          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((d, i) => (
              <div
                key={`${d}-${i}`}
                className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} className="h-8" />
            ))}
            {days.map((day) => {
              const ymd = toYmd(day);
              const disabled =
                (minDate && isBefore(day, minDate) && !isSameDay(day, minDate))
                || (maxDate && isAfter(day, maxDate) && !isSameDay(day, maxDate));
              const isSelected = selected && isSameDay(day, selected);
              const isToday = ymd === todayYmd;

              return (
                <button
                  key={ymd}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(ymd)}
                  className={`flex h-8 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                    disabled
                      ? 'cursor-not-allowed text-gray-300'
                      : isSelected
                        ? 'bg-[var(--color-brand-primary)] text-white shadow-sm'
                        : isToday
                          ? 'bg-[var(--color-surface-highlight-strong)] text-[var(--color-brand-primary)] hover:bg-[var(--color-surface-highlight)]'
                          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)]'
                  } ${!isSameMonth(day, month) ? 'opacity-40' : ''}`}
                >
                  {format(day, 'd')}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border-default)] pt-2">
        {panel === CAL_DAYS ? (
          <>
            <button
              type="button"
              onClick={onClear}
              className="px-1 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={todayYmd < minYmd || todayYmd > maxYmd}
              onClick={() => onToday(clampYmd(todayYmd, minYmd, maxYmd))}
              className="px-1 text-xs font-semibold text-[var(--color-brand-primary)] transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Today
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setPanel(CAL_DAYS)}
            className="px-1 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            Back
          </button>
        )}
      </div>
    </div>
  );
}

const DEFAULT_CLEAR_TO = { type: 'thisMonth', value: null };

export default function DateFilter({
  value,
  onChange,
  loading = false,
  className = '',
  variant = 'default',
  /** When false (Overview), "All time" is hidden; clear resets to this month. */
  showAllTime = false,
  clearTo = DEFAULT_CLEAR_TO,
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(VIEW_MAIN);
  const rootRef = useRef(null);

  // For Custom Date Range
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customPicking, setCustomPicking] = useState(null); // null | 'start' | 'end'
  const [calMonth, setCalMonth] = useState(() => startOfMonth(new Date()));
  const [calPos, setCalPos] = useState(null); // { top, left, width }
  const startFieldRef = useRef(null);
  const endFieldRef = useRef(null);
  const calPopupRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      const inRoot = rootRef.current?.contains(e.target);
      const inCal = calPopupRef.current?.contains(e.target);
      if (!inRoot && !inCal) {
        setOpen(false);
        setView(VIEW_MAIN);
        setCustomPicking(null);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useLayoutEffect(() => {
    if (!customPicking) {
      setCalPos(null);
      return;
    }
    const el = customPicking === 'start' ? startFieldRef.current : endFieldRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setCalPos({
        top: rect.bottom + 6,
        left: rect.left,
        width: Math.max(rect.width, 256),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [customPicking]);

  const handleSelectType = (type, val = null) => {
    setOpen(false);
    setView(VIEW_MAIN);
    setCustomPicking(null);
    const sameType = value?.type === type;
    const sameValue = (value?.value ?? null) === (val ?? null)
      || (type === 'custom'
        && value?.value?.start === val?.start
        && value?.value?.end === val?.end);
    if (sameType && sameValue) return;
    onChange({ type, value: val });
  };

  const resetFilter = () => {
    handleSelectType(clearTo.type, clearTo.value ?? null);
  };

  const currentLabel = useMemo(() => {
    if (!value || value.type === 'all') return showAllTime ? 'All time' : 'This month';
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
  }, [value, showAllTime]);

  const now = new Date();
  // Custom window: 1 Jan last year → today.
  const customMinDate = startOfYear(subYears(now, 1));
  const customMaxDate = now;
  const customMinYmd = toYmd(customMinDate);
  const customMaxYmd = toYmd(customMaxDate);

  const openCustomView = () => {
    const existingStart = value?.type === 'custom' ? value.value?.start : '';
    const existingEnd = value?.type === 'custom' ? value.value?.end : '';
    const start = clampYmd(existingStart || '', customMinYmd, customMaxYmd);
    const end = clampYmd(existingEnd || '', customMinYmd, customMaxYmd);
    setCustomStart(start);
    setCustomEnd(end);
    setCustomPicking(null);
    setView(VIEW_CUSTOM);
  };

  const focusField = (field) => {
    if (customPicking === field) {
      setCustomPicking(null);
      return;
    }
    setCustomPicking(field);
    const ymd = field === 'start' ? customStart : customEnd;
    const anchor = parseYmd(ymd) || now;
    setCalMonth(startOfMonth(anchor));
  };

  const handleCalendarSelect = (ymd) => {
    if (customPicking === 'start') {
      const next = clampYmd(ymd, customMinYmd, customEnd || customMaxYmd);
      setCustomStart(next);
      if (customEnd && customEnd < next) setCustomEnd('');
      // Open end picker next if it still needs a value
      if (!customEnd || customEnd < next) {
        setCustomPicking('end');
        setCalMonth(startOfMonth(parseYmd(next) || now));
      } else {
        setCustomPicking(null);
      }
    } else if (customPicking === 'end') {
      const next = clampYmd(ymd, customStart || customMinYmd, customMaxYmd);
      setCustomEnd(next);
      setCustomPicking(null);
    }
  };

  const handleCalendarClear = () => {
    if (customPicking === 'start') setCustomStart('');
    else if (customPicking === 'end') setCustomEnd('');
  };

  const handleCalendarToday = (ymd) => {
    handleCalendarSelect(ymd);
  };

  const calMinYmd = customPicking === 'end' && customStart ? customStart : customMinYmd;
  const calMaxYmd = customPicking === 'start' && customEnd ? customEnd : customMaxYmd;

  const formatFieldLabel = (ymd) => {
    if (!ymd) return 'Select date';
    return format(parseYmd(ymd), 'dd MMM yyyy');
  };

  const renderMainMenu = () => (
    <div className="py-1 min-w-[200px]">
      {[
        ...(showAllTime ? [{ label: 'All time', type: 'all' }] : []),
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
      <button
        type="button"
        onClick={openCustomView}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-highlight)]"
      >
        <span>Custom date range</span>
        <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)]" />
      </button>
    </div>
  );

  const fieldButtonClass = (active) =>
    `flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm transition-colors ${
      active
        ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/5 text-[var(--color-text-primary)] ring-1 ring-[var(--color-brand-primary)]'
        : 'border-[var(--color-border-default)] bg-white text-[var(--color-text-primary)] hover:border-[var(--color-border-focus)]'
    }`;

  const renderDateField = (field, label, ymd) => {
    const isOpen = customPicking === field;
    const fieldRef = field === 'start' ? startFieldRef : endFieldRef;
    return (
      <div>
        <label className="mb-1 block text-xs font-semibold text-[var(--color-text-secondary)]">
          {label}
        </label>
        <button
          ref={fieldRef}
          type="button"
          onClick={() => focusField(field)}
          aria-expanded={isOpen}
          className={fieldButtonClass(isOpen)}
        >
          <span className={ymd ? '' : 'text-[var(--color-text-muted)]'}>
            {formatFieldLabel(ymd)}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
    );
  };

  const floatingCalendar = customPicking && calPos
    ? createPortal(
        <div
          ref={calPopupRef}
          className="fixed z-[80]"
          style={{ top: calPos.top, left: calPos.left, width: calPos.width }}
        >
          <div className="rounded-xl shadow-[var(--shadow-modal)]">
            <DayCalendar
              key={customPicking}
              month={calMonth}
              onMonthChange={setCalMonth}
              selectedYmd={customPicking === 'start' ? customStart : customEnd}
              minYmd={calMinYmd}
              maxYmd={calMaxYmd}
              onSelect={handleCalendarSelect}
              onClear={handleCalendarClear}
              onToday={handleCalendarToday}
            />
          </div>
        </div>,
        document.body,
      )
    : null;

  const renderCustomMenu = () => (
    <div className="w-[280px] p-3">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setCustomPicking(null);
            setView(VIEW_MAIN);
          }}
          className="-ml-1 p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-bold text-[var(--color-text-primary)]">Custom range</span>
      </div>

      <div className="mb-3 space-y-2">
        {renderDateField('start', 'Start date', customStart)}
        {renderDateField('end', 'End date', customEnd)}
      </div>

      <button
        type="button"
        disabled={!customStart || !customEnd || customStart > customEnd}
        onClick={() => handleSelectType('custom', { start: customStart, end: customEnd })}
        className="h-9 w-full rounded-lg bg-[var(--color-brand-primary)] text-sm font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Apply range
      </button>
    </div>
  );

  const isCleared = showAllTime
    ? !value || value.type === 'all'
    : value?.type === (clearTo?.type || 'thisMonth')
      && (value?.value ?? null) === (clearTo?.value ?? null);
  const hasFilter = !isCleared;

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
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0 animate-spin" />
            ) : (
              <Calendar className={`w-3.5 h-3.5 shrink-0 ${hasFilter ? 'text-[var(--color-brand-primary)]' : 'text-[var(--color-text-muted)]'}`} />
            )}
            <span className="truncate text-left">{currentLabel}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {hasFilter && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  resetFilter();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    resetFilter();
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
          <div className="absolute left-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-white shadow-[var(--shadow-modal)]">
            {view === VIEW_MAIN && renderMainMenu()}
            {view === VIEW_CUSTOM && renderCustomMenu()}
          </div>
        )}
        {floatingCalendar}
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
          {loading ? (
            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
          ) : (
            <Calendar className="w-4 h-4 shrink-0" />
          )}
          <span className="whitespace-nowrap">Filter by: {currentLabel}</span>
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {hasFilter && (
          <button
            type="button"
            onClick={resetFilter}
            className="p-2 text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Clear filter"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-white shadow-[var(--shadow-modal)]">
          {view === VIEW_MAIN && renderMainMenu()}
          {view === VIEW_CUSTOM && renderCustomMenu()}
        </div>
      )}
      {floatingCalendar}
    </div>
  );
}
