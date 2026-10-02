import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';

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

/**
 * Personalized welcome for the manager portal home column.
 */
export default function ManagerWelcomeNote({
  firstName = '',
  email = '',
  partnerName = null,
  clubLocation = null,
}) {
  const greeting = useMemo(() => greetingForHour(new Date().getHours()), []);
  const name = displayFirstName(firstName, email);
  const partner = partnerName?.trim() || null;
  const club = clubLocation?.trim() || null;

  const contextLine = partner && club
    ? `You're signed in for ${partner} · ${club}.`
    : partner
      ? `You're signed in for ${partner}.`
      : club
        ? `Managing access for ${club}.`
        : 'Submit requests here and Power Music will action them for you.';

  return (
    <section
      aria-label="Welcome"
      className="relative overflow-hidden rounded-xl border border-[var(--color-border-default)]/80 bg-white p-4 shadow-sm sm:p-5"
    >
      <div
        className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-[var(--color-brand-primary)]/[0.04]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-12 -left-6 h-28 w-28 rounded-full bg-[var(--color-brand-accent)]/[0.05]"
        aria-hidden="true"
      />

      <div className="relative flex items-start gap-3">
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-primary)] text-white shadow-sm"
          aria-hidden="true"
        >
          <Sparkles className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            {greeting}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-xl">
            Welcome back, {name}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {contextLine}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
            Search existing users, track your submissions, then send a new add or remove request when
            you&apos;re ready — Power Music will take it from there.
          </p>
        </div>
      </div>
    </section>
  );
}
