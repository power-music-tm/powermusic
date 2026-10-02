import { CheckCircle2, Clock3, Inbox, Sparkles } from 'lucide-react';
import { MANAGER_REQUEST_TABS } from '../../utils/managerRequestHistory';

const EMPTY_STATES = {
  all: {
    icon: Inbox,
    title: 'No requests yet',
    description: 'Submit an add or remove request from the form and it will show up here.',
  },
  new: {
    icon: Clock3,
    title: 'Nothing pending',
    description: 'You have no requests waiting for Power Music to action.',
  },
  handled: {
    icon: CheckCircle2,
    title: 'No handled requests',
    description: 'Completed requests appear here once Power Music has actioned them.',
  },
};

export default function ManagerRequestHistoryEmpty({ activeTab }) {
  const tab = MANAGER_REQUEST_TABS.find((item) => item.value === activeTab) ?? MANAGER_REQUEST_TABS[0];
  const state = EMPTY_STATES[activeTab] ?? EMPTY_STATES.all;
  const Icon = state.icon;

  return (
    <div
      role="status"
      aria-label={`${tab.label}: ${state.title}`}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-manager-border)] bg-[var(--color-manager-panel)]/40 px-6 py-12 text-center"
    >
      <span
        aria-hidden="true"
        className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1 ring-[var(--color-manager-border)]"
      >
        <Icon className="h-4 w-4 text-[var(--color-text-muted)]" />
      </span>
      <p className="text-sm font-semibold text-[var(--color-text-primary)]">{state.title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--color-text-secondary)]">
        {state.description}
      </p>
    </div>
  );
}

export function ManagerRequestHistoryNotice({ unreadCount, onDismissAll }) {
  if (unreadCount <= 0) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-[var(--color-brand-primary)]/15 bg-[var(--color-brand-primary)]/[0.04] px-4 py-2.5 sm:px-6"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]"
      >
        <Sparkles className="h-3 w-3" />
      </span>
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--color-text-secondary)]">
        <span className="font-semibold text-[var(--color-text-primary)]">
          {unreadCount} update{unreadCount === 1 ? '' : 's'} to review
        </span>
        {' — '}
        tap a highlighted row to mark as seen
      </p>
      <button
        type="button"
        onClick={onDismissAll}
        className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--color-brand-primary)] transition-colors hover:bg-[var(--color-brand-primary)]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/30"
      >
        Mark all seen
      </button>
    </div>
  );
}
