import PartnerConnectionBranding from '../partner/PartnerConnectionBranding';

export default function AuthBrandingHeader({ partnerBranding }) {
  const showPartner = Boolean(partnerBranding?.partnerName);

  if (!showPartner) {
    return (
      <>
        <div className="mx-auto mb-4 inline-flex items-center justify-center rounded-xl bg-white p-2.5 shadow-[0_2px_12px_rgba(26,26,46,0.08)] ring-1 ring-black/[0.06] sm:p-3">
          <img src="/image.png" alt="" className="h-9 w-auto object-contain sm:h-10" width={120} height={40} />
        </div>
        <h1 className="text-base font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-lg">
          Power Music Ops
        </h1>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)] sm:text-sm">
          Request adding or removing partner users
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="sr-only">
        Power Music Ops — {partnerBranding.partnerName}
      </h1>
      <PartnerConnectionBranding
        partnerName={partnerBranding.partnerName}
        logoDataUrl={partnerBranding.logoDataUrl}
        subtitle="Request adding or removing partner users"
        className="mb-1"
      />
    </>
  );
}
