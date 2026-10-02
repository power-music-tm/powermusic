import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Home,
  Settings,
  Inbox,
  Users,
  LogOut,
  Loader2,
  ChevronUp,
  ChevronDown,
  Check,
  PanelLeftClose,
  X,
  Plus,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePartners } from '../../context/PartnerContext';
import { useToast } from '../ui/useToast';
import { Modal, HoverTip, DottedScroll } from '../ui';
import { clearAdminIntroSeen } from '../admin/AdminPortalIntro';
import { clearCache } from '../../utils/pilot2Api';

function partnerInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'P';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function PartnerListAvatar({ name, logoDataUrl, active = false }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 overflow-hidden rounded-full ring-1 ${
        active
          ? 'bg-white ring-[var(--color-brand-secondary)]/30'
          : 'bg-white ring-[var(--color-border-default)]'
      }`}
      aria-hidden="true"
    >
      {logoDataUrl ? (
        <img src={logoDataUrl} alt="" className="h-full w-full object-cover object-center" />
      ) : (
        <span
          className={`flex h-full w-full items-center justify-center text-xs font-bold ${
            active ? 'text-[var(--color-brand-secondary)]' : 'text-[var(--color-text-primary)]'
          }`}
        >
          {partnerInitials(name)}
        </span>
      )}
    </span>
  );
}

function PartnerSelectTriggerAvatar({ name, logoDataUrl, size = 'sm' }) {
  const sizeClass = size === 'md' ? 'h-7 w-7 text-[10px]' : 'h-6 w-6 text-[10px]';
  return (
    <span
      className={`flex shrink-0 overflow-hidden rounded-full bg-white ring-1 ring-white/20 ${sizeClass}`}
      aria-hidden="true"
    >
      {logoDataUrl ? (
        <img src={logoDataUrl} alt="" className="h-full w-full object-cover object-center" />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-bold text-[var(--color-brand-secondary)]">
          {partnerInitials(name)}
        </span>
      )}
    </span>
  );
}

function PartnerSelect({
  showExpanded,
  partners,
  partnerLogos,
  selectedPartnerId,
  selectedPartnerLogo,
  setSelectedPartnerId,
  partnerLabel,
}) {
  const [open, setOpen] = useState(false);
  const disabled = partners.length === 0;
  const options =
    partners.length === 0
      ? [{ value: '', label: 'No partners yet' }]
      : partners.map((p) => ({ value: p.id, label: p.name }));
  const selected = options.find((opt) => opt.value === (selectedPartnerId || '')) ?? options[0];
  const tipLabel = selected?.label || 'Partner';
  const selectedLogo = selected?.value
    ? partnerLogos[selected.value] ?? (selected.value === selectedPartnerId ? selectedPartnerLogo : null)
    : null;

  const triggerClass = showExpanded
    ? 'flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--color-brand-secondary-border)]/50 bg-[var(--color-brand-secondary)]/30 px-3 h-9 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-brand-secondary)]/45 hover:border-[var(--color-brand-secondary-border)]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-secondary)]/25 disabled:cursor-not-allowed disabled:opacity-50'
    : 'relative flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-brand-secondary-border)]/45 bg-[var(--color-brand-secondary)]/30 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-brand-secondary)]/45 hover:border-[var(--color-brand-secondary-border)]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-secondary)]/35 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <>
      <div className={showExpanded ? 'px-3' : 'relative flex justify-center px-1'}>
        <HoverTip
          label={showExpanded || open ? '' : tipLabel}
          placement="right"
          className={showExpanded ? 'w-full' : ''}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen(true)}
            aria-label={`Partner: ${tipLabel}. Open partner selection`}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={triggerClass}
          >
            {showExpanded ? (
              <>
                <PartnerSelectTriggerAvatar name={tipLabel} logoDataUrl={selectedLogo} size="sm" />
                <span className="min-w-0 truncate text-left">{tipLabel}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-brand-secondary-border)]" />
              </>
            ) : (
              <PartnerSelectTriggerAvatar name={tipLabel} logoDataUrl={selectedLogo} size="md" />
            )}
          </button>
        </HoverTip>
      </div>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Select partner"
        flushBody
        stableHeight
        footer={
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex min-w-[7.5rem] items-center justify-center rounded-lg border border-[var(--color-border-default)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-panel)]"
          >
            Cancel
          </button>
        }
      >
        <p className="shrink-0 px-4 pt-4 text-sm leading-relaxed text-[var(--color-text-secondary)] sm:px-6 sm:pt-6">
          Choose which partner workspace to view.
        </p>

        <DottedScroll
          className="min-h-0 flex-1"
          scrollClassName="h-full overflow-y-scroll scrollbar-hide overscroll-contain px-4 sm:px-6"
          contentClassName="pb-4 sm:pb-6"
          indicatorPlacement="below"
          indicatorClassName="pb-2"
        >
          <div
            role="listbox"
            aria-label="Partners"
            className="overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/35 divide-y divide-[var(--color-border-default)]/70"
          >
            {options.map((opt) => {
              const isActive = String(selectedPartnerId ?? '') === String(opt.value ?? '');
              return (
                <button
                  key={opt.value || 'all'}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={disabled && !opt.value}
                  onClick={() => {
                    if (disabled && partners.length === 0) return;
                    setSelectedPartnerId(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                    isActive
                      ? 'bg-[var(--color-brand-secondary-muted)] text-[var(--color-brand-secondary)]'
                      : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)]'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <PartnerListAvatar
                    name={opt.label}
                    logoDataUrl={opt.value ? partnerLogos[opt.value] ?? null : null}
                    active={isActive}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{opt.label}</span>
                  {isActive ? (
                    <Check className="h-4 w-4 shrink-0 text-[var(--color-brand-secondary)]" aria-hidden="true" />
                  ) : (
                    <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </DottedScroll>
      </Modal>
    </>
  );
}

export default function Sidebar({
  mobileOpen = false,
  onMobileClose,
  expanded = true,
  onExpandedChange,
}) {
  const { logout, user } = useAuth();
  const { partners, partnerLogos, selectedPartnerId, selectedPartnerLogo, setSelectedPartnerId, partnerLabel, createPartner } = usePartners();
  const { clearToasts, showToast } = useToast();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef(null);

  const [partnerCreateOpen, setPartnerCreateOpen] = useState(false);
  const [partnerCreateName, setPartnerCreateName] = useState('');
  const [partnerCreateDomains, setPartnerCreateDomains] = useState('');
  const [partnerCreateSources, setPartnerCreateSources] = useState('');
  const [partnerCreateBusy, setPartnerCreateBusy] = useState(false);

  const handleCreatePartner = async () => {
    const name = partnerCreateName.trim();
    if (!name) {
      showToast('Enter a partner name.', 'error');
      return;
    }
    const allowedDomains = partnerCreateDomains
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const automatedSources = partnerCreateSources
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);

    setPartnerCreateBusy(true);
    try {
      const created = await createPartner({ name, allowedDomains, automatedSources });
      setPartnerCreateOpen(false);
      setPartnerCreateName('');
      setPartnerCreateDomains('');
      setPartnerCreateSources('');
      clearCache(`inboxes:${created.id}`);
      clearCache(`manager_domains:${created.id}`);
      clearCache(`automated_sources:${created.id}`);
      showToast(`Partner ${created.name} created. Set up Form Branding next.`, 'success');
      navigate('/partner-settings', { state: { settingsTab: 'form-builder' } });
    } catch (err) {
      showToast(err.message || 'Could not create partner.', 'error');
    } finally {
      setPartnerCreateBusy(false);
    }
  };

  const displayName =
    user?.user_metadata?.full_name
    || user?.user_metadata?.firstName
    || user?.email?.split('@')[0]
    || 'Admin';

  // Mobile drawer always shows full labels; desktop respects expand/collapse.
  const showExpanded = expanded || mobileOpen;

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (event) => {
      if (accountRef.current && !accountRef.current.contains(event.target)) {
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

  useEffect(() => {
    if (!showExpanded) setMenuOpen(false);
  }, [showExpanded]);

  const handleConfirmLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      clearToasts();
      setConfirmOpen(false);
      if (user?.id) clearAdminIntroSeen(user.id);
      sessionStorage.setItem(
        'adminSignedOut',
        JSON.stringify({ name: displayName }),
      );
      navigate('/admin/login', { replace: true });
    } catch (err) {
      console.error('Failed to log out:', err);
      setSigningOut(false);
    }
  };

  const navItemClass = ({ isActive }) =>
    `group relative flex items-center gap-3 h-9 rounded-md transition-all duration-200 text-sm font-medium ${
      showExpanded ? 'w-full px-3' : 'w-9 justify-center px-0'
    } ${
      isActive
        ? 'bg-[var(--color-brand-accent)] text-white opacity-100 shadow-sm'
        : 'text-white/85 hover:bg-[var(--color-surface-sidebar-hover)] hover:text-white hover:opacity-100'
    }`;

  const handleNavClick = () => {
    onMobileClose?.();
  };

  const toggleExpanded = () => {
    onExpandedChange?.(!expanded);
  };

  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/5 bg-[var(--color-surface-sidebar)] text-white transition-[width,transform] duration-300 ease-out md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${
          expanded
            ? 'w-[min(280px,88vw)] md:w-[256px]'
            : 'w-[min(280px,88vw)] md:w-[72px]'
        }`}
        aria-label="Main navigation"
        data-expanded={showExpanded ? 'true' : 'false'}
      >
        <div
          className={`flex h-14 shrink-0 items-center ${
            showExpanded ? 'gap-2 px-3' : 'justify-center px-2'
          }`}
        >
          {showExpanded ? (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <img
                  src="/image.png"
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/15"
                />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold leading-tight tracking-wide text-white">
                    Power Music Ops
                  </p>
                </div>
              </div>
              <HoverTip label="Close menu" placement="bottom">
                <button
                  type="button"
                  onClick={onMobileClose}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 md:hidden"
                  aria-label="Close menu"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </HoverTip>
              <HoverTip label="Hide sidebar" placement="bottom">
                <button
                  type="button"
                  onClick={toggleExpanded}
                  className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 md:inline-flex"
                  aria-label="Hide sidebar"
                  aria-expanded="true"
                >
                  <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                </button>
              </HoverTip>
            </>
          ) : (
            <HoverTip label="Show sidebar" placement="right">
              <button
                type="button"
                onClick={toggleExpanded}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                aria-label="Show sidebar"
                aria-expanded="false"
              >
                <img
                  src="/image.png"
                  alt="Power Music Ops"
                  className="h-8 w-8 rounded-full object-cover ring-1 ring-white/15"
                />
              </button>
            </HoverTip>
          )}
        </div>

        <div className={`h-px shrink-0 bg-white/10 ${showExpanded ? 'mx-4' : 'mx-3'}`} />

        <div className={`flex-1 overflow-y-auto space-y-6 py-4 ${showExpanded ? 'px-3' : 'px-2'}`}>
          <div className={`space-y-2 ${showExpanded ? '' : 'flex flex-col items-center'}`}>
            {showExpanded && (
              <span className="mb-1 block px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                Partner Selection
              </span>
            )}
            <PartnerSelect
              showExpanded={showExpanded}
              partners={partners}
              partnerLogos={partnerLogos}
              selectedPartnerId={selectedPartnerId}
              selectedPartnerLogo={selectedPartnerLogo}
              setSelectedPartnerId={setSelectedPartnerId}
              partnerLabel={partnerLabel}
            />
          </div>

          <div className={`space-y-1 ${showExpanded ? '' : 'flex flex-col items-center'}`}>
            {showExpanded && (
              <span className="mb-2 block px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                {partnerLabel} Overview
              </span>
            )}
            <HoverTip
              label={showExpanded ? '' : 'Overview'}
              placement="right"
              className={showExpanded ? 'w-full' : ''}
            >
              <NavLink to="/" end className={navItemClass} onClick={handleNavClick} aria-label="Overview">
                <Home className="h-4 w-4 shrink-0" />
                {showExpanded ? <span>Overview</span> : null}
              </NavLink>
            </HoverTip>
          </div>

          <div className={`space-y-1 ${showExpanded ? '' : 'flex flex-col items-center'}`}>
            {showExpanded && (
              <span className="mb-2 block px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                {partnerLabel} Support
              </span>
            )}
            <HoverTip
              label={showExpanded ? '' : 'New Requests'}
              placement="right"
              className={showExpanded ? 'w-full' : ''}
            >
              <NavLink to="/new-requests" className={navItemClass} onClick={handleNavClick} aria-label="New Requests">
                <Inbox className="h-4 w-4 shrink-0" />
                {showExpanded ? <span>New Requests</span> : null}
              </NavLink>
            </HoverTip>
            <HoverTip
              label={showExpanded ? '' : 'Directory'}
              placement="right"
              className={showExpanded ? 'w-full' : ''}
            >
              <NavLink to="/directory" className={navItemClass} onClick={handleNavClick} aria-label="Directory">
                <Users className="h-4 w-4 shrink-0" />
                {showExpanded ? <span>Directory</span> : null}
              </NavLink>
            </HoverTip>
            <HoverTip
              label={showExpanded ? '' : `${partnerLabel} Settings`}
              placement="right"
              className={showExpanded ? 'w-full' : ''}
            >
              <NavLink to="/partner-settings" className={navItemClass} onClick={handleNavClick} aria-label={`${partnerLabel} Settings`}>
                <Settings className="h-4 w-4 shrink-0" />
                {showExpanded ? <span>{partnerLabel} Settings</span> : null}
              </NavLink>
            </HoverTip>
          </div>
        </div>

        <div
          className={`shrink-0 border-t border-white/[0.06] ${
            showExpanded ? 'p-3' : 'flex flex-col items-center p-2'
          }`}
          ref={accountRef}
        >
          <div
            className={`border-b border-white/[0.06] ${
              showExpanded
                ? 'mb-3 pb-3'
                : 'mb-2 flex w-full justify-center pb-2'
            }`}
          >
            <HoverTip
              label={showExpanded ? '' : 'Add New Partner'}
              placement="right"
              className={showExpanded ? 'w-full' : ''}
            >
              <button
                type="button"
                onClick={() => setPartnerCreateOpen(true)}
                aria-label="Add New Partner"
                className={`flex items-center rounded-lg text-left transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                  showExpanded
                    ? 'w-full gap-2.5 px-2.5 py-1.5'
                    : 'h-9 w-9 justify-center px-0'
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {showExpanded && (
                  <span className="min-w-0 flex-1 text-xs font-semibold leading-snug text-white/85">
                    Add New Partner
                  </span>
                )}
              </button>
            </HoverTip>
          </div>

          <div className={`relative ${showExpanded ? '' : 'flex w-full justify-center'}`}>
            <HoverTip
              label={showExpanded ? '' : 'Expand sidebar for account'}
              placement="right"
              className={showExpanded ? 'w-full' : ''}
            >
              <button
                type="button"
                onClick={() => {
                  if (!showExpanded) {
                    onExpandedChange?.(true);
                    return;
                  }
                  setMenuOpen((open) => !open);
                }}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label={showExpanded ? 'Account menu' : 'Expand sidebar for account'}
                className={`flex items-center rounded-lg text-left transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
                  showExpanded ? 'h-11 w-full gap-3 px-3' : 'h-9 w-9 justify-center px-0'
                }`}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand-accent)] to-[#c73652] text-sm font-semibold text-white"
                  aria-hidden="true"
                >
                  {displayName.substring(0, 1).toUpperCase()}
                </div>

                {showExpanded && (
                  <>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold leading-snug text-white">
                        {displayName}
                      </span>
                      <span className="block truncate text-xs leading-snug text-white/45">
                        Administrator
                      </span>
                    </div>

                    <ChevronUp
                      className={`h-4 w-4 shrink-0 text-white/40 transition-transform duration-200 ${
                        menuOpen ? '' : 'rotate-180'
                      }`}
                      aria-hidden="true"
                    />
                  </>
                )}
              </button>
            </HoverTip>

            {menuOpen && showExpanded && (
              <div
                role="menu"
                aria-label="Account menu"
                className="absolute bottom-[calc(100%+6px)] left-0 right-0 z-50 overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-white shadow-[var(--shadow-modal)]"
              >
                <div className="border-b border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/50 px-3.5 py-3">
                  <p className="break-words text-sm font-semibold leading-snug text-[var(--color-text-primary)]">
                    {displayName}
                  </p>
                  {user?.email && (
                    <p className="mt-1 break-all text-xs leading-relaxed text-[var(--color-text-secondary)]">
                      {user.email}
                    </p>
                  )}
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                    Administrator
                  </p>
                </div>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onMobileClose?.();
                    setConfirmOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-highlight)] focus:outline-none focus-visible:bg-[var(--color-surface-highlight)]"
                >
                  <LogOut className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

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
              onClick={handleConfirmLogout}
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
          You&apos;ll return to the sign-in page. Any unsaved work in open tabs may be lost.
        </p>
      </Modal>

      <Modal
        isOpen={partnerCreateOpen}
        onClose={() => !partnerCreateBusy && setPartnerCreateOpen(false)}
        title="Add new partner"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setPartnerCreateOpen(false)}
              disabled={partnerCreateBusy}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreatePartner}
              disabled={partnerCreateBusy || !partnerCreateName.trim()}
              className="px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-40"
            >
              {partnerCreateBusy ? 'Creating…' : 'Create partner'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Partner name</label>
            <input
              type="text"
              value={partnerCreateName}
              onChange={(event) => setPartnerCreateName(event.target.value)}
              placeholder="e.g. Pure Gym"
              className="w-full rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-sm focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Allowed domains</label>
            <p className="mb-1.5 text-xs text-[var(--color-text-secondary)]">
              Manager sign-in domains, one per line. Do not include @.
            </p>
            <textarea
              value={partnerCreateDomains}
              onChange={(event) => setPartnerCreateDomains(event.target.value)}
              placeholder={'activegym.com\npartnerclub.com'}
              rows={3}
              className="w-full rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-sm focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Automated email sources</label>
            <p className="mb-1.5 text-xs text-[var(--color-text-secondary)]">
              Emails or domains that can create add/remove requests, one per line.
            </p>
            <textarea
              value={partnerCreateSources}
              onChange={(event) => setPartnerCreateSources(event.target.value)}
              placeholder={'roster@activegym.com\n@partnerclub.com'}
              rows={3}
              className="w-full rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-sm focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20"
            />
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Connected inboxes can be added after the partner is created.
          </p>
        </div>
      </Modal>
    </>
  );
}
