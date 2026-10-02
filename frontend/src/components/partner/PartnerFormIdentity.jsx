import { partnerInitials } from './PartnerConnectionBranding';

/** Power Music as the platform — like the app logo in Instagram. */
export function PlatformBrand({ subtitle = 'Submit a request', className = '' }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`.trim()}>
      <img
        src="/image.png"
        alt=""
        className="h-7 w-auto shrink-0 object-contain sm:h-8"
        width={96}
        height={32}
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">Power Music</p>
        {subtitle ? (
          <p className="truncate text-[11px] text-[var(--color-text-secondary)]">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Partner as a profile within the platform — like a user's picture in the app. */
export function PartnerProfileChip({ partnerName, logoDataUrl = null, className = '' }) {
  if (!partnerName) return null;

  return (
    <div
      className={`flex max-w-[11rem] min-w-0 items-center gap-2 rounded-full bg-[var(--color-surface-panel)] py-1 pl-1 pr-2.5 ring-1 ring-[var(--color-border-default)] sm:max-w-[12rem] sm:pr-3 ${className}`.trim()}
      title={partnerName}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-[var(--color-border-default)]/80">
        {logoDataUrl ? (
          <img src={logoDataUrl} alt="" className="h-full w-full object-cover object-center" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-[var(--color-surface-panel)] text-[10px] font-bold text-[var(--color-text-primary)]">
            {partnerInitials(partnerName)}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold leading-tight text-[var(--color-text-primary)]">
          {partnerName}
        </p>
        <p className="truncate text-[10px] leading-tight text-[var(--color-text-muted)]">Partner</p>
      </div>
    </div>
  );
}

/** @deprecated Use PlatformBrand + PartnerProfileChip separately in the header. */
export default function PartnerFormIdentity(props) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PlatformBrand subtitle={props.subtitle} />
      <PartnerProfileChip partnerName={props.partnerName} logoDataUrl={props.logoDataUrl} />
    </div>
  );
}
