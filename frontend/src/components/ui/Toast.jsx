import { createPortal } from 'react-dom';
import { X, AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';
import { useToast } from './useToast';
import HoverTip from './HoverTip';

/** Above Modal (110), Drawer (101), and sidebar overlays. */
const TOAST_Z_INDEX = 9999;

const animationStyle = `
  @keyframes toastSlideIn {
    from {
      transform: translateX(120%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  .animate-toast-slide-in {
    animation: toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
`;

const TOAST_VARIANTS = {
  success: {
    borderClass: 'border-l-[var(--color-signal-green)]',
    Icon: CheckCircle,
    iconColor: 'text-[var(--color-signal-green)]',
  },
  error: {
    borderClass: 'border-l-[var(--color-signal-red)]',
    Icon: AlertCircle,
    iconColor: 'text-[var(--color-signal-red)]',
  },
  warning: {
    borderClass: 'border-l-[var(--color-signal-amber)]',
    Icon: AlertTriangle,
    iconColor: 'text-[var(--color-signal-amber)]',
  },
  info: {
    borderClass: 'border-l-[var(--color-signal-neutral)]',
    Icon: null,
    iconColor: '',
  },
};

export default function Toast() {
  const { toasts, dismissToast } = useToast();

  if (!toasts || toasts.length === 0 || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <style>{animationStyle}</style>
      <div
        className="fixed bottom-6 right-6 flex flex-col gap-3 pointer-events-none select-none pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)]"
        style={{ zIndex: TOAST_Z_INDEX }}
      >
        {toasts.map((toast) => {
          const variant = TOAST_VARIANTS[toast.type] || TOAST_VARIANTS.success;
          const { borderClass, Icon, iconColor } = variant;

          return (
            <div
              key={toast.id}
              className={`w-[320px] bg-white border border-[var(--color-border-default)] border-l-4 ${borderClass} rounded shadow-[var(--shadow-modal)] p-4 flex items-start gap-3 pointer-events-auto transform transition-all duration-300 animate-toast-slide-in`}
            >
              {Icon ? <Icon className={`w-5 h-5 shrink-0 ${iconColor}`} aria-hidden="true" /> : null}

              <div className={`flex-1 text-sm text-[var(--color-text-primary)] font-medium leading-tight ${Icon ? 'pt-0.5' : ''}`}>
                {toast.message}
              </div>

              {/* Close Button */}
              <HoverTip label="Dismiss" placement="left">
                <button
                  onClick={() => dismissToast(toast.id)}
                  className="p-0.5 rounded-md text-[var(--color-text-secondary)] hover:bg-gray-100 hover:text-[var(--color-text-primary)] transition-colors focus:outline-none shrink-0"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </HoverTip>
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
}
