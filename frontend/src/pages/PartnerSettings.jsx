import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AtSign,
  Copy,
  Loader2,
  Mail,
  Plus,
  Shield,
  Trash2,
  LayoutTemplate,
} from 'lucide-react';
import { AdminPageScroll, Toast, useToast, CardListSkeleton, Modal, HoverTip } from '../components/ui';
import PartnerBrandingProfile from '../components/partner/PartnerBrandingProfile';
import PartnerLogoCropModal from '../components/partner/PartnerLogoCropModal';
import { getUserTimeZoneLabel, formatShortDate } from '../utils/dateTime';
import { clearManagerAllowedDomainsCache } from '../utils/managerAuth';
import { usePartners } from '../context/PartnerContext';
import {
  loadWithCache,
  writeCache,
  clearCache,
  connectInbox,
  createAutomatedSource,
  createManagerDomain,
  deleteAutomatedSource,
  deleteInbox,
  deleteManagerDomain,
  disconnectInbox,
  getAutomatedSources,
  getInboxes,
  getManagerDomains,
  updateInbox,
  getPartnerCustomForm,
  uploadPartnerLogo,
  deletePartnerLogo,
} from '../utils/pilot2Api';
import {
  cachePartnerSlugBranding,
  cachePartnerLogo,
  partnerCustomFormCacheKey,
  readInstantPartnerLogoByPartnerId,
  resolvePartnerLogoSrc,
} from '../utils/partnerSlugBrandingCache';

const MAX_CONNECTED_INBOXES = 7;

function partnerSlugFromName(name) {
  return (name || 'partner').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function partnerFormSignupUrl(partnerName) {
  const slug = partnerSlugFromName(partnerName);
  return `${window.location.origin}/${slug}/submit/signup`;
}

const SETTINGS_TABS = [
  {
    id: 'access',
    label: 'Access Settings',
    descriptionFor: () => 'Who can sign in to the Partner Portal',
    Icon: Shield,
  },
  {
    id: 'automation',
    label: 'Automated Email Intake',
    descriptionFor: () => 'Receiving Inbox and Allowed Senders',
    Icon: Mail,
  },
  {
    id: 'form-builder',
    label: 'Partner Form Branding',
    descriptionFor: () => 'Logo and Name on the Partner Form',
    Icon: LayoutTemplate,
  },
];

function readPmCache(key) {
  try {
    const raw = sessionStorage.getItem(`pm_cache_${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function connectedDate(iso) {
  if (!iso) return null;
  return formatShortDate(iso);
}

function formatAdded(iso) {
  if (!iso) return '';
  return formatShortDate(iso);
}

function formatSourcePattern(source) {
  if (source.kind === 'domain') return `@${source.pattern}`;
  return source.pattern;
}

/** One white surface per tab page; sections stack with soft dividers. */
function SettingsPage({ children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-white shadow-sm divide-y divide-[var(--color-border-default)]/70">
      {children}
    </div>
  );
}

function SettingsSection({ id, title, hint, action, children, footer }) {
  return (
    <section id={id} className="px-5 py-5 sm:px-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--color-text-primary)]">
            {title}
          </h2>
          {hint ? (
            <p className="mt-0.5 text-xs leading-4 text-[var(--color-text-muted)]">
              {hint}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </section>
  );
}

function StatusPill({ tone = 'muted', children }) {
  const tones = {
    ok: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
    warn: 'bg-amber-50 text-amber-800 ring-amber-100',
    muted: 'bg-[var(--color-surface-panel)] text-[var(--color-text-secondary)] ring-[var(--color-border-default)]',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-none ring-1 ring-inset ${tones[tone] || tones.muted}`}>
      {children}
    </span>
  );
}

function ItemList({ children, empty }) {
  if (empty) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/50 px-3.5 py-4 text-sm text-[var(--color-text-secondary)]">
        {empty}
      </div>
    );
  }
  return <ul className="space-y-2">{children}</ul>;
}

function ItemRow({ icon, title, meta, badge, action }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/40 px-3.5 py-3 transition-colors hover:bg-[var(--color-surface-highlight)] sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--color-text-muted)] ring-1 ring-[var(--color-border-default)]" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium leading-5 text-[var(--color-text-primary)]">{title}</p>
            {badge}
          </div>
          {meta ? (
            <p className="mt-0.5 break-all text-xs leading-4 text-[var(--color-text-muted)]">{meta}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center sm:justify-end">{action}</div> : null}
    </li>
  );
}

function AddBar({ onSubmit, children, submitLabel, busy, disabled }) {
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/50 p-2 sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">{children}</div>
      <FilledButton type="submit" disabled={busy || disabled}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {submitLabel}
      </FilledButton>
    </form>
  );
}

function IconButton({ label, onClick, disabled, danger = false, children }) {
  return (
    <HoverTip label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors disabled:opacity-40 ${
          danger
            ? 'hover:bg-red-50 hover:text-red-600'
            : 'hover:bg-white hover:text-[var(--color-text-primary)]'
        }`}
      >
        {children}
      </button>
    </HoverTip>
  );
}

function TextButton({ children, onClick, disabled, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-[var(--color-brand-secondary)] transition-colors hover:bg-[var(--color-brand-secondary-muted)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function FilledButton({ children, onClick, disabled, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-brand-primary)] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const fieldClass =
  'h-9 w-full rounded-md border-0 bg-transparent px-2.5 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] focus:ring-0 disabled:opacity-50';

const fieldStandaloneClass =
  'h-9 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3 text-sm text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-brand-primary)] focus:ring-2 focus:ring-[var(--color-brand-primary)]/15 disabled:opacity-50';

export default function PartnerSettings() {
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    selectedPartner,
    selectedPartnerId,
    partnerLabel,
    updatePartner,
  } = usePartners();

  const [accounts, setAccounts] = useState(() => readPmCache(`inboxes:${selectedPartnerId || ''}`) || []);
  const [inboxesLoading, setInboxesLoading] = useState(() => !readPmCache(`inboxes:${selectedPartnerId || ''}`));
  const [busyId, setBusyId] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [managerDomains, setManagerDomains] = useState(() => readPmCache(`manager_domains:${selectedPartnerId || ''}`) || []);
  const [domainsLoading, setDomainsLoading] = useState(() => !readPmCache(`manager_domains:${selectedPartnerId || ''}`));
  const [domainInput, setDomainInput] = useState('');
  const [domainAdding, setDomainAdding] = useState(false);
  const [pendingDomainRemove, setPendingDomainRemove] = useState(null);

  const [autoSources, setAutoSources] = useState(() => readPmCache(`automated_sources:${selectedPartnerId || ''}`) || []);
  const [sourcesLoading, setSourcesLoading] = useState(() => !readPmCache(`automated_sources:${selectedPartnerId || ''}`));
  const [sourceInput, setSourceInput] = useState('');
  const [sourceAdding, setSourceAdding] = useState(false);
  const [pendingSourceRemove, setPendingSourceRemove] = useState(null);
  const [partnerNameDraft, setPartnerNameDraft] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const profileSnapshotRef = useRef({ name: '', logo: null });
  const [settingsTab, setSettingsTab] = useState('access');

  useEffect(() => {
    const tabFromState = location.state?.settingsTab;
    const tabFromQuery = new URLSearchParams(location.search).get('tab');
    const nextTab = tabFromState || tabFromQuery;
    if (nextTab && SETTINGS_TABS.some((tab) => tab.id === nextTab)) {
      setSettingsTab(nextTab);
      if (tabFromState) {
        navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
      }
    }
  }, [location.pathname, location.search, location.state, navigate]);

  // ── Partner Form branding ───────────────────────────────────────────────
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  const [logoCropOpen, setLogoCropOpen] = useState(false);
  const [logoCropSrc, setLogoCropSrc] = useState(null);
  const logoLoadRef = useRef(0);
  const [profilePreviewing, setProfilePreviewing] = useState(false);
  const [previewAction, setPreviewAction] = useState('Add');
  const [formUrlCopied, setFormUrlCopied] = useState(false);
  const logoInputRef = useRef(null);
  const pendingLogoDataUrlRef = useRef(null);
  const pendingLogoRemoveRef = useRef(false);

  const connectedAccounts = useMemo(
    () => accounts.filter((account) => account.status === 'Connected'),
    [accounts],
  );
  // Keep slots that were connected before (including token-expired) so Reconnect stays available.
  const displayAccounts = useMemo(
    () => accounts.filter((account) => account.status === 'Connected' || account.connectedAt),
    [accounts],
  );
  const atAccountLimit = connectedAccounts.length >= MAX_CONNECTED_INBOXES;

  const inboxCacheKey = `inboxes:${selectedPartnerId || ''}`;
  const domainsCacheKey = `manager_domains:${selectedPartnerId || ''}`;
  const sourcesCacheKey = `automated_sources:${selectedPartnerId || ''}`;

  // Keep the public signup slug cache's allowed domains in sync with edits made
  // here so the manager signup page doesn't read a stale allow-list.
  const syncSlugAllowedDomains = useCallback(
    (rows) => {
      if (!selectedPartner?.name) return;
      cachePartnerSlugBranding(partnerSlugFromName(selectedPartner.name), {
        partnerName: selectedPartner.name,
        allowedDomains: (rows || []).map((row) => row.domain).filter(Boolean),
      });
    },
    [selectedPartner?.name],
  );

  const refreshInboxes = useCallback(() => {
    loadWithCache(inboxCacheKey, () => getInboxes(selectedPartnerId || ''), (rows) => {
      setAccounts(rows);
      setInboxesLoading(false);
    }).catch((err) => {
      setInboxesLoading(false);
      showToast(`Could not load Inboxes: ${err.message}`, 'error');
    });
  }, [inboxCacheKey, selectedPartnerId, showToast]);

  const refreshDomains = useCallback(() => {
    loadWithCache(domainsCacheKey, () => getManagerDomains(selectedPartnerId || ''), (rows) => {
      setManagerDomains(Array.isArray(rows) ? rows : []);
      setDomainsLoading(false);
    }).catch((err) => {
      setDomainsLoading(false);
      showToast(`Could not load Partner Domains: ${err.message}`, 'error');
    });
  }, [domainsCacheKey, selectedPartnerId, showToast]);

  const refreshSources = useCallback(() => {
    loadWithCache(sourcesCacheKey, () => getAutomatedSources(selectedPartnerId || ''), (rows) => {
      setAutoSources(Array.isArray(rows) ? rows : []);
      setSourcesLoading(false);
    }).catch((err) => {
      setSourcesLoading(false);
      showToast(`Could not load Automated Sources: ${err.message}`, 'error');
    });
  }, [selectedPartnerId, showToast, sourcesCacheKey]);

  useEffect(() => {
    refreshInboxes();
    refreshDomains();
    refreshSources();
    window.addEventListener('focus', refreshInboxes);
    return () => window.removeEventListener('focus', refreshInboxes);
  }, [refreshInboxes, refreshDomains, refreshSources]);

  const partnerBrandingCacheKey = selectedPartnerId
    ? partnerCustomFormCacheKey(selectedPartnerId)
    : '';

  useEffect(() => {
    setPartnerNameDraft(selectedPartner?.name || '');
    setProfileEditing(false);
    setProfilePreviewing(false);

    if (!selectedPartnerId) {
      logoLoadRef.current += 1;
      setLogoDataUrl(null);
      return undefined;
    }

    const loadId = ++logoLoadRef.current;
    const partnerName = selectedPartner?.name;
    const cacheKey = partnerBrandingCacheKey;

    setLogoDataUrl(readInstantPartnerLogoByPartnerId(selectedPartnerId));

    const commitLogo = (logo, resForCache = null) => {
      if (loadId !== logoLoadRef.current) return;
      setLogoDataUrl((prev) => (prev === logo ? prev : logo));
      if (selectedPartnerId) cachePartnerLogo(selectedPartnerId, logo);
      if (logo && partnerName) {
        cachePartnerSlugBranding(partnerSlugFromName(partnerName), {
          partnerName,
          logoDataUrl: logo,
        });
      }
      if (resForCache && cacheKey) {
        writeCache(cacheKey, resForCache);
      }
    };

    const processBrandingResponse = (res) => {
      if (loadId !== logoLoadRef.current) return;
      const logo = resolvePartnerLogoSrc(res?.logo_url, res?.logo_data_url);
      commitLogo(logo, res);
    };

    loadWithCache(
      cacheKey,
      () => getPartnerCustomForm(selectedPartnerId),
      (res) => {
        processBrandingResponse(res);
      },
    ).catch((err) => {
      console.error('Could not load manager form branding', err);
    });

    return undefined;
  }, [selectedPartnerId, selectedPartner?.name, partnerBrandingCacheKey]);

  const startProfileEdit = () => {
    if (!selectedPartner) return;
    const name = selectedPartner.name || '';
    setPartnerNameDraft(name);
    profileSnapshotRef.current = { name, logo: logoDataUrl };
    pendingLogoDataUrlRef.current = null;
    pendingLogoRemoveRef.current = false;
    setProfilePreviewing(false);
    setProfileEditing(true);
  };

  const cancelProfileEdit = () => {
    const { name, logo } = profileSnapshotRef.current;
    setPartnerNameDraft(name);
    pendingLogoDataUrlRef.current = null;
    pendingLogoRemoveRef.current = false;
    setLogoDataUrl(logo);
    if (logoInputRef.current) logoInputRef.current.value = '';
    setProfileEditing(false);
  };

  const startProfilePreview = () => {
    setProfileEditing(false);
    setPreviewAction('Add');
    setProfilePreviewing(true);
  };

  const cancelProfilePreview = () => {
    setProfilePreviewing(false);
  };

  const handleAddAccount = async () => {
    const title = addTitle.trim();
    if (!title) {
      showToast('Enter a Display Name for this Inbox.', 'error');
      return;
    }
    if (atAccountLimit) {
      showToast(`Maximum of ${MAX_CONNECTED_INBOXES} connected Inboxes reached.`, 'error');
      return;
    }
    setAddBusy(true);
    try {
      const result = await connectInbox(title, '', selectedPartnerId || '');
      clearCache('pilot2_workspace');
      if (result.authUrl) {
        window.location.assign(result.authUrl);
        return;
      }
      showToast('Inbox Connected.', 'success');
      setAddOpen(false);
      setAddTitle('');
      refreshInboxes();
    } catch (err) {
      showToast(`Connect failed: ${err.message}`, 'error');
    } finally {
      setAddBusy(false);
    }
  };

  const handleConnect = async (account) => {
    setBusyId(account.id);
    try {
      const result = await connectInbox(account.title, account.email, selectedPartnerId || '');
      clearCache('pilot2_workspace');
      if (result.authUrl) {
        window.location.assign(result.authUrl);
        return;
      }
      showToast(`${account.email} connected.`, 'success');
      refreshInboxes();
    } catch (err) {
      showToast(`Connect failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDisconnect = async (account) => {
    setBusyId(account.id);
    try {
      await disconnectInbox(account.id);
      clearCache('pilot2_workspace');
      showToast(`${account.email} disconnected.`, 'success');
      refreshInboxes();
    } catch (err) {
      showToast(`Disconnect failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (!title) {
      showToast('Name cannot be empty.', 'error');
      return;
    }
    setBusyId(renameTarget.id);
    try {
      const updated = await updateInbox(renameTarget.id, title);
      setAccounts((prev) => {
        const next = prev.map((a) => (a.id === updated.id ? updated : a));
        writeCache(inboxCacheKey, next);
        return next;
      });
      showToast('Inbox Renamed.', 'success');
      setRenameTarget(null);
    } catch (err) {
      showToast(`Rename failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteInbox = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await deleteInbox(deleteTarget.id);
      const next = accounts.filter((a) => a.id !== deleteTarget.id);
      setAccounts(next);
      writeCache(inboxCacheKey, next);
      clearCache('pilot2_workspace');
      showToast(`${deleteTarget.email} removed.`, 'success');
      setDeleteTarget(null);
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddDomain = async (event) => {
    event.preventDefault();
    const value = domainInput.trim();
    if (!value) {
      showToast('Enter a domain like activegym.com.', 'error');
      return;
    }
    setDomainAdding(true);
    try {
      const created = await createManagerDomain(value, selectedPartnerId || '');
      setManagerDomains((prev) => {
        const next = [created, ...prev.filter((row) => row.id !== created.id)];
        writeCache(domainsCacheKey, next);
        syncSlugAllowedDomains(next);
        return next;
      });
      setDomainInput('');
      clearManagerAllowedDomainsCache();
      showToast('Partner Domain added.', 'success');
    } catch (err) {
      showToast(err.message || 'Could not add Domain.', 'error');
    } finally {
      setDomainAdding(false);
    }
  };

  const handleRemoveDomain = async (row) => {
    setBusyId(row.id);
    try {
      await deleteManagerDomain(row.id);
      setManagerDomains((prev) => {
        const next = prev.filter((item) => item.id !== row.id);
        writeCache(domainsCacheKey, next);
        syncSlugAllowedDomains(next);
        return next;
      });
      clearManagerAllowedDomainsCache();
      setPendingDomainRemove(null);
      showToast('Partner Domain removed.', 'success');
    } catch (err) {
      showToast(`Remove failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddSource = async (event) => {
    event.preventDefault();
    const value = sourceInput.trim();
    if (!value) {
      showToast('Enter an Email or domain.', 'error');
      return;
    }
    setSourceAdding(true);
    try {
      const created = await createAutomatedSource(value, selectedPartnerId || '');
      setAutoSources((prev) => {
        const next = [created, ...prev.filter((row) => row.id !== created.id)];
        writeCache(sourcesCacheKey, next);
        return next;
      });
      setSourceInput('');
      showToast('Automated Source added.', 'success');
    } catch (err) {
      showToast(err.message || 'Could not add Source.', 'error');
    } finally {
      setSourceAdding(false);
    }
  };

  const handleRemoveSource = async (row) => {
    setBusyId(row.id);
    try {
      await deleteAutomatedSource(row.id);
      setAutoSources((prev) => {
        const next = prev.filter((item) => item.id !== row.id);
        writeCache(sourcesCacheKey, next);
        return next;
      });
      setPendingSourceRemove(null);
      showToast('Automated Source removed.', 'success');
    } catch (err) {
      showToast(`Remove failed: ${err.message}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const partnerDirty = Boolean(selectedPartner)
    && partnerNameDraft.trim() !== (selectedPartner?.name || '')
    && partnerNameDraft.trim().length > 0;
  const logoDirty =
    profileEditing
    && (pendingLogoDataUrlRef.current !== null
      || pendingLogoRemoveRef.current
      || logoDataUrl !== profileSnapshotRef.current.logo);
  const profileDirty = partnerDirty || logoDirty;

  // ── Manager form branding helpers ───────────────────────────────────────
  const closeLogoCrop = () => {
    setLogoCropOpen(false);
    setLogoCropSrc(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const applyLogoSrc = (src, { cacheResponse = null } = {}) => {
    setLogoDataUrl(src);
    if (selectedPartnerId) {
      cachePartnerLogo(selectedPartnerId, src);
      writeCache(partnerBrandingCacheKey, {
        logo_url: src,
        logo_data_url: null,
        fields: cacheResponse?.fields ?? [],
      });
    }
    if (selectedPartner?.name) {
      cachePartnerSlugBranding(partnerSlugFromName(selectedPartner.name), {
        partnerName: selectedPartner.name,
        logoDataUrl: src,
      });
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setLogoCropSrc(ev.target.result);
      setLogoCropOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleAdjustLogoCrop = () => {
    if (!logoDataUrl) return;
    setLogoCropSrc(logoDataUrl);
    setLogoCropOpen(true);
  };

  const handleLogoCropConfirm = (cropped) => {
    pendingLogoRemoveRef.current = false;
    pendingLogoDataUrlRef.current = cropped;
    setLogoDataUrl(cropped);
    closeLogoCrop();
  };

  const handleRemoveLogo = () => {
    pendingLogoDataUrlRef.current = null;
    pendingLogoRemoveRef.current = true;
    setLogoDataUrl(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
    if (selectedPartnerId) cachePartnerLogo(selectedPartnerId, null);
    if (partnerBrandingCacheKey) {
      writeCache(partnerBrandingCacheKey, { logo_url: null, logo_data_url: null, fields: [] });
    }
    if (selectedPartner?.name) {
      cachePartnerSlugBranding(partnerSlugFromName(selectedPartner.name), {
        partnerName: selectedPartner.name,
        logoDataUrl: null,
      });
    }
  };

  const handleSaveProfile = async () => {
    if (!selectedPartner || !selectedPartnerId) return;
    const nextName = partnerNameDraft.trim();
    if (!nextName) {
      showToast(`${partnerLabel} Name cannot be empty.`, 'error');
      return;
    }

    const nameChanged = nextName !== (selectedPartner.name || '');
    if (!nameChanged && !logoDirty) return;

    setProfileSaving(true);
    try {
      let nextLogo = logoDataUrl;

      if (pendingLogoRemoveRef.current) {
        await deletePartnerLogo(selectedPartnerId);
        nextLogo = null;
        applyLogoSrc(null);
        pendingLogoRemoveRef.current = false;
      } else if (pendingLogoDataUrlRef.current) {
        const uploaded = await uploadPartnerLogo(selectedPartnerId, pendingLogoDataUrlRef.current);
        nextLogo = uploaded.logo_url;
        applyLogoSrc(nextLogo);
        pendingLogoDataUrlRef.current = null;
      }

      const slug = partnerSlugFromName(nextName);
      if (slug) {
        cachePartnerSlugBranding(slug, {
          partnerName: nextName,
          logoDataUrl: nextLogo,
        });
      }

      if (nameChanged) {
        await updatePartner(selectedPartner.id, nextName);
      }

      profileSnapshotRef.current = { name: nextName, logo: nextLogo };
      setProfileEditing(false);
      showToast('Profile saved.', 'success');
    } catch (err) {
      showToast(err.message || 'Could not save profile.', 'error');
    } finally {
      setProfileSaving(false);
    }
  };

  const previewPartnerName = profileEditing
    ? partnerNameDraft.trim() || partnerLabel
    : (selectedPartner?.name || partnerLabel);

  const partnerFormUrl = previewPartnerName ? partnerFormSignupUrl(previewPartnerName) : '';

  const handleCopyFormUrl = () => {
    if (!partnerFormUrl) return;
    navigator.clipboard.writeText(partnerFormUrl).then(() => {
      setFormUrlCopied(true);
      window.setTimeout(() => setFormUrlCopied(false), 2000);
    });
  };

  return (
    <AdminPageScroll dataPage="partner-settings" contentClassName="min-w-0 select-none pb-16">
      <Toast />

      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            {partnerLabel} Support
          </p>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)] sm:text-2xl">
            {partnerLabel} Settings
          </h1>
        </header>

        <div
          role="tablist"
          aria-label={`${partnerLabel} Settings sections`}
          className="mb-5 grid grid-cols-1 gap-1 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-panel)] p-1 sm:grid-cols-3"
        >
          {SETTINGS_TABS.map((tab) => {
            const selected = settingsTab === tab.id;
            const Icon = tab.Icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`partner-settings-tab-${tab.id}`}
                aria-controls={`partner-settings-panel-${tab.id}`}
                aria-selected={selected}
                onClick={() => {
                  setSettingsTab(tab.id);
                  if (tab.id !== 'form-builder') setPartnerNameEditing(false);
                }}
                className={`flex items-start gap-3 rounded-lg px-3.5 py-3 text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/35 ${
                  selected
                    ? 'bg-white shadow-sm ring-1 ring-[var(--color-border-default)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-white/70 hover:text-[var(--color-text-primary)]'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    selected
                      ? 'bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]'
                      : 'bg-white/80 text-[var(--color-text-muted)]'
                  }`}
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span
                    className={`block whitespace-nowrap text-sm leading-5 ${
                      selected
                        ? 'font-semibold text-[var(--color-text-primary)]'
                        : 'font-medium'
                    }`}
                  >
                    {tab.label}
                  </span>
                  <span
                    className={`mt-0.5 block text-xs leading-4 ${
                      selected
                        ? 'text-[var(--color-text-secondary)]'
                        : 'text-[var(--color-text-muted)]'
                    }`}
                  >
                    {tab.descriptionFor(partnerLabel)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`partner-settings-panel-${settingsTab}`}
          aria-labelledby={`partner-settings-tab-${settingsTab}`}
        >
          {settingsTab === 'access' ? (
            <SettingsPage>
          <SettingsSection
            id="partner-access"
            title="Partner Access"
            hint="Only these Email domains can sign in to the Partner Portal."
            footer={(
              <AddBar
                onSubmit={handleAddDomain}
                submitLabel="Add"
                busy={domainAdding}
                disabled={!domainInput.trim()}
              >
                <input
                  id="partner-domain"
                  type="text"
                  value={domainInput}
                  onChange={(event) => setDomainInput(event.target.value)}
                  placeholder="Domain (e.g. activegym.com)"
                  className={fieldClass}
                  aria-label="Domain"
                />
              </AddBar>
            )}
          >
            {domainsLoading ? (
              <CardListSkeleton rows={2} />
            ) : (
              <ItemList empty={managerDomains.length === 0 ? 'No domains yet. Add one below.' : null}>
                {managerDomains.map((row) => (
                  <ItemRow
                    key={row.id}
                    icon={<AtSign className="h-4 w-4" />}
                    title={`@${row.domain}`}
                    meta={row.createdAt ? `Added ${formatAdded(row.createdAt)}` : null}
                    action={(
                      <IconButton
                        label={`Remove ${row.domain}`}
                        onClick={() => setPendingDomainRemove(row)}
                        disabled={busyId === row.id}
                        danger
                      >
                        {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </IconButton>
                    )}
                  />
                ))}
              </ItemList>
            )}
          </SettingsSection>
            </SettingsPage>
          ) : settingsTab === 'automation' ? (
            <SettingsPage>
          <SettingsSection
            id="connected-inbox"
            title="Connected Inbox (Power Music)"
            hint={`Used for automated add/remove Email · ${getUserTimeZoneLabel()}`}
            action={(
              <TextButton
                onClick={() => { setAddTitle(''); setAddOpen(true); }}
                disabled={addBusy || atAccountLimit}
              >
                <Plus className="h-4 w-4" />
                Connect
              </TextButton>
            )}
          >
            {inboxesLoading ? (
              <CardListSkeleton rows={2} />
            ) : displayAccounts.length === 0 ? (
              <div className="flex items-start gap-3 rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/50 px-3.5 py-4">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">No Inbox Connected</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    Connect the Inbox that receives {partnerLabel} add/remove mail.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {displayAccounts.map((account) => {
                  const isConnected = account.status === 'Connected';
                  const needsReconnect =
                    (isConnected && account.backfillError === 'oauth_revoked')
                    || (!isConnected && Boolean(account.connectedAt));
                  const isBusy = busyId === account.id;
                  const statusLine = isConnected && account.connectedAt && !needsReconnect
                    ? `Connected ${connectedDate(account.connectedAt)}`
                    : null;
                  return (
                    <li
                      key={account.id}
                      className="flex flex-col gap-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-panel)]/40 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                            {account.title}
                          </p>
                          <StatusPill tone={needsReconnect ? 'warn' : isConnected ? 'ok' : 'muted'}>
                            {needsReconnect ? 'Reconnect Required' : account.status}
                          </StatusPill>
                        </div>
                        <p className="mt-0.5 break-all text-xs text-[var(--color-text-secondary)]">
                          {account.email || 'No Email yet'}
                        </p>
                        {statusLine ? (
                          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                            {statusLine}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
                        <TextButton
                          onClick={() => { setRenameTarget(account); setRenameValue(account.title); }}
                          disabled={isBusy}
                        >
                          Rename
                        </TextButton>
                        <TextButton onClick={() => handleConnect(account)} disabled={isBusy}>
                          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {needsReconnect || isConnected ? 'Reconnect' : 'Connect'}
                        </TextButton>
                        {isConnected ? (
                          <TextButton onClick={() => handleDisconnect(account)} disabled={isBusy}>
                            Disconnect
                          </TextButton>
                        ) : null}
                        <IconButton
                          label="Remove Inbox"
                          onClick={() => setDeleteTarget(account)}
                          disabled={isBusy}
                          danger
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SettingsSection>

          <SettingsSection
            id="auto-sources"
            title={`Automated Email Sources (${partnerLabel})`}
            hint="Emails or domains that can create add/remove requests automatically."
            footer={(
              <AddBar
                onSubmit={handleAddSource}
                submitLabel="Add"
                busy={sourceAdding}
                disabled={!sourceInput.trim()}
              >
                <input
                  id="auto-source"
                  type="text"
                  value={sourceInput}
                  onChange={(event) => setSourceInput(event.target.value)}
                  placeholder="Email or @domain"
                  className={fieldClass}
                  aria-label="Email or Domain"
                />
              </AddBar>
            )}
          >
            {sourcesLoading ? (
              <CardListSkeleton rows={3} />
            ) : (
              <ItemList empty={autoSources.length === 0 ? 'No sources yet. Add an Email or domain below.' : null}>
                {autoSources.map((row) => (
                  <ItemRow
                    key={row.id}
                    icon={row.kind === 'domain' ? <AtSign className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                    title={formatSourcePattern(row)}
                    badge={<StatusPill>{row.kind === 'domain' ? 'Partner Domain' : 'Email'}</StatusPill>}
                    meta={row.createdAt ? `Added ${formatAdded(row.createdAt)}` : null}
                    action={(
                      <IconButton
                        label={`Remove ${formatSourcePattern(row)}`}
                        onClick={() => setPendingSourceRemove(row)}
                        disabled={busyId === row.id}
                        danger
                      >
                        {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </IconButton>
                    )}
                  />
                ))}
              </ItemList>
            )}
          </SettingsSection>
            </SettingsPage>
          ) : (
            <SettingsPage>
              <PartnerBrandingProfile
                partnerName={selectedPartner?.name}
                logoDataUrl={logoDataUrl}
                formUrl={partnerFormUrl}
                formUrlCopied={formUrlCopied}
                onCopyFormUrl={handleCopyFormUrl}
                previewing={profilePreviewing}
                previewAction={previewAction}
                onPreviewActionChange={setPreviewAction}
                onStartPreview={startProfilePreview}
                onCancelPreview={cancelProfilePreview}
                editing={profileEditing}
                onStartEdit={startProfileEdit}
                onCancelEdit={cancelProfileEdit}
                nameDraft={partnerNameDraft}
                onNameDraftChange={setPartnerNameDraft}
                onSaveProfile={handleSaveProfile}
                profileSaving={profileSaving}
                profileDirty={profileDirty}
                onLogoUpload={handleLogoUpload}
                onAdjustLogoCrop={handleAdjustLogoCrop}
                onRemoveLogo={handleRemoveLogo}
                logoInputRef={logoInputRef}
                disabled={!selectedPartner}
                fieldClass={fieldStandaloneClass}
              />
            </SettingsPage>
          )}
        </div>
      </div>

      <Modal
        isOpen={addOpen}
        onClose={() => !addBusy && setAddOpen(false)}
        title="Connect Inbox"
        footer={(
          <>
            <button type="button" onClick={() => setAddOpen(false)} disabled={addBusy} className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-40">
              Cancel
            </button>
            <button type="button" onClick={handleAddAccount} disabled={addBusy || !addTitle.trim()} className="px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-40">
              {addBusy ? 'Redirecting…' : 'Continue to Google'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-[var(--color-text-secondary)]">
              Display Name
            </label>
            <input
              type="text"
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder={`e.g. ${partnerLabel} notifications`}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddAccount(); }}
              className={fieldStandaloneClass}
              autoFocus
            />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            You’ll be redirected to Google to choose the Inbox for automated roster emails.
          </p>
        </div>
      </Modal>

      <Modal
        isOpen={renameTarget != null}
        onClose={() => setRenameTarget(null)}
        title="Rename Inbox"
        footer={(
          <>
            <button type="button" onClick={() => setRenameTarget(null)} className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={handleRename} disabled={!renameValue.trim() || busyId === renameTarget?.id} className="px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] disabled:opacity-40">Save</button>
          </>
        )}
      >
        <label className="mb-1.5 block text-xs text-[var(--color-text-secondary)]">Display Name</label>
        <input
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
          className={fieldStandaloneClass}
          autoFocus
        />
      </Modal>

      <Modal
        isOpen={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        confirm
        title="Remove Inbox"
        footer={(
          <>
            <button type="button" onClick={() => setDeleteTarget(null)} className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={handleDeleteInbox} disabled={busyId === deleteTarget?.id} className="px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] disabled:opacity-40">Remove Inbox</button>
          </>
        )}
      >
        <p>Remove <strong>{deleteTarget?.title}</strong> ({deleteTarget?.email})? Automated emails will no longer be imported from this Inbox.</p>
      </Modal>

      <Modal
        isOpen={pendingDomainRemove != null}
        onClose={() => !busyId && setPendingDomainRemove(null)}
        confirm
        title="Remove Partner Domain"
        footer={(
          <>
            <button type="button" onClick={() => setPendingDomainRemove(null)} disabled={busyId != null} className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => pendingDomainRemove && handleRemoveDomain(pendingDomainRemove)} disabled={busyId != null} className="px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] disabled:opacity-50">Remove</button>
          </>
        )}
      >
        <p>Sign-in from <strong>@{pendingDomainRemove?.domain}</strong> will no longer be allowed.</p>
      </Modal>

      <Modal
        isOpen={pendingSourceRemove != null}
        onClose={() => !busyId && setPendingSourceRemove(null)}
        confirm
        title="Remove Automated Source"
        footer={(
          <>
            <button type="button" onClick={() => setPendingSourceRemove(null)} disabled={busyId != null} className="px-4 py-2 border border-[var(--color-border-default)] rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => pendingSourceRemove && handleRemoveSource(pendingSourceRemove)} disabled={busyId != null} className="px-4 py-2 text-white text-sm font-semibold rounded-md bg-[var(--color-brand-primary)] disabled:opacity-50">Remove</button>
          </>
        )}
      >
        <p>Stop treating messages from <strong>{pendingSourceRemove ? formatSourcePattern(pendingSourceRemove) : ''}</strong> as automated add/remove requests.</p>
      </Modal>

      <PartnerLogoCropModal
        isOpen={logoCropOpen}
        imageSrc={logoCropSrc}
        onCancel={closeLogoCrop}
        onConfirm={handleLogoCropConfirm}
        busy={profileSaving}
      />
    </AdminPageScroll>
  );
}
