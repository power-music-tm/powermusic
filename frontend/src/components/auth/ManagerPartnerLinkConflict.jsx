import { Loader2, LogOut } from 'lucide-react';
import ManagerAuthShell from './ManagerAuthShell';
import PartnerConnectionBranding from '../partner/PartnerConnectionBranding';
import {
  instantPartnerBrandingFromSlug,
  resolveManagerAuthPartnerBranding,
  getPartnerTerminology,
} from '../../utils/managerAuthBranding';

export default function ManagerPartnerLinkConflict({
  urlPartnerBranding,
  urlPartnerSlug = '',
  sessionPartnerBranding,
  onLogout,
  onGoToPortal,
  signingOut = false,
}) {
  const urlBranding = resolveManagerAuthPartnerBranding({
    slugBranding: urlPartnerBranding,
    partnerSlug: urlPartnerSlug,
  }) || instantPartnerBrandingFromSlug(urlPartnerSlug);
  const urlPartnerName =
    urlBranding?.partnerName ||
    'this partner';
  const urlTerms = getPartnerTerminology(urlPartnerName, urlPartnerSlug);
  const sessionPartnerName = sessionPartnerBranding?.partnerName || 'your partner';

  const primaryButtonClass =
    'flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-primary)] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-surface-sidebar-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

  const outlineButtonClass =
    'flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-white text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-panel)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <ManagerAuthShell partnerBranding={urlBranding}>
      <div className="space-y-5 text-center">
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            You&apos;re signed in as {sessionPartnerName}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            This link is for {urlPartnerName} {urlTerms.managerTermLower}s. Sign out to create an account or sign in
            with an email allowed for {urlPartnerName}.
          </p>
        </div>

        {sessionPartnerBranding?.partnerName ? (
          <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/60 px-4 py-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Your current partner
            </p>
            <PartnerConnectionBranding
              partnerName={sessionPartnerBranding.partnerName}
              logoDataUrl={sessionPartnerBranding.logoDataUrl}
              centered
              showCollabMark={false}
              subtitle={null}
            />
          </div>
        ) : null}

        <div className="space-y-2.5">
          <button type="button" onClick={onGoToPortal} className={primaryButtonClass}>
            Go to portal
          </button>
          <button
            type="button"
            onClick={onLogout}
            disabled={signingOut}
            className={outlineButtonClass}
          >
            {signingOut ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Signing out…
              </>
            ) : (
              <>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </>
            )}
          </button>
        </div>
      </div>
    </ManagerAuthShell>
  );
}
