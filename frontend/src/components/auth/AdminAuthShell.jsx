import { Toast } from '../ui';
import { FlowGradientBackground } from '../ui/flow-gradient-hero-section';
import { AUTH_PAGE_CANVAS, useAuthPageCanvas } from './useAuthPageCanvas';

/**
 * Admin sign-in shell — liquid gradient + centered auth card.
 */
export default function AdminAuthShell({ children, footnote = 'Authorized personnel only.' }) {
  useAuthPageCanvas();

  return (
    <div
      className="fixed inset-0 z-0 overflow-y-auto overscroll-y-none"
      style={{ backgroundColor: AUTH_PAGE_CANVAS }}
    >
      <FlowGradientBackground className="pointer-events-none fixed inset-0 z-0" interactive />

      <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-3 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 sm:py-10 antialiased font-sans">
        <Toast />

        <main className="w-full min-w-0 max-w-[420px]">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white shadow-[0_24px_64px_rgba(0,0,0,0.35)] sm:rounded-2xl">
            <div className="border-b border-[var(--color-border-default)] bg-gradient-to-b from-white to-[var(--color-surface-panel)]/40 px-5 pb-6 pt-7 text-center sm:px-8 sm:pb-7 sm:pt-8">
              <div className="mx-auto mb-4 inline-flex items-center justify-center rounded-xl bg-white p-2.5 shadow-[0_2px_12px_rgba(26,26,46,0.08)] ring-1 ring-black/[0.06] sm:p-3">
                <img src="/image.png" alt="" className="h-9 w-auto object-contain sm:h-10" width={120} height={40} />
              </div>
              <h1 className="text-base font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-lg">
                Power Music Ops
              </h1>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)] sm:text-sm">Admin dashboard</p>
            </div>

            <div className="px-5 py-6 sm:px-8 sm:py-7">{children}</div>
          </div>

          <p className="mt-4 px-2 text-center text-xs text-white/45 sm:mt-6">{footnote}</p>
        </main>
      </div>
    </div>
  );
}
