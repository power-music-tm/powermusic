import { useState } from 'react';
import { formatWeekdayDayTime } from '../../utils/dateTime';
import { ChevronDown, ChevronUp, CornerDownRight, Forward } from 'lucide-react';
import SafeHtml from './SafeHtml';
import AttachmentChips from './AttachmentChips';
import { buildThreadTranscript } from '../../utils/emailThreads';
import { messagePreviewText } from '../../utils/emailQuotes';

function fmt(iso) {
  if (!iso) return '';
  return formatWeekdayDayTime(iso);
}

function shortPreview(text) {
  return messagePreviewText(text) || '(empty)';
}

// Small pill Andrea sees at the top of a forwarded-in message so she knows the
// message she's replying to originated with a *different* person.
function ForwardedInBanner({ message }) {
  if (!message.isForward) return null;
  const forwarder = message.forwardedByName || message.forwardedByEmail || message.from;
  const original =
    message.originalFromName ||
    message.originalFromEmail ||
    'the original sender';
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900">
      <Forward className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0">
        <span className="font-semibold">Forwarded by {forwarder}</span>
        {' · original from '}
        <span className="font-semibold">{original}</span>. A reply will be sent to the
        original sender.
      </p>
    </div>
  );
}

function TranscriptLabelPrefix({ prefix }) {
  if (!prefix) return null;
  return (
    <span className="font-semibold text-[var(--color-text-muted)]">{prefix}: </span>
  );
}

function TranscriptMeta({ entry }) {
  const outbound = entry.direction === 'outbound';
  const message = entry.source;
  return (
    <div className="text-[11px] text-[var(--color-text-secondary)] space-y-0.5">
      {entry.labelPrefix && (
        <p>
          <span className="font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            {entry.labelPrefix}:
          </span>
        </p>
      )}
      {entry.direction === 'inbound' ? (
        <>
          <p>
            <span className="font-semibold text-[var(--color-text-primary)]">From:</span>{' '}
            {message.from} &lt;{message.fromEmail}&gt;
          </p>
          {message.toEmails?.length ? (
            <p>
              <span className="font-semibold text-[var(--color-text-primary)]">To:</span>{' '}
              {message.toEmails.join(', ')}
            </p>
          ) : null}
          {message.ccEmails?.length ? (
            <p>
              <span className="font-semibold text-[var(--color-text-primary)]">Cc:</span>{' '}
              {message.ccEmails.join(', ')}
            </p>
          ) : null}
        </>
      ) : (
        <p>
          <span className="font-semibold text-[var(--color-text-primary)]">From:</span>{' '}
          {message.inbox}
        </p>
      )}
      <p>
        <span className="font-semibold text-[var(--color-text-primary)]">
          {outbound ? 'Sent:' : 'Received:'}
        </span>{' '}
        {fmt(entry.receivedAt)}
      </p>
    </div>
  );
}

function ExpandedTranscriptEntry({ entry, onCollapse, onAttachmentError }) {
  const outbound = entry.direction === 'outbound';
  const message = entry.source;
  const showHtml = !outbound && entry.htmlBody;

  return (
    <div
      className={`rounded-xl border shadow-sm overflow-hidden ${
        outbound
          ? 'border-[var(--color-brand-primary)]/25 bg-[var(--color-surface-highlight)]/40'
          : 'border-[var(--color-border-default)] bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b border-[var(--color-border-default)]/70">
        <div className="min-w-0 flex-1 space-y-2">
          {entry.direction === 'inbound' && <ForwardedInBanner message={message} />}
          <TranscriptMeta entry={entry} />
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer"
            aria-label="Collapse message"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            Hide
          </button>
        )}
      </div>
      <div className="px-4 py-3 space-y-3">
        {showHtml ? (
          <SafeHtml html={entry.htmlBody} className="text-sm text-[var(--color-text-primary)] leading-relaxed" />
        ) : (
          <div className="text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap">
            {entry.body || <span className="italic text-[var(--color-text-muted)]">(empty)</span>}
          </div>
        )}
        {entry.showAttachments && message.attachments?.length ? (
          <AttachmentChips
            emailId={message.id}
            attachments={message.attachments}
            onError={onAttachmentError}
          />
        ) : null}
      </div>
    </div>
  );
}

function CollapsedTranscriptEntry({
  entry,
  onExpand,
  grouped = false,
  isReplyTarget = false,
}) {
  const outbound = entry.direction === 'outbound';
  const preview = shortPreview(entry.body) || '(empty)';

  return (
    <button
      type="button"
      onClick={onExpand}
      className={`w-full text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/40 ${
        grouped
          ? isReplyTarget
            ? 'bg-[var(--color-surface-highlight)]/25 hover:bg-[var(--color-surface-panel)]/60'
            : 'hover:bg-[var(--color-surface-panel)]/60'
          : `rounded-lg border ${
              outbound
                ? 'border-[var(--color-brand-primary)]/20 bg-[var(--color-surface-highlight)]/30 hover:bg-[var(--color-surface-highlight)]/60'
                : 'border-[var(--color-border-default)] bg-white hover:bg-[var(--color-surface-panel)]/60'
            }`
      }`}
    >
      <div className="flex items-start gap-2 px-3 py-2 min-w-0">
        {outbound && !grouped && (
          <CornerDownRight className="mt-0.5 w-3.5 h-3.5 shrink-0 text-[var(--color-brand-primary)]" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          {isReplyTarget && (
            <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-brand-primary)]">
              Replying to
            </p>
          )}
          <p className="text-[11px] leading-snug text-[var(--color-text-primary)] truncate">
            <TranscriptLabelPrefix prefix={entry.labelPrefix} />
            <span
              className={`font-semibold ${outbound ? 'text-[var(--color-brand-primary)]' : 'text-[var(--color-text-primary)]'}`}
            >
              {entry.sender}:
            </span>{' '}
            <span className="text-[var(--color-text-muted)]">{preview}</span>
          </p>
        </div>
        <span className="text-[11px] tabular-nums text-[var(--color-text-muted)] shrink-0 pt-0.5">
          {fmt(entry.receivedAt)}
        </span>
        <ChevronDown className="mt-0.5 w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
      </div>
    </button>
  );
}

function CollapsedThreadTranscript({ entries, onExpand, replyTargetKey }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-default)] bg-white overflow-hidden divide-y divide-[var(--color-border-default)]/70">
      {entries.map((entry) => (
        <CollapsedTranscriptEntry
          key={entry.key}
          entry={entry}
          onExpand={() => onExpand(entry.key)}
          isReplyTarget={entry.key === replyTargetKey}
          grouped
        />
      ))}
    </div>
  );
}

function replyTargetKeyFor(activeMessageId) {
  if (!activeMessageId) return null;
  return `${activeMessageId}:in`;
}

/**
 * Chronological transcript for the whole thread. Replied-to inbound rows are
 * split into the customer's original message plus Andrea's send so the first
 * email ("How do I close my account?") appears before her reply.
 */
export default function ThreadHistory({
  thread,
  activeMessageId,
  initiallyExpandedKeys = [],
  outboundLabel = 'You',
  onAttachmentError,
}) {
  const [expanded, setExpanded] = useState(() => new Set(initiallyExpandedKeys));

  const toggle = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const entries = buildThreadTranscript(thread.messages, { outboundLabel });
  if (entries.length === 0) return null;

  const replyTargetKey = replyTargetKeyFor(activeMessageId);
  const allCollapsed = entries.every((entry) => !expanded.has(entry.key));

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
        Thread history
        <span className="ml-1 font-medium normal-case text-[var(--color-text-secondary)]">
          · {entries.length} message{entries.length === 1 ? '' : 's'}
        </span>
      </h3>
      {allCollapsed ? (
        <CollapsedThreadTranscript
          entries={entries}
          onExpand={toggle}
          replyTargetKey={replyTargetKey}
        />
      ) : (
        <div className="space-y-2">
          {entries.map((entry) =>
            expanded.has(entry.key) ? (
              <ExpandedTranscriptEntry
                key={entry.key}
                entry={entry}
                onCollapse={() => toggle(entry.key)}
                onAttachmentError={onAttachmentError}
              />
            ) : (
              <CollapsedTranscriptEntry
                key={entry.key}
                entry={entry}
                onExpand={() => toggle(entry.key)}
                isReplyTarget={entry.key === replyTargetKey}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}

export { ForwardedInBanner };
