import { useState } from 'react';
import { Paperclip, Download, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import { downloadAttachment } from '../../utils/pilot2Api';

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentChip({ emailId, attachment, onError }) {
  const [busy, setBusy] = useState(false);
  const isImage = (attachment.mimeType || '').startsWith('image/');
  const size = formatSize(attachment.sizeBytes);

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadAttachment(emailId, attachment.id, attachment.filename);
    } catch (err) {
      onError?.(err.message || 'Could not download attachment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={busy}
      title={`Download ${attachment.filename}`}
      className="group inline-flex items-center gap-2 max-w-full rounded-lg border border-[var(--color-border-default)] bg-white px-2.5 py-1.5 text-left transition-colors hover:border-[var(--color-brand-primary)]/30 hover:bg-[var(--color-surface-highlight)] cursor-pointer disabled:opacity-60 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/35"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-highlight)] text-[var(--color-brand-primary)]">
        {isImage ? (
          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-[var(--color-text-primary)] max-w-[10rem]">
          {attachment.filename}
        </span>
        {size && <span className="block text-[10px] text-[var(--color-text-muted)]">{size}</span>}
      </span>
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-text-muted)]" aria-hidden="true" />
      ) : (
        <Download className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] group-hover:text-[var(--color-brand-primary)]" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * Renders downloadable attachment chips for a message. Inline (cid:) parts
 * that belong to the HTML body are excluded — only real file attachments show
 * as chips, matching Gmail.
 */
export default function AttachmentChips({ emailId, attachments, onError, className = '' }) {
  const files = (attachments || []).filter((a) => !a.isInline);
  if (files.length === 0) return null;

  return (
    <div className={`space-y-1.5 ${className}`.trim()}>
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        <Paperclip className="h-3 w-3" aria-hidden="true" />
        {files.length} attachment{files.length === 1 ? '' : 's'}
      </p>
      <div className="flex flex-wrap gap-2">
        {files.map((att) => (
          <AttachmentChip key={att.id} emailId={emailId} attachment={att} onError={onError} />
        ))}
      </div>
    </div>
  );
}
