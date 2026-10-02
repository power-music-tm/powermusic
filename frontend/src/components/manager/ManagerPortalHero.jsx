import { useMemo } from 'react';
import { ClipboardList, ChevronRight, Loader2 } from 'lucide-react';

function greetingForHour(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function displayFirstName(firstName, email) {
  const trimmed = firstName?.trim();
  if (trimmed) return trimmed;
  const local = String(email || '').split('@')[0];
  return local || 'there';
}

const requestsCardClass =
  'flex shrink-0 flex-col rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.2)] backdrop-blur-md sm:px-5 sm:py-3';

/**
 * Personalized portal hero — bridges splash/auth drama into the work surface.
 */
export default function ManagerPortalHero({
  firstName = '',
  email = '',
  partnerName = null,
  clubLocation = null,
  pendingCount = 0,
  handledCount = 0,
  totalCount = 0,
  badgeCount = 0,
  loading = false,
  onOpenRequests,
}) {
  const greeting = useMemo(() => greetingForHour(new Date().getHours()), []);
  const name = displayFirstName(firstName, email);
  const partner = partnerName?.trim() || null;
  const club = clubLocation?.trim() || null;

  const contextLine = partner && club
    ? `${partner} · ${club}`
    : partner
      ? partner
      : club
        ? club
        : 'Power Music partner portal';

  const requestsBody = loading ? (
    <div className="flex items-center gap-2 text-sm text-white/50">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading…
    </div>
  ) : (
    <div className="flex items-stretch gap-3 sm:gap-4">
      <div className="min-w-[3rem]">
        <p className="text-xl font-semibold tabular-nums leading-none text-white">{totalCount}</p>
        <p className="mt-1 text-[11px] font-medium text-white/50">Total</p>
      </div>
      <div className="w-px shrink-0 bg-white/10" aria-hidden="true" />
      <div className="min-w-[3rem]">
        <p className="text-xl font-semibold tabular-nums leading-none text-white">{pendingCount}</p>
        <p className="mt-1 text-[11px] font-medium text-amber-300/90">Pending</p>
      </div>
      <div className="w-px shrink-0 bg-white/10" aria-hidden="true" />
      <div className="min-w-[3rem]">
        <p className="text-xl font-semibold tabular-nums leading-none text-white">{handledCount}</p>
        <p className="mt-1 text-[11px] font-medium text-white/50">Handled</p>
      </div>
    </div>
  );

  const requestsCard = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 shrink-0 text-white/55" aria-hidden="true" />
          <p className="text-[11px] font-semibold tracking-wide text-white/90 sm:text-xs">
            Your requests
          </p>
        </div>
        {badgeCount > 0 ? (
          <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--color-brand-accent)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        ) : null}
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        {requestsBody}
        {onOpenRequests && !loading ? (
          <button
            type="button"
            onClick={onOpenRequests}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-white/15 bg-white/[0.08] px-2.5 py-1.5 text-[11px] font-semibold text-white/90 transition-colors hover:border-white/25 hover:bg-white/[0.12] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
            aria-label={`View your requests, ${totalCount} total, ${pendingCount} pending, ${handledCount} handled${badgeCount > 0 ? `, ${badgeCount} to review` : ''}`}
          >
            View
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </>
  );

  return (
    <section
      aria-label="Welcome"
      className="relative shrink-0 overflow-hidden border-b border-white/[0.06] bg-gradient-to-br from-[var(--color-manager-hero-from)] via-[#1f2038] to-[var(--color-manager-hero-to)]"
    >
      <div
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--color-brand-accent)]/[0.14] blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-24 -left-12 h-48 w-48 rounded-full bg-[var(--color-brand-secondary)]/20 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(255,255,255,0.08),transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-[1520px] px-4 py-3.5 sm:px-6 sm:py-4 md:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
              {greeting}
            </p>
            <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-white sm:text-xl">
              Welcome back,{' '}
              <span className="bg-gradient-to-r from-white to-white/85 bg-clip-text text-transparent">
                {name}
              </span>
            </h1>
            <p className="mt-1 text-sm text-white/55">{contextLine}</p>
          </div>

          <div className={requestsCardClass}>{requestsCard}</div>
        </div>
      </div>
    </section>
  );
}
