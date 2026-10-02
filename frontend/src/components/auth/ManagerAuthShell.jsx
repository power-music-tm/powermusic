import { Toast } from '../ui';
import { FlowGradientBackground } from '../ui/flow-gradient-hero-section';
import { AUTH_PAGE_CANVAS, useAuthPageCanvas } from './useAuthPageCanvas';
import AuthBrandingHeader from './AuthBrandingHeader';

const inputClass =
  'w-full h-11 px-3.5 bg-white text-sm rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:outline-none focus-visible:border-[var(--color-brand-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/20 disabled:opacity-60 disabled:cursor-not-allowed';

const labelClass = 'mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]';

const buttonClass =
  'mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-primary)] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-surface-sidebar-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const errorClass =
  'mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-900';

const formGridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2';

export { inputClass, labelClass, buttonClass, errorClass, formGridClass };

/** Auth placeholder — gradient canvas so partner auth screens never flash flat blank. */
export function ManagerAuthLoading({ partnerBranding = null }) {
  useAuthPageCanvas();

  return (
    <div
      className="fixed inset-0 z-0 overflow-hidden overscroll-y-none"
      style={{ backgroundColor: AUTH_PAGE_CANVAS }}
      aria-busy="true"
      aria-label="Loading"
    >
      <FlowGradientBackground className="pointer-events-none fixed inset-0" interactive />
      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-6">
        <div className="w-full max-w-[420px] overflow-hidden rounded-xl border border-white/10 bg-white shadow-[0_24px_64px_rgba(0,0,0,0.35)] sm:rounded-2xl">
          <div className="border-b border-[var(--color-border-default)] bg-gradient-to-b from-white to-[var(--color-surface-panel)]/40 px-5 pb-6 pt-7 text-center sm:px-8 sm:pb-7 sm:pt-8">
            <AuthBrandingHeader partnerBranding={partnerBranding} />
          </div>
          <div className="px-5 py-8 sm:px-8">
            <div className="mx-auto h-4 w-40 animate-pulse rounded bg-[var(--color-surface-panel)]" />
            <div className="mx-auto mt-3 h-4 w-56 animate-pulse rounded bg-[var(--color-surface-panel)]" />
          </div>
        </div>
      </div>
    </div>
  );
}

import { getPartnerTerminology } from '../../utils/managerAuthBranding';

export default function ManagerAuthShell({
  children,
  wide = false,
  footnote = null,
  partnerBranding = null,
}) {
  useAuthPageCanvas();
  const terms = getPartnerTerminology(partnerBranding?.partnerName);
  const displayFootnote = footnote || 'Partner managers only.';

  return (
    <div
      className="fixed inset-0 z-0 overflow-y-auto overscroll-y-none"
      style={{ backgroundColor: AUTH_PAGE_CANVAS }}
    >
      <FlowGradientBackground className="pointer-events-none fixed inset-0 z-0" interactive />

      <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-3 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 sm:py-10 antialiased font-sans">
        <Toast />

        <main className={`w-full min-w-0 ${wide ? 'max-w-[460px]' : 'max-w-[420px]'}`}>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white shadow-[0_24px_64px_rgba(0,0,0,0.35)] sm:rounded-2xl">
            <div className="border-b border-[var(--color-border-default)] bg-gradient-to-b from-white to-[var(--color-surface-panel)]/40 px-5 pb-6 pt-7 text-center sm:px-8 sm:pb-7 sm:pt-8">
              <AuthBrandingHeader partnerBranding={partnerBranding} />
            </div>

            <div className="px-5 py-6 sm:px-8 sm:py-7">{children}</div>
          </div>

          <p className="mt-4 px-2 text-center text-xs text-white/45 sm:mt-6">{displayFootnote}</p>
        </main>
      </div>
    </div>
  );
}
