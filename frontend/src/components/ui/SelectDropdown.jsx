import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ChevronDown, Search } from 'lucide-react';

const TRIGGER_STYLES = {
  xs: 'px-3 py-2 text-xs font-semibold',
  sm: 'h-9 px-3 text-sm font-medium',
  md: 'px-3.5 py-2 text-sm font-semibold',
};

const MENU_MAX_PX = 24 * 16; // 24rem
const TRIGGER_MAX_PX = 18 * 16; // 18rem

export default function SelectDropdown({
  value,
  onChange,
  options,
  size = 'sm',
  className = '',
  align = 'left',
  menuClassName = '',
  disabled = false,
  variant = 'default',
  searchable = false,
  searchPlaceholder = 'Search…',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuWidth, setMenuWidth] = useState(null);
  const [triggerWidth, setTriggerWidth] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const measureRef = useRef(null);
  const triggerMeasureRef = useRef(null);
  const searchRef = useRef(null);
  const selected = options.find((opt) => opt.value === value) ?? options[0];
  const fitContent = searchable;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setMenuWidth(null);
      return;
    }
    if (!searchable) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, searchable]);

  const filteredOptions = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => String(opt.label ?? '').toLowerCase().includes(q));
  }, [options, query, searchable]);

  const viewportCap = () => Math.max(160, window.innerWidth - 32);

  // Closed control: grow with selected label up to cap (no horizontal scroll).
  useLayoutEffect(() => {
    if (!fitContent) {
      setTriggerWidth(null);
      return;
    }
    const el = triggerMeasureRef.current;
    if (!el) return;
    const natural = Math.ceil(el.getBoundingClientRect().width);
    const capped = Math.min(Math.max(natural, 140), TRIGGER_MAX_PX, viewportCap());
    setTriggerWidth(capped);
  }, [fitContent, selected?.label, size]);

  // Open menu: grow with widest option up to cap; overflow wraps, never scrolls horizontally.
  useLayoutEffect(() => {
    if (!open) return;

    const triggerW = triggerRef.current?.offsetWidth ?? 140;
    const cap = Math.min(MENU_MAX_PX, viewportCap());

    let widest = triggerW;
    const nodes = measureRef.current?.querySelectorAll('[data-measure-option]');
    nodes?.forEach((node) => {
      widest = Math.max(widest, Math.ceil(node.getBoundingClientRect().width));
    });

    setMenuWidth(Math.min(Math.max(widest, triggerW), cap));
  }, [open, filteredOptions, query]);

  const handleSelect = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
  };

  return (
    <div
      ref={rootRef}
      className={`relative min-w-0 max-w-full ${fitContent ? 'inline-flex flex-col' : ''} ${className}`}
      style={fitContent && triggerWidth != null ? { width: triggerWidth } : undefined}
    >
      {fitContent && (
        <span
          ref={triggerMeasureRef}
          aria-hidden="true"
          className={`pointer-events-none invisible absolute whitespace-nowrap ${TRIGGER_STYLES[size]}`}
        >
          {selected?.label}
          <span className="inline-block w-8" />
        </span>
      )}

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`${fitContent ? 'flex w-full' : 'w-full flex'} items-center justify-between gap-2 rounded-lg focus:outline-none transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          variant === 'brand'
            ? 'bg-[var(--color-surface-highlight-strong)] border-2 border-[var(--color-brand-primary)]/25 text-[var(--color-brand-primary)] font-semibold shadow-sm hover:border-[var(--color-brand-primary)]/50 focus:border-[var(--color-brand-primary)]'
            : variant === 'soft'
              ? 'bg-white/60 backdrop-blur-sm border border-[var(--color-brand-primary)]/15 text-[var(--color-brand-primary)] font-semibold hover:bg-white/80 focus:border-[var(--color-brand-primary)]/30'
              : variant === 'inverse'
              ? 'bg-[var(--color-brand-secondary)]/30 border border-[var(--color-brand-secondary-border)]/50 text-white font-semibold shadow-sm hover:bg-[var(--color-brand-secondary)]/45 hover:border-[var(--color-brand-secondary-border)]/70 focus:border-[var(--color-brand-secondary-border)] focus:ring-2 focus:ring-[var(--color-brand-secondary)]/25'
              : 'bg-white border border-[var(--color-border-default)] text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)]'
        } ${TRIGGER_STYLES[size]}`}
      >
        <span className="min-w-0 flex-1 truncate text-left" title={selected?.label}>
          {selected?.label}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${
          variant === 'inverse' ? 'text-[var(--color-brand-secondary-border)]' : 'text-[var(--color-text-muted)]'
        }`} />
      </button>

      {open && (
        <div
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none fixed left-[-10000px] top-0 whitespace-nowrap"
        >
          {filteredOptions.map((opt) => (
            <div
              key={`measure-${String(opt.value)}`}
              data-measure-option
              className="inline-block px-3 py-2 text-sm font-medium"
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl shadow-[var(--shadow-modal)] ${
            variant === 'inverse'
              ? 'border border-[var(--color-brand-secondary-border)]/40 bg-[var(--color-surface-sidebar)]'
              : 'border border-[var(--color-border-default)] bg-white'
          } ${menuClassName}`}
          style={{
            width: menuWidth != null ? `${menuWidth}px` : undefined,
            minWidth: triggerRef.current ? `${triggerRef.current.offsetWidth}px` : '140px',
            maxWidth: `min(${MENU_MAX_PX}px, calc(100vw - 2rem))`,
          }}
        >
          <div className="max-h-72 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
            {searchable && (
              <div className={`sticky top-0 z-10 p-2 ${
                variant === 'inverse'
                  ? 'border-b border-white/10 bg-[var(--color-surface-sidebar)]'
                  : 'border-b border-[var(--color-border-default)] bg-white'
              }`}>
                <div className="relative min-w-0">
                  <Search className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${
                    variant === 'inverse' ? 'text-white/45' : 'text-[var(--color-text-muted)]'
                  }`} />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setOpen(false);
                      }
                    }}
                    placeholder={searchPlaceholder}
                    className={`w-full min-w-0 rounded-lg py-1.5 pl-8 pr-2 text-sm focus:outline-none ${
                      variant === 'inverse'
                        ? 'border border-white/15 bg-white/10 text-white placeholder:text-white/40 focus:border-[var(--color-brand-secondary-border)]'
                        : 'border border-[var(--color-border-default)] bg-white text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focus)]'
                    }`}
                  />
                </div>
              </div>
            )}
            <div className="min-w-0 max-w-full py-1">
              {filteredOptions.length === 0 ? (
                <div className={`px-3 py-2 text-sm ${
                  variant === 'inverse' ? 'text-white/45' : 'text-[var(--color-text-muted)]'
                }`}>
                  No matches
                </div>
              ) : (
                filteredOptions.map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    title={opt.label}
                    className={`block w-full min-w-0 max-w-full text-left px-3 py-2 text-sm font-medium transition-colors cursor-pointer break-words whitespace-normal [overflow-wrap:anywhere] ${
                      variant === 'inverse'
                        ? value === opt.value
                          ? 'bg-[var(--color-brand-accent)] text-white shadow-sm'
                          : 'text-white/85 hover:bg-[var(--color-surface-sidebar-hover)] hover:text-white'
                        : value === opt.value
                          ? 'bg-[var(--color-surface-highlight-strong)] text-[var(--color-brand-primary)]'
                          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
