import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Instant hover label for icon-only controls (avoids slow native title tooltips).
 * @param {'bottom'|'top'|'right'|'left'} [placement='bottom']
 */
export default function HoverTip({ label, children, className = '', placement = 'bottom' }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, transform: 'translateX(-50%)' });

  const show = () => {
    const el = ref.current;
    if (!el || !label) return;
    const rect = el.getBoundingClientRect();
    if (placement === 'right') {
      setCoords({
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
        transform: 'translateY(-50%)',
      });
    } else if (placement === 'left') {
      setCoords({
        top: rect.top + rect.height / 2,
        left: rect.left - 8,
        transform: 'translate(-100%, -50%)',
      });
    } else if (placement === 'top') {
      setCoords({
        top: rect.top - 6,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, -100%)',
      });
    } else {
      setCoords({
        top: rect.bottom + 6,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
      });
    }
    setOpen(true);
  };

  const hide = () => setOpen(false);

  return (
    <span
      ref={ref}
      className={`inline-flex ${className}`.trim()}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && label
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[200] whitespace-nowrap rounded-md bg-[var(--color-brand-primary)] px-2 py-1 text-[11px] font-semibold leading-none text-white shadow-md"
              style={{ top: coords.top, left: coords.left, transform: coords.transform }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
