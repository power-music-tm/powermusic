import { useEffect, useRef, useState } from 'react';
import { ChevronUp, Loader2, LogOut } from 'lucide-react';
import { Modal } from '../ui';
import { partnerInitials } from '../partner/PartnerConnectionBranding';
import { getPartnerTerminology } from '../../utils/managerAuthBranding';

function displayNameFrom(name, email, isHF = false) {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const local = String(email || '').split('@')[0];
  if (local) return local;
  return 'Manager';
}

function PartnerAvatar({ name, logoDataUrl, className = 'h-9 w-9' }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-white/10 ${className}`}
      aria-hidden="true"
    >
      {logoDataUrl ? (
        <img src={logoDataUrl} alt="" className="h-full w-full object-contain p-0.5" />
      ) : (
        <span className="text-[10px] font-bold text-white">{partnerInitials(name)}</span>
      )}
    </div>
  );
}

function ManagerAccountMenu({
  partnerName = null,
  logoDataUrl = null,
  name,
  email,
  clubLocation,
  onSignOut,
  signingOut,
  interactive = true,
}) {
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const displayPartner = partnerName?.trim() || null;
  const terms = getPartnerTerminology(displayPartner);
  const displayName = displayNameFrom(name, email, terms.isHealthFitness);
  const displayEmail = email?.trim() || null;
  const displayClub = clubLocation?.trim() || null;
  const roleBadge = terms.roleBadge(displayPartner);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const onClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleConfirmSignOut = async () => {
    if (!onSignOut || signingOut) return;
    await onSignOut();
    setConfirmOpen(false);
    setMenuOpen(false);
  };

  return (
    <>
      <div ref={menuRef} className="relative min-w-0">
        <button
          type="button"
          onClick={() => interactive && setMenuOpen((open) => !open)}
          disabled={!interactive || signingOut}
          aria-expanded={interactive ? menuOpen : false}
          aria-haspopup={interactive ? 'menu' : undefined}
          aria-label={interactive ? 'Account menu' : displayName}
          className={`flex h-11 max-w-[min(100%,16rem)] items-center gap-2.5 rounded-lg px-2 text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-default sm:max-w-[18rem] sm:gap-3 sm:px-3 ${
            menuOpen && interactive
              ? 'bg-white/[0.08] text-white'
              : 'text-white/85 hover:bg-white/[0.06] hover:text-white'
          }`}
        >
          <PartnerAvatar name={displayPartner} logoDataUrl={logoDataUrl} />

          <div className="min-w-0 flex-1 hidden min-[420px]:block">
            <span className="block truncate text-sm font-semibold leading-tight">{displayName}</span>
            <span
              className={`block truncate text-xs leading-tight ${
                menuOpen && interactive ? 'text-white/55' : 'text-white/45'
              }`}
            >
              {roleBadge}
            </span>
          </div>

          {interactive ? (
            <ChevronUp
              className={`hidden h-4 w-4 shrink-0 transition-transform duration-200 min-[420px]:block text-white/40 ${menuOpen ? '' : 'rotate-180'}`}
              aria-hidden="true"
            />
          ) : null}
        </button>

        {interactive && menuOpen ? (
          <div
            role="menu"
            aria-label="Account menu"
            className="absolute top-[calc(100%+6px)] right-0 z-50 w-[min(280px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-white shadow-[var(--shadow-modal)]"
          >
            <div className="border-b border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/50 px-3.5 py-3">
              <p className="break-words text-sm font-semibold leading-snug text-[var(--color-text-primary)]">
                {displayName}
              </p>
              {displayEmail ? (
                <p className="mt-1 break-all text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  {displayEmail}
                </p>
              ) : null}
              {displayClub ? (
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  {displayClub}
                </p>
              ) : null}
              <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {roleBadge}
              </p>
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-highlight)] focus:outline-none focus-visible:bg-[var(--color-surface-highlight)]"
            >
              <LogOut className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
              Sign out
            </button>
          </div>
        ) : null}
      </div>

      {interactive && onSignOut ? (
        <Modal
          isOpen={confirmOpen}
          onClose={() => !signingOut && setConfirmOpen(false)}
          title="Sign out?"
          confirm
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={signingOut}
                className="rounded-lg border border-[var(--color-border-default)] px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-highlight)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSignOut}
                disabled={signingOut}
                className="inline-flex min-w-[7.5rem] items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-50"
              >
                {signingOut ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Signing out…
                  </>
                ) : (
                  'Sign out'
                )}
              </button>
            </>
          }
        >
          <p>
            You&apos;ll return to the sign-in page. Any draft request details saved on this device
            will be cleared.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Manager portal navbar — matches admin sidebar colors and account menu.
 */
export default function ManagerFormHeader({
  partnerName = null,
  logoDataUrl = null,
  managerName = null,
  userEmail = null,
  clubLocation = null,
  onSignOut,
  signingOut = false,
  preview = false,
}) {
  const hasManager = Boolean(managerName?.trim() || userEmail?.trim());
  const showLiveSession = !preview && hasManager;
  const showPreviewSession = preview && hasManager;

  return (
    <header className="sticky top-0 z-40 shrink-0 border-b border-white/[0.06] bg-[var(--color-manager-hero-from)] text-white shadow-[0_4px_24px_rgba(0,0,0,0.15)]">
      <div className="mx-auto flex h-14 max-w-[1520px] items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            src="/image.png"
            alt="Power Music"
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/15"
            width={32}
            height={32}
          />
          <div className="min-w-0 hidden sm:block">
            <p className="truncate text-[13px] font-semibold leading-tight tracking-wide text-white">
              Power Music
            </p>
            <p className="truncate text-[11px] leading-tight text-white/40">Partner workspace</p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {showLiveSession ? (
            <ManagerAccountMenu
              partnerName={partnerName}
              logoDataUrl={logoDataUrl}
              name={managerName}
              email={userEmail}
              clubLocation={clubLocation}
              onSignOut={onSignOut}
              signingOut={signingOut}
              interactive
            />
          ) : null}

          {showPreviewSession ? (
            <ManagerAccountMenu
              partnerName={partnerName}
              logoDataUrl={logoDataUrl}
              name={managerName}
              email={userEmail}
              clubLocation={clubLocation}
              onSignOut={null}
              signingOut={false}
              interactive={false}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}
