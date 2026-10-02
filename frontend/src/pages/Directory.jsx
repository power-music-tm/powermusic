import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useLocation, useSearchParams, Link } from 'react-router-dom';
import { Search, Download, Info, SortAsc, ChevronDown, Filter, ArrowRight, Mail, UserRound, CheckCircle2, Pencil, Loader2, Archive, RotateCcw, Trash2 } from 'lucide-react';

import { formatTimestampSplit } from '../utils/dateTime';
import { DataTable, Tag, Drawer, SelectDropdown, StackedTextCell, TruncateCell, EMPTY_CELL, CountTabs, AdminPageScroll, TablePagination, Modal, Toast, useToast, HoverTip, DateFilter } from '../components/ui';
import PageHeader from '../components/layout/PageHeader';
import { loadWithCache, updatePerson, archivePerson, restorePerson, fetchArchivedPeople, bulkArchivePersons, bulkRestorePersons, bulkDeletePersons } from '../utils/pilot2Api';
import { fetchJson } from '../utils/api';
import { useClientPagination } from '../hooks/useClientPagination';
import {
  registerDirectoryPageVisit,
  isDirectoryPersonHighlighted,
  clearDirectoryPersonHighlight,
  ADMIN_NEW_ROW_HIGHLIGHT_CLASS,
} from '../utils/adminUiHighlights';
import { formatRequestDisplayId, formatAdminDateTime, formatAdminDate } from '../utils/requestDisplayId';
import { calculateDateBounds, filterByDateRange, getDirectoryRecordTimestamp } from '../utils/dateFilters';
import { formatManagerNotes, readManagerNotes, MANAGER_NOTES_EMPTY_LABEL } from '../utils/managerNotes';
import { csvCell } from '../utils/csvSafe';
import { getDirectoryManagerColumnContent } from '../utils/manualEntry';
import { formatPersonFields } from '../utils/personDisplay';
import { usePartners } from '../context/PartnerContext';
import { getPartnerTerminology } from '../utils/managerAuthBranding';

const directoryHighlightClass = (row) =>
  isDirectoryPersonHighlighted(row.email) ? ADMIN_NEW_ROW_HIGHLIGHT_CLASS : '';

const personManagerName = (user) => user.managerName || '';
const personHandledBy = (user) => user.handledBy || user.addedBy || 'Power Music Admin';
const personAdminNotes = (user) => user.adminNotes || '';
const formatAdminNotes = (user) => personAdminNotes(user).trim() || MANAGER_NOTES_EMPTY_LABEL;

function buildFallbackHistory(user, terms = getPartnerTerminology()) {
  const events = [];
  if (user?.dateAdded) {
    events.push({
      id: `${user.id}-handled`,
      type: 'handled',
      at: user.dateAdded,
      title: user.archivedAt ? 'Removed to archive' : 'Added and moved to active',
      detail: `By ${personHandledBy(user)}`,
      displayId: user.displayId,
    });
  }
  if (user?.requestReceivedAt) {
    events.push({
      id: `${user.id}-manager-request`,
      type: 'manager_request',
      at: user.requestReceivedAt,
      title: `${terms.managerTerm} request received`,
      detail: personManagerName(user)
        ? `Submitted by ${personManagerName(user)}`
        : null,
      displayId: user.displayId,
    });
  }
  return events;
}

function historyIcon(type) {
  if (type === 'auto_mail') return Mail;
  if (type === 'handled') return CheckCircle2;
  return UserRound;
}

function DrawerMetaRow({ label, value, mono = false }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-[11px] font-medium text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd
        className={`min-w-0 text-right text-xs font-semibold text-[var(--color-text-primary)] ${
          mono ? 'font-mono break-all' : 'break-words'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function DrawerSection({ title, children, className = '' }) {
  return (
    <section
      className={`rounded-xl border border-[var(--color-border-default)] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(26,26,46,0.04)] ${className}`.trim()}
    >
      <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function requestIdsMatch(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function findLedgerRowForRequestId(ledger, requestId) {
  return (ledger ?? []).find((user) =>
    requestIdsMatch(user.id, requestId) || requestIdsMatch(user.sourceRequestId, requestId),
  );
}

const SORT_PRESETS = [
  { value: 'displayId-desc', label: 'ID (newest first)' },
  { value: 'displayId-asc', label: 'ID (oldest first)' },
  { value: 'dateAdded-desc', label: 'Timestamp (newest first)' },
  { value: 'dateAdded-asc', label: 'Timestamp (oldest first)' },
  { value: 'firstName-asc', label: 'First name (A–Z)' },
  { value: 'firstName-desc', label: 'First name (Z–A)' },
  { value: 'lastName-asc', label: 'Last name (A–Z)' },
  { value: 'lastName-desc', label: 'Last name (Z–A)' },
  { value: 'personEmail-asc', label: 'Person email (A–Z)' },
  { value: 'personEmail-desc', label: 'Person email (Z–A)' },
  { value: 'personLocation-asc', label: 'Person location (A–Z)' },
  { value: 'personLocation-desc', label: 'Person location (Z–A)' },
  { value: 'managerName-asc', label: 'Manager name (A–Z)' },
  { value: 'managerName-desc', label: 'Manager name (Z–A)' }
];

const DEFAULT_SORT = 'displayId-desc';

function parseSortPreset(preset) {
  const match = preset.match(/^(.+)-(asc|desc)$/);
  if (!match) return { field: 'displayId', dir: 'asc' };
  return { field: match[1], dir: match[2] };
}

// ─── Controls Bar ─────────────────────────────────────────────────────────────
function ControlsBar({
  searchQuery, setSearchQuery,
  filterOpen, setFilterOpen,
  filterSlots,
  sortPreset, setSortPreset,
  sortPresets = SORT_PRESETS,
  activeFilterCount,
  dateFilter, setDateFilter
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);
  const isSortCustom = sortPreset !== DEFAULT_SORT;
  const activeSortLabel = sortPresets.find((o) => o.value === sortPreset)?.label ?? 'Sort';

  useEffect(() => {
    if (!sortOpen) return;
    const onClickOutside = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) {
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [sortOpen]);

  const toolbarBtnClass = (active) =>
    `flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
      active
        ? 'bg-white text-[var(--color-brand-secondary)] shadow-[0_1px_2px_rgba(44,95,143,0.12)] ring-1 ring-[var(--color-brand-secondary-border)]/55'
        : 'text-[var(--color-text-secondary)] hover:bg-white/80 hover:text-[var(--color-brand-secondary)]'
    }`;

  return (
    <div className="w-full rounded-2xl border border-[var(--color-brand-secondary-border)]/55 bg-white shadow-[var(--shadow-card)]">
      <div
        className={`bg-[var(--color-brand-secondary-muted)]/45 ${
          filterOpen
            ? 'border-b border-[var(--color-brand-secondary-border)]/40 rounded-t-2xl'
            : 'rounded-2xl'
        }`}
      >
        <div className="flex flex-col md:flex-row items-stretch gap-2 p-2">
          <div className="flex items-center gap-2.5 px-3 py-2 flex-1 bg-white rounded-xl border border-[var(--color-brand-secondary-border)]/35 shadow-sm focus-within:ring-2 focus-within:ring-[var(--color-brand-secondary)]/15 focus-within:border-[var(--color-brand-secondary-border)] transition-shadow">
            <Search className="h-4 w-4 text-[var(--color-brand-secondary)]/70 shrink-0" />
            <input
              type="text"
              placeholder="Search person name, email, or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none"
            />
            {searchQuery && (
              <HoverTip label="Clear search">
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-xs leading-none cursor-pointer"
                >
                  ✕
                </button>
              </HoverTip>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <button
              onClick={() => { setFilterOpen((o) => !o); setSortOpen(false); }}
              className={toolbarBtnClass(filterOpen || activeFilterCount > 0)}
            >
              <Filter className="h-4 w-4" />
              <span>Filter</span>
              {activeFilterCount > 0 && (
                <span className="ml-0.5 bg-[var(--color-brand-secondary)] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
            </button>

            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setSortOpen((o) => !o)}
                className={toolbarBtnClass(sortOpen || isSortCustom)}
              >
                <SortAsc className="h-4 w-4" />
                <span className="max-w-[120px] truncate">{isSortCustom ? activeSortLabel : 'Sort'}</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
              </button>

              {sortOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-56 max-h-72 overflow-y-auto py-1 bg-white rounded-xl border border-[var(--color-brand-secondary-border)]/45 shadow-[var(--shadow-modal)]">
                  {sortPresets.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setSortPreset(opt.value); setSortOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                        sortPreset === opt.value
                          ? 'bg-[var(--color-brand-secondary-muted)] text-[var(--color-brand-secondary)]'
                          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-brand-secondary-muted)]/50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {isSortCustom && (
                    <>
                      <div className="my-1 h-px bg-[var(--color-border-default)]" />
                      <button
                        type="button"
                        onClick={() => { setSortPreset(DEFAULT_SORT); setSortOpen(false); }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-brand-accent)] transition-colors cursor-pointer"
                      >
                        Reset sort
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {filterOpen && (
        <div className="bg-[var(--color-brand-secondary-muted)]/35 px-4 py-4 rounded-b-2xl">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            {filterSlots.map((slot) => (
              <div
                key={slot.label}
                className={`flex flex-col gap-1 ${
                  slot.searchable === false
                    ? 'min-w-[140px] max-w-full'
                    : 'min-w-[140px] max-w-[min(18rem,100%)]'
                }`}
              >
                <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-brand-secondary)]/80">
                  {slot.label}
                </label>
                <SelectDropdown
                  value={slot.value}
                  onChange={slot.onChange}
                  options={slot.options}
                  size="sm"
                  className={slot.searchable === false ? 'w-full' : undefined}
                  searchable={slot.searchable !== false}
                  searchPlaceholder={`Search ${slot.label.toLowerCase()}…`}
                />
              </div>
            ))}
            <div className="flex flex-col gap-1 min-w-[140px] max-w-[min(18rem,100%)]">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-brand-secondary)]/80">
                Date
              </label>
              <DateFilter
                value={dateFilter}
                onChange={setDateFilter}
                variant="slot"
              />
            </div>
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  filterSlots.forEach((s) => s.onChange(s.options[0].value));
                  setDateFilter({ type: 'all', value: null });
                }}
                className="ml-auto text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-brand-accent)] transition-colors cursor-pointer pb-2"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const buildFilterOptions = (values) => [
  { value: 'All', label: 'All' },
  ...values.map((v) => ({ value: v, label: v }))
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTimestamp(iso) {
  return formatTimestampSplit(iso);
}

const TimestampCell = ({ val, className = '' }) => {
  if (!val) return <span className="text-sm text-[var(--color-text-muted)]">{EMPTY_CELL}</span>;
  const { date, time } = formatTimestamp(val);
  return (
    <div className={`flex flex-col gap-0.5 ${className}`.trim()}>
      <span className="text-sm font-semibold leading-5 whitespace-nowrap text-[var(--color-text-primary)]">{date}</span>
      <span className="text-xs leading-4 whitespace-nowrap text-[var(--color-text-muted)]">{time}</span>
    </div>
  );
};

function EditPersonModal({ isOpen, onClose, user, onSave }) {
  const { showToast } = useToast();
  const { selectedPartnerId, partners } = usePartners();
  const selectedPartner = useMemo(
    () => partners?.find((p) => String(p.id) === String(selectedPartnerId)),
    [partners, selectedPartnerId],
  );
  const isHealthFitness = useMemo(
    () =>
      selectedPartner?.slug === 'health-tech' ||
      selectedPartner?.slug === 'health-fitness' ||
      (selectedPartner?.name || '').toLowerCase().includes('healthtech') ||
      (selectedPartner?.name || '').toLowerCase().includes('health tech') ||
      (selectedPartner?.name || '').toLowerCase().includes('health fitness'),
    [selectedPartner],
  );
  const isGll = useMemo(
    () => (selectedPartner?.name || '').toLowerCase().includes('gll'),
    [selectedPartner],
  );
  const isJdGyms = useMemo(
    () => {
      const slug = (selectedPartner?.slug || '').toLowerCase();
      const name = (selectedPartner?.name || '').toLowerCase();
      return (
        slug === 'jd-gyms' ||
        slug === 'jdgyms' ||
        slug === 'jd' ||
        slug.includes('jd-gyms') ||
        slug.includes('jdgyms') ||
        name.includes('jd gyms') ||
        name.includes('jdgyms') ||
        name === 'jd'
      );
    },
    [selectedPartner],
  );

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    location: '',
    role: '',
    directorFirst: '',
    directorLast: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        location: user.location || '',
        role: user.role || user.person?.role || '',
        directorFirst: user.directorFirst || user.person?.directorFirst || '',
        directorLast: user.directorLast || user.person?.directorLast || '',
      });
      setErrors({});
    }
  }, [user]);

  if (!isOpen || !user) return null;

  const validate = () => {
    const errs = {};
    if (!formData.firstName.trim()) errs.firstName = 'First name is required.';
    if (!formData.lastName.trim()) errs.lastName = 'Last name is required.';
    if (!formData.email.trim()) {
      errs.email = 'Email is required.';
    } else if (!/\S+@\S+\.\S+/.test(formData.email.trim())) {
      errs.email = 'Enter a valid email address.';
    }
    // GLL has no location field — skip validation
    if (!isGll && !formData.location.trim()) errs.location = 'Location is required.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload = {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim().toLowerCase(),
        location: formData.location.trim(),
        ...(isJdGyms ? {
          role: formData.role.trim() || null,
        } : {}),
        ...(isHealthFitness ? {
          directorFirst: formData.directorFirst.trim(),
          directorLast: formData.directorLast.trim(),
        } : {}),
      };
      const updated = await updatePerson(user.id, payload, selectedPartnerId || '');
      showToast('Directory record updated successfully.', 'success');
      onSave(updated);
      onClose();
    } catch (err) {
      showToast(err.message || 'Could not update record.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !submitting && onClose()}
      title={`Edit ${user.firstName ? user.firstName + ' ' + (user.lastName || '') : 'Directory Record'}`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-40"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving…</span>
              </>
            ) : (
              'Save changes'
            )}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-left">
        <div>
          <label htmlFor="edit-person-firstname" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            First Name <span className="text-red-500">*</span>
          </label>
          <input
            id="edit-person-firstname"
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData((prev) => ({ ...prev, firstName: e.target.value }))}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              errors.firstName
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200 bg-red-50/30'
                : 'border-[var(--color-border-default)] focus:border-[var(--color-brand-primary)] focus:ring-[var(--color-brand-primary)]/20'
            }`}
          />
          {errors.firstName && <p className="mt-1 text-xs font-medium text-red-600">{errors.firstName}</p>}
        </div>

        <div>
          <label htmlFor="edit-person-lastname" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Last Name <span className="text-red-500">*</span>
          </label>
          <input
            id="edit-person-lastname"
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData((prev) => ({ ...prev, lastName: e.target.value }))}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              errors.lastName
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200 bg-red-50/30'
                : 'border-[var(--color-border-default)] focus:border-[var(--color-brand-primary)] focus:ring-[var(--color-brand-primary)]/20'
            }`}
          />
          {errors.lastName && <p className="mt-1 text-xs font-medium text-red-600">{errors.lastName}</p>}
        </div>

        <div>
          <label htmlFor="edit-person-email" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="edit-person-email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              errors.email
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200 bg-red-50/30'
                : 'border-[var(--color-border-default)] focus:border-[var(--color-brand-primary)] focus:ring-[var(--color-brand-primary)]/20'
            }`}
          />
          {errors.email && <p className="mt-1 text-xs font-medium text-red-600">{errors.email}</p>}
        </div>

        <div>
          <label htmlFor="edit-person-location" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {isGll ? 'Gym Location' : (isHealthFitness ? 'Client' : 'Location')} {!isGll && <span className="text-red-500">*</span>}
          </label>
          <input
            id="edit-person-location"
            type="text"
            value={formData.location}
            onChange={(e) => setFormData((prev) => ({ ...prev, location: e.target.value }))}
            placeholder={isGll ? 'e.g. London, Manchester (optional)' : undefined}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              errors.location
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200 bg-red-50/30'
                : 'border-[var(--color-border-default)] focus:border-[var(--color-brand-primary)] focus:ring-[var(--color-brand-primary)]/20'
            }`}
          />
          {errors.location && <p className="mt-1 text-xs font-medium text-red-600">{errors.location}</p>}
        </div>

        {isJdGyms && (
          <div>
            <label htmlFor="edit-person-role" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Role
            </label>
            <input
              id="edit-person-role"
              type="text"
              value={formData.role}
              onChange={(e) => setFormData((prev) => ({ ...prev, role: e.target.value }))}
              className="w-full rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-sm focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20"
              placeholder="Role (optional)"
            />
          </div>
        )}

        {isHealthFitness && (
          <>
            <div>
              <label htmlFor="edit-person-director-first" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Director First Name
              </label>
              <input
                id="edit-person-director-first"
                type="text"
                value={formData.directorFirst}
                onChange={(e) => setFormData((prev) => ({ ...prev, directorFirst: e.target.value }))}
                className="w-full rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-sm focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20"
                placeholder="Director first name"
              />
            </div>
            <div>
              <label htmlFor="edit-person-director-last" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Director Last Name
              </label>
              <input
                id="edit-person-director-last"
                type="text"
                value={formData.directorLast}
                onChange={(e) => setFormData((prev) => ({ ...prev, directorLast: e.target.value }))}
                className="w-full rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-sm focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20"
                placeholder="Director last name"
              />
            </div>
          </>
        )}

      </form>
    </Modal>
  );
}

function DirectoryMobileList({
  rows,
  loading,
  emptyMessage,
  onOpenUser,
  onEditUser,
  onArchiveUser,
  onRestoreUser,
  onDeleteUser,
  highlightVersion,
  getRowClassName,
}) {
  const { selectedPartner, partners } = usePartners();
  if (loading) {
    return (
      <div className="rounded-md border border-[var(--color-border-default)] bg-white p-4 sm:hidden">
        <ul className="space-y-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <li key={idx} className="space-y-2 border-b border-[var(--color-border-default)] pb-3 last:border-b-0 last:pb-0">
              <div className="h-3.5 w-20 animate-pulse rounded bg-[var(--color-surface-highlight)]" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--color-surface-highlight)]" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--color-surface-highlight)]" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="rounded-md border border-[var(--color-border-default)] bg-white px-4 py-8 text-center text-sm text-[var(--color-text-secondary)] sm:hidden">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-md border border-[var(--color-border-default)] bg-white sm:hidden">
      {rows.map((row) => {
        void highlightVersion;
        const extraClass = getRowClassName ? getRowClassName(row) : '';
        const rawPartnerId = row?.partnerId || row?.partner_id;
        const matchedPartner = partners?.find((p) => String(p.id) === String(rawPartnerId)) || selectedPartner;
        const pName = row?.partnerName || row?.partner_name || matchedPartner?.name;
        const pSlug = row?.partnerSlug || row?.partner_slug || matchedPartner?.slug;
        const rowTerms = getPartnerTerminology(pName, pSlug);
        const { name, email, location } = formatPersonFields(row);
        const manager = getDirectoryManagerColumnContent(row, { partnerName: pName, partnerSlug: pSlug });

        return (
          <li key={row.id} className="border-b border-[var(--color-border-default)] last:border-b-0">
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpenUser(row)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenUser(row);
                }
              }}
              aria-label={`View ${name}`}
              className={`flex w-full flex-col gap-3 px-4 py-3 text-left transition-colors hover:bg-[#f9fafb] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-primary)]/35 cursor-pointer ${extraClass}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold tabular-nums text-[var(--color-text-muted)]">
                      {formatRequestDisplayId(row.displayId)}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      {onEditUser && (
                        <HoverTip label="Edit">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditUser(row);
                            }}
                            className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-brand-primary)] transition-colors"
                            aria-label={`Edit ${name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </HoverTip>
                      )}
                      {onArchiveUser && (
                        <HoverTip label="Archive">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onArchiveUser(row);
                            }}
                            className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition-colors"
                            aria-label={`Archive ${name}`}
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        </HoverTip>
                      )}
                      {onRestoreUser && (
                        <HoverTip label="Restore">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRestoreUser(row);
                            }}
                            className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                            aria-label={`Restore ${name}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        </HoverTip>
                      )}
                      {onDeleteUser && (
                        <HoverTip label="Delete permanently">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteUser(row);
                            }}
                            className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-red-300 hover:bg-red-50 hover:text-red-700 transition-colors"
                            aria-label={`Permanently Delete ${name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </HoverTip>
                      )}
                    </div>
                  </div>

                  <TimestampCell val={row.dateAdded} />

                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{name}</p>
                    <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">{email}</p>
                    <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
                      {rowTerms.isGll
                        ? ((row.location || '').trim() || 'No location')
                        : location}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                      {rowTerms.managerTerm}
                    </p>
                    <p className={`mt-0.5 truncate text-xs font-semibold ${
                      manager.muted ? 'text-[var(--color-text-muted)] italic' : 'text-[var(--color-text-primary)]'
                    }`}>
                      {manager.primary}
                    </p>
                    {manager.secondary ? (
                      <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-secondary)]">
                        {manager.secondary}
                      </p>
                    ) : null}
                    {manager.tertiary ? (
                      <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
                        <span className="font-semibold">{rowTerms.isGll ? 'Gym Location' : rowTerms.locationTerm}:</span> {manager.tertiary}
                      </p>
                    ) : null}
                  </div>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function UserLedger() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestIdFromUrl = searchParams.get('id');
  const consumedDirectoryDeepLinkRef = useRef(null);
  const { selectedPartnerId, partnerLabel, partners } = usePartners();
  const selectedPartner = useMemo(
    () => partners?.find((p) => String(p.id) === String(selectedPartnerId)),
    [partners, selectedPartnerId],
  );
  const terms = useMemo(
    () => getPartnerTerminology(selectedPartner?.name, selectedPartner?.slug),
    [selectedPartner],
  );
  const isGll = terms.isGll;

  const [liveUserLedger, setLiveUserLedger] = useState([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [highlightVersion, setHighlightVersion] = useState(0);
  const { showToast } = useToast();

  const directoryView = location.pathname.startsWith('/directory/archived') ? 'archived' : 'active';
  const [archivedUserLedger, setArchivedUserLedger] = useState([]);
  const [archivingUser, setArchivingUser] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [restoringUser, setRestoringUser] = useState(null);
  const [restoringUserId, setRestoringUserId] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);

  // ── Bulk Action states ──
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmBulkArchive, setConfirmBulkArchive] = useState(false);
  const [bulkArchiveLoading, setBulkArchiveLoading] = useState(false);
  const [confirmExportOpen, setConfirmExportOpen] = useState(false);

  const handleToggleSelect = useCallback((id, isSelected) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isSelected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback((visibleIds, selectAll) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (selectAll) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const handleBulkArchive = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    
    setConfirmBulkArchive(false);
    setBulkArchiveLoading(true);
    
    try {
      const archivedRecords = await bulkArchivePersons(ids, selectedPartnerId);
      setLiveUserLedger((prev) => prev.filter((r) => !selectedIds.has(r.id)));
      setArchivedUserLedger((prev) => {
        const remaining = prev.filter((r) => !selectedIds.has(r.id));
        return [...archivedRecords, ...remaining];
      });
      
      setSelectedIds(new Set());
      showToast(`Archived ${ids.length} record${ids.length === 1 ? '' : 's'} successfully`, 'success');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to bulk archive records', 'error');
    } finally {
      setBulkArchiveLoading(false);
    }
  };

  const [selectedArchivedIds, setSelectedArchivedIds] = useState(new Set());
  const [confirmBulkRestore, setConfirmBulkRestore] = useState(false);
  const [bulkRestoreLoading, setBulkRestoreLoading] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  const handleToggleArchivedSelect = useCallback((id, isSelected) => {
    setSelectedArchivedIds((prev) => {
      const next = new Set(prev);
      if (isSelected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleToggleArchivedSelectAll = useCallback((visibleIds, selectAll) => {
    setSelectedArchivedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (selectAll) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const handleBulkRestore = async () => {
    const ids = Array.from(selectedArchivedIds);
    if (ids.length === 0) return;
    
    setConfirmBulkRestore(false);
    setBulkRestoreLoading(true);
    
    try {
      const restoredRecords = await bulkRestorePersons(ids, selectedPartnerId);
      
      setArchivedUserLedger((prev) => prev.filter((r) => !selectedArchivedIds.has(r.id)));
      setLiveUserLedger((prev) => [...restoredRecords, ...prev]);
      
      setSelectedArchivedIds(new Set());
      showToast(`Restored ${ids.length} record${ids.length === 1 ? '' : 's'} successfully`, 'success');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to bulk restore records', 'error');
    } finally {
      setBulkRestoreLoading(false);
    }
  };

  const handleBulkDelete = async (singleUserId = null) => {
    // If a specific ID is passed, use it (individual delete), otherwise use bulk selection
    const ids = singleUserId ? [singleUserId] : Array.from(selectedArchivedIds);
    if (ids.length === 0) return;
    
    setConfirmBulkDelete(false);
    setBulkDeleteLoading(true);
    
    try {
      await bulkDeletePersons(ids, selectedPartnerId);
      
      // Remove deleted records from the UI immediately
      const idSet = new Set(ids);
      setArchivedUserLedger((prev) => prev.filter((r) => !idSet.has(r.id)));
      
      // Remove them from selection
      if (!singleUserId) {
        setSelectedArchivedIds(new Set());
      } else {
        setSelectedArchivedIds((prev) => {
          const next = new Set(prev);
          next.delete(singleUserId);
          return next;
        });
      }
      
      setDeletingUserId(null);
      showToast(`Permanently deleted ${ids.length} record${ids.length === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to permanently delete records', 'error');
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  useEffect(() => {
    registerDirectoryPageVisit(location.key);
    setHighlightVersion((v) => v + 1);
  }, [location.key]);

  useEffect(() => {
    const cacheKey = selectedPartnerId ? `directory_persons:${selectedPartnerId}` : 'directory_persons';
    const archivedCacheKey = selectedPartnerId ? `directory_persons_archived:${selectedPartnerId}` : 'directory_persons_archived';
    const query = selectedPartnerId ? `?partner_id=${encodeURIComponent(selectedPartnerId)}` : '';

    const applyPersons = (data) => {
      const activeData = Array.isArray(data) ? data : [];
      setLiveUserLedger(activeData);
      setTableLoading(false);
    };

    const applyArchived = (data) => {
      const archivedData = Array.isArray(data) ? data : [];
      setArchivedUserLedger(archivedData);
    };

    const load = () => {
      Promise.all([
        loadWithCache(cacheKey, () => fetchJson(`/api/persons${query}`), applyPersons),
        loadWithCache(archivedCacheKey, () => fetchJson(`/api/persons/archived${query}`), applyArchived)
      ]).catch((err) => {
        console.error(err);
        setTableLoading(false);
      });
    };
    load();
    const refresh = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [selectedPartnerId]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterFirstName, setFilterFirstName] = useState('All');
  const [filterLastName, setFilterLastName] = useState('All');
  const [filterEmail, setFilterEmail] = useState('All');
  const [filterLocation, setFilterLocation] = useState('All');
  const [selectedUser, setSelectedUser] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const selectedUserRef = useRef(selectedUser);
  selectedUserRef.current = selectedUser;
  const [sortPreset, setSortPreset] = useState(DEFAULT_SORT);
  const [filterOpen, setFilterOpen] = useState(true);
  const [dateFilter, setDateFilter] = useState({ type: 'all', value: null });

  const handleSaveEditUser = (updatedUser) => {
    setLiveUserLedger((prev) =>
      prev.map((row) => (row.id === updatedUser.id ? { ...row, ...updatedUser } : row))
    );
    setArchivedUserLedger((prev) =>
      prev.map((row) => (row.id === updatedUser.id ? { ...row, ...updatedUser } : row))
    );
    if (selectedUser?.id === updatedUser.id) {
      setSelectedUser((prev) => ({ ...prev, ...updatedUser }));
    }
  };

  const handleConfirmArchive = async (user) => {
    if (!user) return;
    setArchiveLoading(true);
    try {
      const archived = await archivePerson(user.id, selectedPartnerId);
      setLiveUserLedger((prev) => prev.filter((r) => r.id !== user.id));
      setArchivedUserLedger((prev) => [archived, ...prev.filter((r) => r.id !== user.id)]);
      if (selectedUser?.id === user.id) {
        setSelectedUser(null);
      }
      setArchivingUser(null);
      showToast('Record archived successfully', 'success');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to archive record', 'error');
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleRestoreUser = async (user) => {
    if (!user) return;
    setRestoringUserId(user.id);
    try {
      const restored = await restorePerson(user.id, selectedPartnerId);
      setArchivedUserLedger((prev) => prev.filter((r) => r.id !== user.id));
      setLiveUserLedger((prev) => [restored, ...prev.filter((r) => r.id !== user.id)]);
      if (selectedUser?.id === user.id) {
        setSelectedUser(restored);
      }
      showToast('Record restored to Active Directory', 'success');
      setRestoringUser(null);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to restore record', 'error');
    } finally {
      setRestoringUserId(null);
    }
  };

  const handleStatusTabSwitch = (tab) => {
    setStatusTab(tab);
    setSearchQuery('');
    setFilterFirstName('All');
    setFilterLastName('All');
    setFilterEmail('All');
    setFilterLocation('All');
    setSortPreset(DEFAULT_SORT);
    setFilterOpen(true);
  };

  const prevDirectoryViewRef = useRef(directoryView);
  useEffect(() => {
    if (prevDirectoryViewRef.current === directoryView) return;
    prevDirectoryViewRef.current = directoryView;
    setSearchQuery('');
    setFilterFirstName('All');
    setFilterLastName('All');
    setFilterEmail('All');
    setFilterLocation('All');
    setSelectedIds(new Set());
    setSelectedArchivedIds(new Set());
    setSelectedUser(null);
  }, [directoryView]);

  const currentLedger = directoryView === 'archived' ? archivedUserLedger : liveUserLedger;

  const firstNameOptions = useMemo(
    () => buildFilterOptions(
      [...new Set(currentLedger.map((u) => u.firstName).filter(Boolean))].sort()
    ),
    [currentLedger]
  );

  const lastNameOptions = useMemo(
    () => buildFilterOptions(
      [...new Set(currentLedger.map((u) => u.lastName).filter(Boolean))].sort()
    ),
    [currentLedger]
  );

  const emailOptions = useMemo(
    () => buildFilterOptions(
      [...new Set(currentLedger.map((u) => u.email).filter(Boolean))].sort()
    ),
    [currentLedger]
  );

  const locationOptions = useMemo(
    () => buildFilterOptions(
      [...new Set(currentLedger.map((u) => u.location).filter(Boolean))].sort()
    ),
    [currentLedger]
  );

  const filteredLedger = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const { field, dir } = parseSortPreset(sortPreset);
    const sortDir = dir === 'asc' ? 1 : -1;

    const filtered = currentLedger.filter((user) => {
      const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
      const matchesSearch =
        query === '' ||
        fullName.includes(query) ||
        (user.firstName || '').toLowerCase().includes(query) ||
        (user.lastName || '').toLowerCase().includes(query) ||
        (user.email || '').toLowerCase().includes(query) ||
        (user.location || '').toLowerCase().includes(query);
      const matchesFirstName = filterFirstName === 'All' || user.firstName === filterFirstName;
      const matchesLastName = filterLastName === 'All' || user.lastName === filterLastName;
      const matchesEmail = filterEmail === 'All' || user.email === filterEmail;
      const matchesLocation = filterLocation === 'All' || user.location === filterLocation;
      return matchesSearch && matchesFirstName && matchesLastName && matchesEmail && matchesLocation;
    });

    const bounds = calculateDateBounds(dateFilter.type, dateFilter.value);
    const timeFiltered = filterByDateRange(filtered, (user) => getDirectoryRecordTimestamp(user, directoryView), bounds);

    return [...timeFiltered].sort((a, b) => {
      if (field === 'managerName') return personManagerName(a).localeCompare(personManagerName(b)) * sortDir;
      if (field === 'firstName') {
        const nA = (a.firstName || '').toLowerCase();
        const nB = (b.firstName || '').toLowerCase();
        return nA.localeCompare(nB) * sortDir;
      }
      if (field === 'lastName') {
        const nA = (a.lastName || '').toLowerCase();
        const nB = (b.lastName || '').toLowerCase();
        return nA.localeCompare(nB) * sortDir;
      }
      if (field === 'personEmail') {
        return (a.email || '').localeCompare(b.email || '') * sortDir;
      }
      if (field === 'personLocation') {
        return (a.location || '').localeCompare(b.location || '') * sortDir;
      }
      if (field === 'dateAdded') return (new Date(a.dateAdded) - new Date(b.dateAdded)) * sortDir;
      return (a.displayId - b.displayId) * sortDir;
    });
  }, [currentLedger, searchQuery, filterFirstName, filterLastName, filterEmail, filterLocation, sortPreset, dateFilter.type, dateFilter.value, directoryView]);

  const activeFilterCount = [
    filterFirstName !== 'All',
    filterLastName !== 'All',
    filterEmail !== 'All',
    filterLocation !== 'All',
    dateFilter && dateFilter.type !== 'all'
  ].filter(Boolean).length;

  const handleOpenUser = (row) => {
    clearDirectoryPersonHighlight(row.email);
    setHighlightVersion((v) => v + 1);
    setSelectedUser(row);
  };

  useEffect(() => {
    consumedDirectoryDeepLinkRef.current = null;
  }, [requestIdFromUrl]);

  useLayoutEffect(() => {
    if (!requestIdFromUrl || tableLoading || !liveUserLedger.length) return;

    const row = findLedgerRowForRequestId(liveUserLedger, requestIdFromUrl);
    if (!row) return;

    if (
      consumedDirectoryDeepLinkRef.current === requestIdFromUrl
      && selectedUserRef.current
      && requestIdsMatch(selectedUserRef.current.id, row.id)
    ) {
      return;
    }

    consumedDirectoryDeepLinkRef.current = requestIdFromUrl;
    clearDirectoryPersonHighlight(row.email);
    setHighlightVersion((v) => v + 1);
    setSelectedUser(row);
  }, [requestIdFromUrl, liveUserLedger, tableLoading]);

  const handleExportCSV = () => {
    const headers = ['ID', 'Person Name', 'Person Email', 'Location', 'Date Added', 'Manager Name', 'Manager Email', 'Club', 'Manager notes', 'Admin notes'];
    const csvRows = filteredLedger.map((user) =>
      [
        formatRequestDisplayId(user.displayId),
        `${user.firstName} ${user.lastName}`,
        user.email,
        user.location,
        formatAdminDate(user.dateAdded),
        personManagerName(user),
        user.managerEmail || '',
        user.club,
        readManagerNotes(user),
        personAdminNotes(user),
      ].map(csvCell).join(',')
    );
    const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const scope = directoryView === 'archived' ? 'archived' : 'directory';
    link.setAttribute('download', `${scope}-export.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setConfirmExportOpen(false);
    showToast(
      `Downloaded ${filteredLedger.length} record${filteredLedger.length === 1 ? '' : 's'}.`,
      'success',
    );
  };

  const exportSummary = useMemo(() => {
    const sortLabel = SORT_PRESETS.find((o) => o.value === sortPreset)?.label ?? 'Default';
    const filters = [];
    if (searchQuery.trim()) filters.push({ label: 'Search', value: searchQuery.trim() });
    if (filterFirstName !== 'All') filters.push({ label: 'First name', value: filterFirstName });
    if (filterLastName !== 'All') filters.push({ label: 'Last name', value: filterLastName });
    if (filterEmail !== 'All') filters.push({ label: 'Email', value: filterEmail });
    if (filterLocation !== 'All') filters.push({ label: 'Location', value: filterLocation });
    return {
      scope: directoryView === 'archived' ? 'Archived users' : 'Active Directory',
      sortLabel,
      filters,
      count: filteredLedger.length,
      isFiltered:
        searchQuery.trim() !== ''
        || filterFirstName !== 'All'
        || filterLastName !== 'All'
        || filterEmail !== 'All'
        || filterLocation !== 'All'
        || sortPreset !== DEFAULT_SORT,
    };
  }, [
    directoryView,
    searchQuery,
    filterFirstName,
    filterLastName,
    filterEmail,
    filterLocation,
    sortPreset,
    filteredLedger.length,
  ]);

  const columns = [
    {
      key: 'displayId',
      label: '#',
      width: '3.25rem',
      noShrink: true,
      headerClassName: 'text-center',
      cellClassName: 'text-center align-top whitespace-nowrap px-1',
      render: (val) => (
        <span className="inline-flex h-5 items-center justify-center text-sm font-semibold leading-5 text-[var(--color-text-primary)] whitespace-nowrap tabular-nums">
          {formatRequestDisplayId(val)}
        </span>
      )
    },
    {
      key: 'dateAdded',
      label: 'Added at',
      width: '6.5rem',
      noShrink: true,
      headerClassName: 'text-center',
      cellClassName: 'align-top text-center',
      render: (val) => <TimestampCell val={val} className="items-center" />
    },
    {
      key: 'firstName',
      label: 'First Name',
      width: '10%',
      headerClassName: 'text-center',
      cellClassName: 'align-top text-left max-w-0 overflow-hidden',
      render: (_, row) => {
        const firstName = (row.firstName || '').trim() || EMPTY_CELL;
        return (
          <TruncateCell className="text-sm font-semibold text-[var(--color-text-primary)]" title={firstName}>
            {firstName}
          </TruncateCell>
        );
      },
    },
    {
      key: 'lastName',
      label: 'Last Name',
      width: '10%',
      headerClassName: 'text-center',
      cellClassName: 'align-top text-left max-w-0 overflow-hidden',
      render: (_, row) => {
        const lastName = (row.lastName || '').trim() || EMPTY_CELL;
        return (
          <TruncateCell className="text-sm font-semibold text-[var(--color-text-primary)]" title={lastName}>
            {lastName}
          </TruncateCell>
        );
      },
    },
    {
      key: 'personEmail',
      label: 'Person Email',
      width: '18%',
      headerClassName: 'text-center',
      cellClassName: 'align-top text-left max-w-0 overflow-hidden',
      render: (_, row) => {
        const { email } = formatPersonFields(row);
        return (
          <TruncateCell className="text-sm font-semibold leading-5 text-[var(--color-text-primary)]" title={email}>
            {email}
          </TruncateCell>
        );
      },
    },
    {
      key: 'personLocation',
      label: terms.locationTerm,
      width: terms.isHealthFitness ? '12%' : '14%',
      headerClassName: 'text-center',
      cellClassName: 'align-top text-left max-w-0 overflow-hidden',
      hidden: false,
      render: (_, row) => {
        const { location } = formatPersonFields(row);
        return (
          <TruncateCell className="text-sm font-normal leading-5 text-[var(--color-text-primary)]" title={location}>
            {location}
          </TruncateCell>
        );
      },
    },
    ...(terms.isHealthFitness ? [{
      key: 'director',
      label: 'Director',
      width: '12%',
      headerClassName: 'text-center',
      cellClassName: 'align-top max-w-0 overflow-hidden text-left',
      render: (_, row) => {
        const dFirst = (row.directorFirst || row.person?.directorFirst || '').trim();
        const dLast = (row.directorLast || row.person?.directorLast || '').trim();
        if (!dFirst && !dLast) {
          return <span className="text-xs text-[var(--color-text-muted)]">—</span>;
        }
        return (
          <StackedTextCell
            primary={dFirst || EMPTY_CELL}
            secondary={dLast || EMPTY_CELL}
          />
        );
      },
    }] : []),
    {
      key: 'manager',
      label: terms.managerTerm,
      width: terms.isHealthFitness ? '14%' : terms.isJdGyms ? '15%' : '20%',
      wrap: true,
      headerClassName: 'text-center',
      cellClassName: 'align-top max-w-0 overflow-hidden text-left',
      render: (_, row) => {
        const rawPartnerId = row?.partnerId || row?.partner_id;
        const matchedPartner = partners?.find((p) => String(p.id) === String(rawPartnerId)) || selectedPartner;
        const manager = getDirectoryManagerColumnContent(row, {
          partnerName: row?.partnerName || row?.partner_name || matchedPartner?.name,
          partnerSlug: row?.partnerSlug || row?.partner_slug || matchedPartner?.slug,
        });
        return (
          <StackedTextCell
            primary={manager.primary}
            secondary={manager.secondary || undefined}
            tertiary={manager.tertiary || undefined}
            primaryClassName={manager.muted ? 'font-medium text-[var(--color-text-muted)] italic' : ''}
            truncate={false}
          />
        );
      }
    },
    ...(terms.isJdGyms ? [{
      key: 'role',
      label: 'Role',
      width: '10%',
      headerClassName: 'text-center',
      cellClassName: 'align-top text-left max-w-0 overflow-hidden',
      render: (_, row) => {
        const val = row.role || row.person?.role;
        const trimmed = (val || '').trim();
        if (!trimmed) {
          return <span className="text-sm font-normal leading-5 text-[var(--color-text-muted)]">No role</span>;
        }
        return (
          <TruncateCell className="text-sm font-normal leading-5 text-[var(--color-text-primary)]" title={trimmed}>
            {trimmed}
          </TruncateCell>
        );
      },
    }] : []),
    {
      key: 'open',
      label: 'Actions',
      width: '7.5rem',
      noShrink: true,
      headerClassName: 'text-center',
      cellClassName: 'text-center align-middle whitespace-nowrap px-1.5',
      render: (_, row) => (
        <div className="flex items-center justify-center gap-1.5">
          {directoryView === 'active' ? (
            <>
              <HoverTip label="Edit">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingUser(row);
                  }}
                  className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-brand-primary)] transition-colors"
                  aria-label={`Edit ${row.firstName || 'record'}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </HoverTip>
              <HoverTip label="Archive">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setArchivingUser(row);
                  }}
                  className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition-colors"
                  aria-label={`Archive ${row.firstName || 'record'}`}
                >
                  <Archive className="h-4 w-4" />
                </button>
              </HoverTip>
            </>
          ) : (
            <>
              <HoverTip label="Restore">
                <button
                  type="button"
                  disabled={restoringUserId === row.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRestoringUser(row);
                  }}
                  className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 transition-colors"
                  aria-label={`Restore ${row.firstName || 'record'}`}
                >
                  {restoringUserId === row.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                </button>
              </HoverTip>
              <HoverTip label="Delete permanently">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingUserId(row.id);
                    setConfirmBulkDelete(true);
                  }}
                  className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-red-300 hover:bg-red-50 hover:text-red-700 transition-colors"
                  aria-label={`Permanently Delete ${row.firstName || 'record'}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </HoverTip>
            </>
          )}
          <HoverTip label="Open details">
            <div className="flex items-center justify-center p-1" aria-hidden="true">
              <ArrowRight className="h-4 w-4 text-[var(--color-brand-secondary)]" />
            </div>
          </HoverTip>
        </div>
      )
    }
  ];

  const listResetKey = [directoryView, searchQuery, filterFirstName, filterLastName, filterEmail, filterLocation, sortPreset, dateFilter.type, dateFilter.value].join('|');
  const {
    pageItems,
    page,
    setPage,
    totalPages,
    total,
    pageStart,
    pageEnd,
  } = useClientPagination(filteredLedger, { pageSize: 20, resetKey: listResetKey });

  return (
    <AdminPageScroll>
      <Toast />
      <PageHeader
        section={`${partnerLabel} Support`}
        title={<span className="text-lg sm:text-xl">{directoryView === 'archived' ? 'Archived Users' : 'Active Users'}</span>}
        description={
          directoryView === 'archived'
            ? 'Records removed from the active Directory. Restore them anytime.'
            : 'View and export the record of added and removed partner users.'
        }
        workspace
        actions={
          <>
            {directoryView === 'active' ? (
              <Link
                to="/directory/archived"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border border-[var(--color-border-default)] bg-white text-[var(--color-text-primary)] hover:bg-gray-50 transition-colors shadow-sm cursor-pointer"
              >
                <Archive className="w-4 h-4 text-[var(--color-text-secondary)]" />
                <span>Archive</span>
                <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-md bg-[var(--color-surface-panel)] px-1.5 py-0.5 text-[11px] font-bold tabular-nums leading-none text-[var(--color-text-muted)]">
                  {archivedUserLedger.length}
                </span>
              </Link>
            ) : (
              <Link
                to="/directory"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border border-[var(--color-border-default)] bg-white text-[var(--color-text-primary)] hover:bg-gray-50 transition-colors shadow-sm cursor-pointer"
              >
                <span className="text-[var(--color-brand-primary)]">←</span>
                <span className="text-[var(--color-brand-primary)]">Active Directory</span>
                <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-md bg-[var(--color-brand-primary)]/10 px-1.5 py-0.5 text-[11px] font-bold tabular-nums leading-none text-[var(--color-brand-primary)]">
                  {liveUserLedger.length}
                </span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => setConfirmExportOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
          </>
        }
      />

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && directoryView === 'active' && (
        <div className="flex items-center justify-between bg-white border border-[var(--color-border-default)] shadow-sm rounded-xl px-4 py-3 mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-[var(--color-brand-primary)]">
              {selectedIds.size} selected
            </span>
            <div className="h-4 w-px bg-gray-300" />
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
            >
              Clear selection
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmBulkArchive(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer"
            >
              <Archive className="w-4 h-4" />
              <span>Archive</span>
            </button>
          </div>
        </div>
      )}

      {/* Bulk Restore Toolbar */}
      {selectedArchivedIds.size > 0 && directoryView === 'archived' && (
        <div className="flex items-center justify-between bg-white border border-[var(--color-border-default)] shadow-sm rounded-xl px-4 py-3 mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-[var(--color-brand-primary)]">
              {selectedArchivedIds.size} selected
            </span>
            <div className="h-4 w-px bg-gray-300" />
            <button
              onClick={() => setSelectedArchivedIds(new Set())}
              className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
            >
              Clear selection
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmBulkRestore(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Restore</span>
            </button>
            <button
              onClick={() => {
                setDeletingUserId(null);
                setConfirmBulkDelete(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] transition-colors shadow-sm cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Permanently</span>
            </button>
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <ControlsBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filterOpen={filterOpen}
        setFilterOpen={setFilterOpen}
        activeFilterCount={activeFilterCount}
        dateFilter={dateFilter}
        setDateFilter={setDateFilter}
        filterSlots={[
          {
            label: 'Person First Name',
            value: filterFirstName,
            onChange: setFilterFirstName,
            options: firstNameOptions
          },
          {
            label: 'Person Last Name',
            value: filterLastName,
            onChange: setFilterLastName,
            options: lastNameOptions
          },
          {
            label: 'Person Email',
            value: filterEmail,
            onChange: setFilterEmail,
            options: emailOptions
          },
          {
            label: `User ${terms.locationTerm}`,
            value: filterLocation,
            onChange: setFilterLocation,
            options: locationOptions
          }
        ]}
        sortPresets={SORT_PRESETS}
        sortPreset={sortPreset}
        setSortPreset={setSortPreset}
      />

      {/* Table */}
      <DirectoryMobileList
        rows={pageItems}
        loading={tableLoading}
        emptyMessage={'No users matching your search.'}
        onOpenUser={handleOpenUser}
        onEditUser={directoryView === 'active' ? setEditingUser : null}
        onArchiveUser={directoryView === 'active' ? setArchivingUser : null}
        onRestoreUser={directoryView === 'archived' ? setRestoringUser : null}
        onDeleteUser={directoryView === 'archived' ? (row) => {
          setDeletingUserId(row.id);
          setConfirmBulkDelete(true);
        } : null}
        highlightVersion={highlightVersion}
        getRowClassName={(row) => {
          void highlightVersion;
          return directoryHighlightClass(row);
        }}
      />

      <div className="hidden w-full sm:block">
        <DataTable
          columns={columns.filter((c) => !c.hidden)}
          rows={pageItems}
          onRowClick={handleOpenUser}
          getRowClassName={(row) => {
            void highlightVersion;
            return directoryHighlightClass(row);
          }}
          emptyMessage={'No users matching your search.'}
          compact
          centerHeaders
          accent
          loading={tableLoading}
          selectedIds={directoryView === 'active' ? selectedIds : (directoryView === 'archived' ? selectedArchivedIds : null)}
          onToggleSelect={directoryView === 'active' ? handleToggleSelect : (directoryView === 'archived' ? handleToggleArchivedSelect : null)}
          onToggleSelectAll={directoryView === 'active' ? handleToggleSelectAll : (directoryView === 'archived' ? handleToggleArchivedSelectAll : null)}
        />
      </div>


      <TablePagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageStart={pageStart}
        pageEnd={pageEnd}
        onPageChange={setPage}
        noun="records"
      />

      {/* History Drawer */}
      <Drawer
        isOpen={selectedUser !== null}
        onClose={() => setSelectedUser(null)}
        title={selectedUser ? `${selectedUser.firstName} ${selectedUser.lastName}` : 'User details'}
        hideHeader
      >
        {selectedUser && (() => {
          const rawPartnerId = selectedUser?.partnerId || selectedUser?.partner_id;
          const matchedPartner = partners?.find((p) => String(p.id) === String(rawPartnerId)) || selectedPartner;
          const pName = selectedUser?.partnerName || selectedUser?.partner_name || matchedPartner?.name;
          const pSlug = selectedUser?.partnerSlug || selectedUser?.partner_slug || matchedPartner?.slug;
          const rowTerms = getPartnerTerminology(pName, pSlug);
          const history =
            Array.isArray(selectedUser.requestHistory) && selectedUser.requestHistory.length
              ? selectedUser.requestHistory
              : buildFallbackHistory(selectedUser, rowTerms);
          const { name: fullName, email: personEmail, location: personLocation } = formatPersonFields(selectedUser);
          const manager = getDirectoryManagerColumnContent(selectedUser, { partnerName: pName, partnerSlug: pSlug });
          const nameParts = fullName === 'No name' ? [] : fullName.split(/\s+/).filter(Boolean);
          const initials = (
            nameParts.length >= 2
              ? `${nameParts[0][0] || ''}${nameParts[nameParts.length - 1][0] || ''}`
              : (nameParts[0] || '?').slice(0, 2)
          ).toUpperCase();


          return (
            <div className="space-y-3 text-left select-none">
              <div className="rounded-2xl border border-[var(--color-border-default)] bg-white px-4 py-4 shadow-[0_1px_2px_rgba(26,26,46,0.04)]">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-secondary-muted)] text-sm font-bold tracking-tight text-[var(--color-brand-primary)] ring-1 ring-[var(--color-brand-secondary-border)]/50">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    {rowTerms.isHealthFitness && (
                      <div className="mb-2.5 pb-2 border-b border-[var(--color-border-default)]/60">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand-secondary)]">
                          Director
                        </p>
                        <p className="text-xs font-semibold text-[var(--color-text-primary)]">
                          {(selectedUser.directorFirst || selectedUser.person?.directorFirst || '').trim() || '—'}
                        </p>
                        <p className="text-xs font-semibold text-[var(--color-text-primary)]">
                          {(selectedUser.directorLast || selectedUser.person?.directorLast || '').trim() || '—'}
                        </p>
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <h3 className="min-w-0 flex-1 break-words text-base font-bold leading-snug text-[var(--color-text-primary)]">
                        {fullName}
                      </h3>
                      <div className="flex shrink-0 items-center gap-2 pt-0.5">

                        <div className="flex items-center gap-1.5">
                          {directoryView === 'active' ? (
                            <>
                              <HoverTip label="Edit">
                                <button
                                  type="button"
                                  onClick={() => setEditingUser(selectedUser)}
                                  className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-brand-primary)] transition-colors"
                                  aria-label={`Edit ${fullName}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </HoverTip>
                              <HoverTip label="Archive">
                                <button
                                  type="button"
                                  onClick={() => setArchivingUser(selectedUser)}
                                  className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition-colors"
                                  aria-label={`Archive ${fullName}`}
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                </button>
                              </HoverTip>
                            </>
                          ) : (
                            <HoverTip label="Restore">
                              <button
                                type="button"
                                disabled={restoringUserId === selectedUser.id}
                                onClick={() => setRestoringUser(selectedUser)}
                                className="inline-flex items-center justify-center rounded-md border border-[var(--color-border-default)] bg-white p-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 transition-colors"
                                aria-label={`Restore ${fullName}`}
                              >
                                {restoringUserId === selectedUser.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </HoverTip>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="mt-0.5 break-all font-mono text-xs text-[var(--color-text-secondary)]">
                      {personEmail}
                    </p>
                    <p className="mt-0.5 break-words text-xs text-[var(--color-text-muted)]">
                      {rowTerms.isGll
                        ? ((personLocation || '').trim() || 'No location')
                        : personLocation}
                    </p>
                  </div>
                </div>
                <dl className="mt-4 space-y-2 border-t border-[var(--color-border-default)] pt-3">
                  <DrawerMetaRow label="Request ID" value={formatRequestDisplayId(selectedUser.displayId)} />
                  <DrawerMetaRow label="Handled" value={formatAdminDateTime(selectedUser.dateAdded)} />
                  <DrawerMetaRow label="Handled by" value={personHandledBy(selectedUser)} />
                  {rowTerms.isJdGyms && (
                    <DrawerMetaRow label="Role" value={(selectedUser.role || selectedUser.person?.role || '').trim() || 'No role'} />
                  )}
                </dl>
              </div>

              <DrawerSection title={`${rowTerms.managerTerm} details`}>
                <p className={`text-sm font-semibold ${
                  manager.muted ? 'italic text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'
                }`}>
                  {manager.primary}
                </p>
                <dl className="mt-2.5 space-y-2">
                  {manager.secondary ? (
                    <DrawerMetaRow label="Detail" value={manager.secondary} mono={!manager.muted} />
                  ) : null}
                  {rowTerms.isGll ? (
                    <DrawerMetaRow label="Gym Location" value={(manager.tertiary || '').trim() || 'No location'} />
                  ) : manager.tertiary ? (
                    <DrawerMetaRow label={rowTerms.locationTerm} value={manager.tertiary} />
                  ) : null}
                </dl>
              </DrawerSection>

              <DrawerSection title={`Notes from ${rowTerms.managerTermLower}`}>
                <p
                  className={`text-xs leading-relaxed ${
                    readManagerNotes(selectedUser)
                      ? 'whitespace-pre-wrap text-[var(--color-text-primary)]'
                      : 'italic text-[var(--color-text-muted)]'
                  }`}
                >
                  {formatManagerNotes(selectedUser)}
                </p>
              </DrawerSection>

              <DrawerSection title="Notes by admin">
                <p
                  className={`text-sm leading-normal ${
                    personAdminNotes(selectedUser).trim()
                      ? 'whitespace-pre-wrap text-[var(--color-text-primary)]'
                      : 'italic text-[var(--color-text-muted)]'
                  }`}
                >
                  {formatAdminNotes(selectedUser)}
                </p>
              </DrawerSection>

              <DrawerSection title="Request history">
                {history.length === 0 ? (
                  <p className="text-xs italic text-[var(--color-text-muted)]">No history available.</p>
                ) : (
                  <ol className="relative space-y-0 border-l border-[var(--color-border-default)] pl-5">
                    {history.map((event, index) => {
                      const Icon = historyIcon(event.type);
                      const isLast = index === history.length - 1;
                      const formattedTitle = event.title
                        ? event.title
                            .replace(/^Manager requested/i, `${rowTerms.managerTerm} requested`)
                            .replace(/^Manager request/i, `${rowTerms.managerTerm} request`)
                        : '';
                      const formattedDetail = event.detail
                        ? event.detail
                            .replace(/^Submitted by a manager/i, `Submitted by a ${rowTerms.managerTermLower}`)
                            .replace(/^Submitted by Manager/i, `Submitted by ${rowTerms.managerTerm}`)
                        : null;
                      return (
                        <li key={event.id || `${event.type}-${event.at}-${index}`} className={`relative ${isLast ? '' : 'pb-4'}`}>
                          <span className="absolute -left-[27px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-surface-panel)] text-[var(--color-text-secondary)] ring-2 ring-white">
                            <Icon className="h-3 w-3" aria-hidden="true" />
                          </span>
                          <time className="block text-[11px] font-semibold text-[var(--color-text-muted)]">
                            {event.at ? formatAdminDateTime(event.at) : EMPTY_CELL}
                          </time>
                          <p className="mt-0.5 text-xs font-semibold text-[var(--color-text-primary)]">
                            {formattedTitle}
                          </p>
                          {formattedDetail ? (
                            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                              {formattedDetail}
                            </p>
                          ) : null}
                          {event.displayId != null ? (
                            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                              {formatRequestDisplayId(event.displayId)}
                              {event.action ? ` · ${event.action}` : ''}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </DrawerSection>

              {directoryView === 'active' && (
                <div className="flex items-start gap-2.5 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-panel)] p-4">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                  <span className="text-xs font-semibold leading-normal text-[var(--color-text-secondary)]">
                    This user will trigger a duplicate warning on new {rowTerms.managerTerm} Form submissions.
                  </span>
                </div>
              )}
            </div>
          );
        })()}
      </Drawer>

      {/* Archive Confirmation Modal */}
      {archivingUser && (
        <Modal
          isOpen={Boolean(archivingUser)}
          onClose={() => setArchivingUser(null)}
          title="Archive Directory Record"
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Are you sure you want to archive{' '}
              <strong className="font-semibold text-[var(--color-text-primary)]">
                {archivingUser.firstName} {archivingUser.lastName}
              </strong>
              ?
            </p>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Archiving removes this person from active Directory views and exports.
              Their historical record will be preserved and can be restored anytime from Archived.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setArchivingUser(null)}
                className="rounded-md border border-[var(--color-border-default)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-panel)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiveLoading}
                onClick={() => handleConfirmArchive(archivingUser)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-50"
              >
                {archiveLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Archive className="h-3.5 w-3.5" />
                )}
                <span>Archive Record</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Restore Confirmation Modal */}
      {restoringUser && (
        <Modal
          isOpen={Boolean(restoringUser)}
          onClose={() => !restoringUserId && setRestoringUser(null)}
          title="Restore Directory Record"
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Are you sure you want to restore{' '}
              <strong className="font-semibold text-[var(--color-text-primary)]">
                {restoringUser.firstName} {restoringUser.lastName}
              </strong>
              ?
            </p>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              Restoring moves this person back into the active Directory so they appear in views and exports again.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRestoringUser(null)}
                disabled={Boolean(restoringUserId)}
                className="rounded-md border border-[var(--color-border-default)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-panel)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={restoringUserId === restoringUser.id}
                onClick={() => handleRestoreUser(restoringUser)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-50"
              >
                {restoringUserId === restoringUser.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                <span>Restore Record</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Person Modal */}
      <EditPersonModal
        isOpen={editingUser !== null}
        onClose={() => setEditingUser(null)}
        user={editingUser}
        onSave={handleSaveEditUser}
      />

      {/* ── Confirm Export modal ── */}
      <Modal
        isOpen={confirmExportOpen}
        onClose={() => setConfirmExportOpen(false)}
        confirm
        title="Export CSV"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmExportOpen(false)}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={exportSummary.count === 0}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              Download {exportSummary.count} record{exportSummary.count === 1 ? '' : 's'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          {exportSummary.isFiltered
            ? 'This download uses your current view filters and sort, not the full Directory.'
            : 'This download includes every record in the current Directory view.'}
        </p>
        <dl className="mt-4 space-y-2.5 text-sm">
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[var(--color-text-muted)]">View</dt>
            <dd className="font-semibold text-[var(--color-text-primary)] text-right">{exportSummary.scope}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[var(--color-text-muted)]">Status</dt>
            <dd className="font-semibold text-[var(--color-text-primary)] text-right">{exportSummary.status}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[var(--color-text-muted)]">Sort</dt>
            <dd className="font-semibold text-[var(--color-text-primary)] text-right">{exportSummary.sortLabel}</dd>
          </div>
          {exportSummary.filters.length > 0 ? (
            <div className="border-t border-[var(--color-border-default)] pt-2.5 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                Active filters
              </p>
              {exportSummary.filters.map((filter) => (
                <div key={filter.label} className="flex items-start justify-between gap-4">
                  <dt className="text-[var(--color-text-muted)]">{filter.label}</dt>
                  <dd className="font-semibold text-[var(--color-text-primary)] text-right break-all">{filter.value}</dd>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <dt className="text-[var(--color-text-muted)]">Filters</dt>
              <dd className="font-semibold text-[var(--color-text-primary)] text-right">None</dd>
            </div>
          )}
          <div className="flex items-start justify-between gap-4 border-t border-[var(--color-border-default)] pt-2.5">
            <dt className="text-[var(--color-text-muted)]">Records</dt>
            <dd className="font-bold tabular-nums text-[var(--color-text-primary)] text-right">
              {exportSummary.count}
            </dd>
          </div>
        </dl>
      </Modal>

      {/* ── Confirm Bulk Archive modal ── */}
      <Modal
        isOpen={confirmBulkArchive}
        onClose={() => !bulkArchiveLoading && setConfirmBulkArchive(false)}
        confirm
        title="Confirm bulk archive"
        footer={
          <>
            <button
              onClick={() => setConfirmBulkArchive(false)}
              disabled={bulkArchiveLoading}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkArchive}
              disabled={bulkArchiveLoading}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-50 inline-flex items-center"
            >
              {bulkArchiveLoading ? (
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              ) : null}
              Confirm Archive
            </button>
          </>
        }
      >
        <p>
          Are you sure you want to archive <strong>{selectedIds.size}</strong> selected record{selectedIds.size === 1 ? '' : 's'}?
        </p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          They will be moved to Archived and will no longer appear in the active Directory. You can restore them later if needed.
        </p>
      </Modal>

      {/* ── Confirm Bulk Restore modal ── */}
      <Modal
        isOpen={confirmBulkRestore}
        onClose={() => !bulkRestoreLoading && setConfirmBulkRestore(false)}
        confirm
        title="Confirm bulk restore"
        footer={
          <>
            <button
              onClick={() => setConfirmBulkRestore(false)}
              disabled={bulkRestoreLoading}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkRestore}
              disabled={bulkRestoreLoading}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-50 inline-flex items-center"
            >
              {bulkRestoreLoading ? (
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              ) : null}
              Confirm Restore
            </button>
          </>
        }
      >
        <p>
          Are you sure you want to restore <strong>{selectedArchivedIds.size}</strong> selected record{selectedArchivedIds.size === 1 ? '' : 's'}?
        </p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          They will be moved back to the active Directory.
        </p>
      </Modal>

      {/* ── Confirm Bulk Delete modal ── */}
      <Modal
        isOpen={confirmBulkDelete}
        onClose={() => !bulkDeleteLoading && setConfirmBulkDelete(false)}
        confirm
        title={deletingUserId ? "Delete permanently" : "Delete records permanently"}
        footer={
          <>
            <button
              onClick={() => setConfirmBulkDelete(false)}
              disabled={bulkDeleteLoading}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => handleBulkDelete(deletingUserId)}
              disabled={bulkDeleteLoading}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-50 inline-flex items-center"
            >
              {bulkDeleteLoading ? (
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              ) : null}
              Delete Permanently
            </button>
          </>
        }
      >
        <p>
          {deletingUserId ? (
            <>
              Are you sure you want to permanently delete the record for <strong>{(() => {
                const row = archivedUserLedger.find(r => r.id === deletingUserId);
                return row ? `${row.firstName} ${row.lastName}`.trim() : 'this person';
              })()}</strong>?
            </>
          ) : (
            <>
              Are you sure you want to permanently delete <strong>{selectedArchivedIds.size}</strong> selected record{selectedArchivedIds.size === 1 ? '' : 's'}?
            </>
          )}
        </p>
        <p className="mt-2 text-sm font-medium text-red-600">
          This action cannot be undone.
        </p>
      </Modal>
    </AdminPageScroll>
  );
}
