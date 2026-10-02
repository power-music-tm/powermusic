import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import Modal from '../ui/Modal';
import RecipientField from './RecipientField';
import { parseRecipientList, isValidEmail } from '../../utils/emailAddressBook';

/**
 * Gmail-style Compose window for a brand-new message. No AI involved — Andrea
 * writes the whole thing. `onSend` performs the API call and should resolve on
 * success / reject with an Error whose message is shown to the user.
 */
export default function ComposeModal({
  isOpen,
  onClose,
  inboxes = [],
  defaultInbox = '',
  addressBook = [],
  onSend,
  onError,
}) {
  const connected = inboxes.filter((i) => i.status === 'Connected');
  // This component is mounted fresh each time Compose opens (parent gates it
  // behind `composeOpen`), so a plain initial state is a clean form every time
  // — no reset effect needed.
  const [inbox, setInbox] = useState(defaultInbox || connected[0]?.email || '');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const toList = parseRecipientList(to);
    const ccList = parseRecipientList(cc);
    const bccList = parseRecipientList(bcc);
    if (!inbox) {
      onError?.('Choose which inbox to send from.');
      return;
    }
    if (toList.length === 0) {
      onError?.('Add at least one recipient.');
      return;
    }
    const badTo = toList.find((a) => !isValidEmail(a));
    if (badTo) {
      onError?.(`Invalid recipient: ${badTo}`);
      return;
    }
    const badCc = ccList.find((a) => !isValidEmail(a));
    if (badCc) {
      onError?.(`Invalid Cc: ${badCc}`);
      return;
    }
    const badBcc = bccList.find((a) => !isValidEmail(a));
    if (badBcc) {
      onError?.(`Invalid Bcc: ${badBcc}`);
      return;
    }
    setSending(true);
    try {
      await onSend({
        inbox,
        toEmails: toList,
        ccEmails: ccList,
        bccEmails: bccList,
        subject,
        finalBody: body,
      });
      onClose();
    } catch (err) {
      onError?.(err.message || 'Could not send message.');
      setSending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New message"
      wide
      footer={
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-wait"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {sending ? 'Sending…' : 'Send'}
        </button>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            From
          </span>
          <select
            value={inbox}
            onChange={(e) => setInbox(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-brand-primary)]/40 focus:ring-2 focus:ring-[var(--color-brand-primary)]/10"
          >
            {connected.length === 0 && <option value="">No connected inbox</option>}
            {connected.map((i) => (
              <option key={i.email} value={i.email}>
                {i.title} · {i.email}
              </option>
            ))}
          </select>
        </label>

        <div className="relative">
          <RecipientField
            label="To"
            required
            value={to}
            onChange={setTo}
            book={addressBook}
            placeholder="recipient@example.com"
          />
          {(!showCc || !showBcc) && (
            <div className="absolute right-0 top-0 flex items-center gap-2 text-[11px] font-semibold">
              {!showCc && (
                <button
                  type="button"
                  onClick={() => setShowCc(true)}
                  className="text-[var(--color-brand-primary)] hover:underline cursor-pointer"
                >
                  Cc
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  onClick={() => setShowBcc(true)}
                  className="text-[var(--color-brand-primary)] hover:underline cursor-pointer"
                >
                  Bcc
                </button>
              )}
            </div>
          )}
        </div>

        {showCc && (
          <RecipientField
            label="Cc"
            value={cc}
            onChange={setCc}
            book={addressBook}
            placeholder="cc@example.com"
          />
        )}

        {showBcc && (
          <RecipientField
            label="Bcc"
            value={bcc}
            onChange={setBcc}
            book={addressBook}
            placeholder="bcc@example.com"
          />
        )}

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Subject
          </span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="mt-1 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-brand-primary)]/40 focus:ring-2 focus:ring-[var(--color-brand-primary)]/10"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Message
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            placeholder="Write your message…"
            className="mt-1 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2.5 text-sm text-[var(--color-text-primary)] leading-relaxed font-sans resize-y focus:outline-none focus:border-[var(--color-brand-primary)]/30 focus:ring-2 focus:ring-[var(--color-brand-primary)]/10 min-h-[200px]"
          />
        </label>
      </div>
    </Modal>
  );
}
