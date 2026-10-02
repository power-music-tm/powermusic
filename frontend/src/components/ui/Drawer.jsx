import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import DottedScroll from './DottedScroll';
import HoverTip from './HoverTip';

export default function Drawer({
  isOpen,
  onClose,
  title,
  children,
  footer,
  fill = false,
  hideHeader = false,
  widthClass = 'w-full max-w-full sm:max-w-[420px]',
}) {
  const titleId = useId();
  const closeRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [isOpen, onClose]);

  if (typeof document === 'undefined') return null;

  const closeButton = (
    <HoverTip label="Close" placement="left">
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-brand-primary)] focus:outline-none"
        aria-label="Close"
      >
        <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>
    </HoverTip>
  );

  const body = (
    <div
      className={`flex flex-1 flex-col px-4 ${
        hideHeader
          ? 'pb-4 pt-[max(3.25rem,calc(env(safe-area-inset-top)+2.5rem))]'
          : 'py-4'
      } ${fill ? 'min-h-0 overflow-hidden' : ''}`}
    >
      {children}
    </div>
  );

  return createPortal(
    <>
      <div
        aria-hidden={!isOpen}
        onClick={onClose}
        className={`fixed inset-0 z-[98] bg-[var(--color-text-primary)]/20 backdrop-blur-[1px] transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!isOpen}
        inert={isOpen ? undefined : true}
        className={`fixed top-0 right-0 bottom-0 z-[101] flex w-full ${widthClass} flex-col border-l border-[var(--color-border-default)] bg-white shadow-[var(--shadow-drawer)] transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
      >
        {hideHeader ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : (
          <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-default)] bg-white px-4 pt-[env(safe-area-inset-top)] sm:pt-0">
            <h2
              id={titleId}
              className="truncate text-sm font-semibold tracking-tight text-[var(--color-text-primary)]"
            >
              {title}
            </h2>
            {closeButton}
          </header>
        )}

        <div className="relative flex min-h-0 flex-1 flex-col bg-[var(--color-surface-bg)] overflow-hidden">
          {hideHeader ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end px-4 pt-[max(1rem,env(safe-area-inset-top))]">
              <div className="pointer-events-auto">{closeButton}</div>
            </div>
          ) : null}
          {fill ? (
            body
          ) : (
            <DottedScroll
              className="min-h-0 flex-1"
              scrollClassName="h-full overflow-y-scroll scrollbar-hide overscroll-contain pr-4 sm:pr-0"
              contentClassName="flex min-h-full flex-col"
              indicatorPlacement="gutter"
              indicatorClassName="sm:hidden"
            >
              {body}
            </DottedScroll>
          )}
        </div>

        {footer ? (
          <footer className="shrink-0 border-t border-[var(--color-border-default)] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </>,
    document.body,
  );
}
