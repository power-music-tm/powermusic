import { Loader2, LogOut } from 'lucide-react';
import AdminAuthShell from './AdminAuthShell';
import ManagerAuthShell from './ManagerAuthShell';
import PartnerConnectionBranding from '../partner/PartnerConnectionBranding';
import {
  instantPartnerBrandingFromSlug,
  resolveManagerAuthPartnerBranding,
  getPartnerTerminology,
} from '../../utils/managerAuthBranding';

const primaryButtonClass =
  'flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-primary)] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-surface-sidebar-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const outlineButtonClass =
  'flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-white text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-panel)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Admin signed in on a manager portal link, or manager signed in on admin routes.
 */
export default function RolePortalConflict({
  variant,
  partnerBranding = null,
  partnerSlug = '',
  sessionPartnerBranding = null,
  onGoToDashboard,
  onGoToPortal,
  onLogout,
  signingOut = false,
}) {
  const isAdminOnManager = variant === 'admin-on-manager';

  const urlBranding = isAdminOnManager
    ? resolveManagerAuthPartnerBranding({
        slugBranding: partnerBranding,
        partnerSlug,
      }) || instantPartnerBrandingFromSlug(partnerSlug)
    : null;
  const terms = getPartnerTerminology(urlBranding?.partnerName, partnerSlug);
  const partnerLabel = urlBranding?.partnerName || `partner ${terms.managerTermPlural.toLowerCase()}`;

  const sessionPartnerName = sessionPartnerBranding?.partnerName || 'your partner';

  const content = (
    <div className="space-y-5 text-center">
      <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-4 text-left">
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">
          {isAdminOnManager
            ? "You're signed in as an administrator"
            : `You're signed in as ${sessionPartnerName}`}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {isAdminOnManager
            ? partnerSlug
              ? `This link is for ${partnerLabel}. Sign out to use the partner portal with a ${terms.managerTermLower} account.`
              : `The partner portal is for ${terms.managerTermPlural.toLowerCase()}. Sign out to sign in with a ${terms.managerTermLower} account.`
            : 'This area is for administrators. Sign out to sign in with an admin account.'}
        </p>
      </div>

      {!isAdminOnManager && sessionPartnerBranding?.partnerName ? (
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
        <button
          type="button"
          onClick={isAdminOnManager ? onGoToDashboard : onGoToPortal}
          className={primaryButtonClass}
        >
          {isAdminOnManager ? 'Go to dashboard' : 'Go to portal'}
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
  );

  if (isAdminOnManager) {
    return <ManagerAuthShell partnerBranding={urlBranding}>{content}</ManagerAuthShell>;
  }

  return <AdminAuthShell>{content}</AdminAuthShell>;
}
