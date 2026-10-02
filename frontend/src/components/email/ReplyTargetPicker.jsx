import { formatDayTimeShort } from '../../utils/dateTime';
import { AlertCircle } from 'lucide-react';

function fmt(iso) {
  return formatDayTimeShort(iso);
}

/**
 * When a thread has more than one inbound message awaiting a reply — e.g.
 * Andrea was mid-edit on the first customer message and a follow-up arrived —
 * we show a small picker so she can decide which one to reply to first.
 *
 * Every candidate keeps its *own* AI draft (drafts are per-message, not per
 * thread) so switching between candidates never destroys her in-progress edit.
 * The one she doesn't act on now stays here until she gets to it.
 */
export default function ReplyTargetPicker({ candidates, activeId, onSelect }) {
  if (!candidates || candidates.length <= 1) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900">
        <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
        {candidates.length} messages on this thread need a reply. Pick which one first
      </p>
      <div className="flex flex-wrap gap-1.5">
        {candidates.map((msg) => {
          const active = msg.id === activeId;
          return (
            <button
              key={msg.id}
              type="button"
              onClick={() => onSelect(msg.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/40 ${
                active
                  ? 'border-[var(--color-brand-primary)] bg-white text-[var(--color-brand-primary)] shadow-sm'
                  : 'border-amber-200/80 bg-white/70 text-amber-900 hover:bg-white'
              }`}
            >
              <span className="max-w-[9rem] truncate">{msg.from}</span>
              <span className="opacity-70">{fmt(msg.receivedAt)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
