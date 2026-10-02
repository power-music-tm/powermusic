import { Sparkles } from 'lucide-react';

export function Skeleton({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[var(--color-surface-highlight)] ${className}`}
      aria-hidden="true"
    />
  );
}

export function KpiSkeletonGrid({ count = 3, cols = 3 }) {
  return (
    <div className={`grid gap-2.5 shrink-0 ${cols >= 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-white border border-[var(--color-border-default)] rounded-xl p-3.5 flex items-center justify-between shadow-sm"
        >
          <div className="flex-1 space-y-2">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
          <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function PanelListSkeleton({ rows = 3 }) {
  return (
    <div className="p-2.5 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg border border-[var(--color-border-default)]">
          <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActivitySkeleton({ rows = 4 }) {
  return (
    <div className="p-3 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-2.5">
          <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmailListSkeleton({ rows = 8 }) {
  return (
    <div className="divide-y divide-[var(--color-border-default)]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex gap-3">
          <Skeleton className="h-4 w-4 rounded shrink-0 mt-1" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-full" />
          </div>
          <Skeleton className="h-2.5 w-8 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function CardListSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="bg-white border border-[var(--color-border-default)] rounded-xl p-5 space-y-3"
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Shown in the reading pane while AI is still composing a reply draft. */
export function DraftCreatingPanel({ subject }) {
  return (
    <div
      className="relative rounded-lg border border-[var(--color-border-default)]/60 bg-gradient-to-br from-white via-[#f8fafc] to-[#edf4fc] px-4 py-5 min-h-[120px] overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label="Reply draft is being created"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        aria-hidden="true"
        style={{
          background:
            'linear-gradient(105deg, transparent 40%, rgba(107, 175, 240, 0.12) 50%, transparent 60%)',
          backgroundSize: '200% 100%',
          animation: 'draft-shimmer 2.2s ease-in-out infinite',
        }}
      />
      <div className="relative flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-highlight)] text-[var(--color-brand-primary)] shadow-sm">
          <Sparkles className="w-4 h-4 animate-pulse" style={{ animationDuration: '1.8s' }} />
        </div>
        <div className="flex-1 min-w-0 space-y-3 pt-0.5">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
              Composing your reply…
            </p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
              {subject
                ? `Drafting a response to “${subject.length > 48 ? `${subject.slice(0, 48)}…` : subject}”.`
                : 'AI is preparing a reply draft for this message.'}
              {' '}This usually takes a few seconds.
            </p>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-[92%]" />
            <Skeleton className="h-3 w-[78%]" />
            <Skeleton className="h-3 w-[55%]" />
          </div>
        </div>
      </div>
    </div>
  );
}
