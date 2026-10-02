function partnerInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'P';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function CollabMark() {
  return (
    <span className="flex shrink-0 items-center justify-center" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5 text-[var(--color-text-primary)] sm:h-[22px] sm:w-[22px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="butt"
      >
        <path d="M5 5l14 14M19 5L5 19" />
      </svg>
    </span>
  );
}

const brandMarkBoxClass =
  'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-[0_2px_12px_rgba(26,26,46,0.08)] ring-1 ring-black/[0.06] sm:h-[52px] sm:w-[52px]';

/**
 * MCP-style aligned branding: Power Music × Partner.
 */
export default function PartnerConnectionBranding({
  partnerName,
  logoDataUrl = null,
  subtitle = null,
  className = '',
  centered = true,
  showCollabMark = true,
}) {
  const showPartner = Boolean(partnerName);

  if (!showPartner) {
    return (
      <div className={`${centered ? 'text-center' : ''} ${className}`.trim()}>
        <div
          className={`inline-flex items-center justify-center rounded-xl bg-white p-2.5 shadow-[0_2px_12px_rgba(26,26,46,0.08)] ring-1 ring-black/[0.06] sm:p-3 ${centered ? 'mx-auto' : ''}`}
        >
          <img src="/image.png" alt="" className="h-9 w-auto object-contain sm:h-10" width={120} height={40} />
        </div>
        {subtitle ? (
          <p className={`mt-3 text-xs text-[var(--color-text-secondary)] sm:text-sm ${centered ? '' : ''}`}>
            {subtitle}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`${centered ? 'text-center' : ''} ${className}`.trim()}>
      <div
        className={`flex max-w-[320px] items-center justify-center gap-3 sm:max-w-[360px] sm:gap-4 ${centered ? 'mx-auto' : ''}`}
      >
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div className={brandMarkBoxClass}>
            <img
              src="/image.png"
              alt=""
              className="h-full w-full object-cover"
              loading="eager"
              fetchPriority="high"
              decoding="sync"
            />
          </div>
          <p className="max-w-full truncate text-center text-[11px] font-semibold text-[var(--color-text-primary)] sm:text-xs">
            Power Music
          </p>
        </div>

        {showCollabMark ? <CollabMark /> : null}

        <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div className={brandMarkBoxClass}>
            {logoDataUrl ? (
              <img
                src={logoDataUrl}
                alt=""
                className="h-full w-full object-cover"
                loading="eager"
                fetchPriority="high"
                decoding="sync"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-[var(--color-surface-panel)] text-[11px] font-bold text-[var(--color-text-primary)] sm:text-xs">
                {partnerInitials(partnerName)}
              </span>
            )}
          </div>
          <p className="max-w-full truncate text-center text-[11px] font-semibold text-[var(--color-text-primary)] sm:text-xs">
            {partnerName}
          </p>
        </div>
      </div>
      {subtitle ? (
        <p className="mt-3 text-xs text-[var(--color-text-secondary)] sm:text-sm">{subtitle}</p>
      ) : null}
    </div>
  );
}

export { partnerInitials };
