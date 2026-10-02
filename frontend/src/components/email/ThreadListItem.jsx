import { formatListTime } from '../../utils/dateTime';

function getPreviewLine(body) {
  if (!body) return '';
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  const meaningful =
    lines.find(
      (line) => line.length > 8 && !/^(hi|hello)(\s+there)?,?$/i.test(line),
    ) || lines.join(' ');
  const trimmed = meaningful.length > 80 ? meaningful.slice(0, 80).trimEnd() : meaningful;
  return trimmed ? `${trimmed}...` : '';
}

// Gmail-style participant label. When Andrea has already replied at some
// point in the thread we still lead with the customer's name (per Andrea's
// explicit UX choice) — she cares about who she's talking *to*, not that she
// showed up in the thread. Multi-participant threads collapse extras into
// "Name, Name, +N".
function participantLabel(thread) {
  const names = thread.participants.map((p) => p.name).filter(Boolean);
  if (names.length === 0) return thread.latestMessage?.from || 'Unknown';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]}, ${names[1]}, +${names.length - 2}`;
}

/**
 * One list row = one thread. Preserves the current row visual language so the
 * list looks identical when a thread has a single message.
 */
export default function ThreadListItem({ thread, selected, checked, onClick, onCheck }) {
  const unread = thread.unreadCount > 0;
  const latest = thread.latestMessage;

  const rowClass = selected
    ? unread
      ? 'bg-[#eef5ff] hover:bg-[#e3effc]'
      : 'bg-[#f4f5f7] hover:bg-[#eceef2]'
    : unread
      ? 'bg-[#eef5ff] hover:bg-[#e3effc]'
      : 'bg-white hover:bg-[var(--color-surface-panel)]/80';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected || undefined}
      data-email-thread-selected={selected || undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`relative w-full text-left px-4 py-2 border-b border-[var(--color-border-default)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-primary)]/40 ${rowClass} ${
        selected ? 'shadow-[inset_3px_0_0_0_var(--color-brand-primary)]' : ''
      }`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            e.stopPropagation();
            onCheck();
          }}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--color-brand-primary)]/35 text-[var(--color-brand-primary)] focus:ring-[var(--color-brand-primary)] cursor-pointer shrink-0 accent-[var(--color-brand-primary)]"
          aria-label={`Select thread from ${participantLabel(thread)}`}
        />

        <div className="flex-1 min-w-0">
          <p
            className={`text-sm truncate leading-snug ${
              unread
                ? 'font-bold text-[var(--color-text-primary)]'
                : selected
                  ? 'font-normal text-[var(--color-brand-primary)]'
                  : 'font-normal text-[var(--color-text-secondary)]'
            }`}
          >
            {thread.subject}
            {thread.messageCount > 1 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-[var(--color-surface-highlight-strong)]/80 px-1.5 text-[10px] font-semibold tabular-nums text-[var(--color-brand-primary)] align-middle">
                {thread.messageCount}
              </span>
            )}
          </p>
          <p
            className={`text-xs mt-0.5 truncate ${
              unread ? 'font-semibold text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'
            }`}
          >
            {participantLabel(thread)}
          </p>
          <p className="text-[11px] mt-0.5 truncate leading-snug text-[var(--color-text-muted)]">
            {getPreviewLine(latest?.snippet || latest?.body)}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 min-w-[2.25rem]">
          {unread && (
            <span
              className="w-2 h-2 rounded-full bg-[var(--color-brand-primary)] ring-2 ring-[#eef5ff] shrink-0"
              aria-label={`${thread.unreadCount} unread`}
            />
          )}
          <span
            className={`text-[10px] tabular-nums ${
              unread ? 'font-bold text-[var(--color-brand-primary)]/75' : 'text-[var(--color-text-muted)]'
            }`}
          >
            {formatListTime(latest?.receivedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
