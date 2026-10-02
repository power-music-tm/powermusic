import {
  SIGNATURE_COMPANY,
  SIGNATURE_PERSON,
  extractDraftBody,
} from '../../utils/emailSignature';

// Greeting + closing are owned by the presentation layer, never by the model.
// We only render what the model produced *between* those two — anything that
// looks like a signature or greeting the model may have snuck in is stripped
// by `extractDraftBody` before we render.
export default function DraftBodyDisplay({ body, inboxTitle, firstName, className = '' }) {
  const cleanBody = extractDraftBody(body);
  const title = (inboxTitle || '').trim() || 'Power Music';
  const greetingName = (firstName || '').trim() || 'there';

  return (
    <div className={`leading-relaxed ${className}`.trim()}>
      <span className="block whitespace-pre-wrap">{`Hi ${greetingName},`}</span>
      <span className="block h-4" aria-hidden />
      {cleanBody ? (
        <>
          <span className="block whitespace-pre-wrap">{cleanBody}</span>
          <span className="block h-4" aria-hidden />
        </>
      ) : null}
      <span className="block whitespace-pre-wrap">Thank you.</span>
      <span className="block h-4" aria-hidden />
      <strong className="font-semibold text-[var(--color-text-primary)]">{SIGNATURE_PERSON}</strong>
      <span className="block whitespace-pre-wrap">{title}</span>
      <span className="block whitespace-pre-wrap">{SIGNATURE_COMPANY}</span>
    </div>
  );
}
