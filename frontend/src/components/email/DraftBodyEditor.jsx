import {
  SIGNATURE_COMPANY,
  SIGNATURE_PERSON,
} from '../../utils/emailSignature';

// Mirrors DraftBodyDisplay: greeting and sign-off stay fixed while Andrea edits
// only the message body between them.
export default function DraftBodyEditor({
  value,
  onChange,
  inboxTitle,
  firstName,
  rows = 10,
  className = '',
}) {
  const title = (inboxTitle || '').trim() || 'Power Music';
  const greetingName = (firstName || '').trim() || 'there';

  return (
    <div className={`rounded-lg border border-[var(--color-border-default)] bg-white px-4 py-3.5 text-sm text-[var(--color-text-primary)] leading-relaxed ${className}`.trim()}>
      <span className="block whitespace-pre-wrap">{`Hi ${greetingName},`}</span>
      <span className="block h-4" aria-hidden />
      <textarea
        value={value}
        onChange={onChange}
        rows={rows}
        className="w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 py-2.5 text-sm text-[var(--color-text-primary)] leading-relaxed font-sans resize-y focus:outline-none focus:border-[var(--color-brand-primary)]/30 focus:ring-2 focus:ring-[var(--color-brand-primary)]/10 min-h-[120px]"
      />
      <span className="block h-4" aria-hidden />
      <span className="block whitespace-pre-wrap text-[var(--color-text-secondary)]">Thank you.</span>
      <span className="block h-4" aria-hidden />
      <strong className="font-semibold text-[var(--color-text-primary)]">{SIGNATURE_PERSON}</strong>
      <span className="block whitespace-pre-wrap text-[var(--color-text-secondary)]">{title}</span>
      <span className="block whitespace-pre-wrap text-[var(--color-text-secondary)]">{SIGNATURE_COMPANY}</span>
    </div>
  );
}
