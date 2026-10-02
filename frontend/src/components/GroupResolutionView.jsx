import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, ChevronDown, Check, Database, Clock, Pencil,
  X, Users, Inbox, Trash2, AlertTriangle, Mail, MapPin,
} from 'lucide-react';
import { Tag, Modal, HoverTip } from './ui';
import { usePartners } from '../context/PartnerContext';
import { getPartnerTerminology } from '../utils/managerAuthBranding';
import { formatAdminDateTime, formatRequestDisplayId } from '../utils/requestDisplayId';
import { getManagerDisplayName, isManualEntry, MANUAL_ENTRY_CLUB } from '../utils/manualEntry';
import { readManagerNotes } from '../utils/managerNotes';
import { fetchJson } from '../utils/api';
import { dismissRequest, getDismissImpact } from '../utils/pilot2Api';
import {
  resolveGroupAdd,
  resolveGroupUpdate,
  resolveGroupKeepExisting,
  unlinkGroupMember,
  resolveGroupDeleteFromDirectory,
  resolveGroupMarkRemoved,
} from '../utils/duplicateGroupApi';
import { matchClassification } from '../utils/duplicateMatch';
import { groupClassificationPills } from '../utils/requestTags';
import {
  formatPersonName,
  formatPersonEmail,
  formatPersonLocation,
} from '../utils/personDisplay';

/* ─── helpers ────────────────────────────────────────────────────────────── */

function dismissCascadeCopy(impact) {
  const confirmed = impact?.confirmedSiblingCount || 0;
  const potential = impact?.potentialSiblingCount || 0;
  if (!confirmed && !potential) return null;
  const parts = [];
  if (confirmed > 0) {
    parts.push(
      confirmed === 1
        ? 'This will also delete 1 confirmed duplicate request.'
        : `This will also delete ${confirmed} confirmed duplicate requests.`,
    );
  }
  if (potential > 0) {
    parts.push(
      potential === 1
        ? 'The related potential duplicate will be kept for review.'
        : `The related potential duplicates (${potential}) will be kept for review.`,
    );
  }
  return parts.join(' ');
}


function initials(person) {
  const parts = [person?.firstName, person?.lastName].filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '?';
}

function managerFieldsFromMember(member) {
  const managerName =
    member?.createdBy
    || getManagerDisplayName(member?.submittedBy, member?.tags, member);
  const managerEmail = (member?.submittedBy?.email || '').trim();
  const clubRaw = (member?.submittedBy?.club || '').trim();
  const managerClub =
    clubRaw && clubRaw !== MANUAL_ENTRY_CLUB && !isManualEntry(member?.submittedBy)
      ? clubRaw
      : (clubRaw === MANUAL_ENTRY_CLUB ? MANUAL_ENTRY_CLUB : '');
  const notesText = readManagerNotes(member);
  return { managerName, managerEmail, managerClub, notesText };
}

function personFullName(person) {
  return [person?.firstName, person?.lastName].filter(Boolean).join(' ') || 'Unknown';
}

/* ─── sub-components (reusing exact patterns from RequestDetailDrawer) ───── */

function MetaItem({ label, value }) {
  if (!value) return null;
  const text = String(value);
  const isPlaceholder = text === '—' || /^No notes$/i.test(text) || /^No role$/i.test(text);
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd
        className={`mt-1 break-words text-sm ${
          isPlaceholder
            ? 'font-normal text-[var(--color-text-muted)]'
            : 'font-semibold text-[var(--color-text-primary)]'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  action,
  children,
  className = '',
  collapsible = false,
  open = true,
  onToggle,
}) {
  const header = (
    <div className="flex min-w-0 items-center gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-[var(--color-brand-secondary)] shadow-[0_1px_0_rgba(26,26,46,0.04)] ring-1 ring-[var(--color-brand-secondary-border)]/45">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <h2 className="text-sm font-semibold tracking-tight text-[var(--color-brand-secondary)]">
        {title}
      </h2>
    </div>
  );

  return (
    <section className={`py-6 ${className}`}>
      <div className="relative overflow-hidden rounded-r-2xl border-l-[3px] border-l-[var(--color-brand-secondary)] bg-gradient-to-br from-white via-white to-[var(--color-surface-bg)] px-4 py-5 shadow-[0_1px_0_rgba(26,26,46,0.04)] sm:px-5">
        <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[var(--color-brand-secondary)]/[0.05]" aria-hidden="true" />
        <div className={`relative flex items-center justify-between ${open || !collapsible ? 'mb-4' : ''}`}>
          {collapsible ? (
            <button
              type="button"
              onClick={onToggle}
              className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left cursor-pointer rounded-lg -mx-1 px-1 py-0.5 hover:bg-white/50 transition-colors"
              aria-expanded={open}
            >
              {header}
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          ) : (
            header
          )}
          {action && !collapsible && <div>{action}</div>}
          {action && collapsible && open && <div className="ml-3 shrink-0">{action}</div>}
        </div>
        {(!collapsible || open) && <div className="relative">{children}</div>}
      </div>
    </section>
  );
}

function classificationTag(classification) {
  if (classification === 'confirmed_duplicate') return { variant: 'duplicate-confirmed', label: 'Duplicate' };
  if (classification === 'potential_duplicate') return { variant: 'duplicate-potential', label: 'Potential Duplicate' };
  if (classification === 'already_exists' || classification === 'already_exists_conflict') return { variant: 'already-exists', label: 'Already Exists' };
  if (classification === 'already_removed' || classification === 'already_removed_conflict') return { variant: 'already-removed', label: 'Already Removed' };
  return { variant: 'neutral', label: classification };
}

const INPUT_CLASS =
  'w-full px-3 py-2 bg-white border border-[var(--color-border-default)] rounded-lg text-sm focus:outline-none focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[rgba(233,69,96,0.08)] transition-all';

const LABEL_CLASS = 'block text-[11px] font-semibold text-[var(--color-text-secondary)] mb-1';

const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-primary)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer';

const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--color-border-default)] text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-highlight)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer';

/* ─── main export ────────────────────────────────────────────────────────── */

export default function GroupResolutionView({
  group,
  directory = [],
  onResolved,
}) {
  const repMember = group.members.find((m) => m.isRepresentative) || group.members[0];
  const hasDirectory = Boolean(group.directoryPersonId);

  // Find Directory person for Section A (prefer attached directoryPerson from backend)
  const dirPerson =
    group.directoryPerson ||
    (hasDirectory
      ? directory.find((d) => d.id === group.directoryPersonId) ||
      directory.find(
        (d) =>
          (d.email || '').toLowerCase() ===
          (repMember?.person?.email || '').toLowerCase(),
      )
      : null);

  const { selectedPartner, partners } = usePartners();
  const rawPartnerId = group?.partnerId || group?.partner_id || repMember?.partnerId || repMember?.partner_id;
  const matchedPartner = partners?.find((p) => String(p.id) === String(rawPartnerId)) || selectedPartner;

  const partnerName = group?.partnerName || group?.partner_name || repMember?.partnerName || repMember?.partner_name || matchedPartner?.name;
  const partnerSlug = group?.partnerSlug || group?.partner_slug || repMember?.partnerSlug || repMember?.partner_slug || rawPartnerId || matchedPartner?.slug;

  const terms = getPartnerTerminology(partnerName, partnerSlug);
  const isHealthFitness = terms.isHealthFitness;
  const isGll = terms.isGll;
  const managerTerm = terms.managerTerm;
  const locationTerm = terms.locationTerm;

  // Final values form state — pre-filled from representative
  const [form, setForm] = useState({
    firstName: repMember?.person?.firstName || repMember?.firstName || '',
    lastName: repMember?.person?.lastName || repMember?.lastName || '',
    email: repMember?.person?.email || repMember?.email || '',
    location: repMember?.person?.location || repMember?.location || '',
    role: repMember?.person?.role || repMember?.role || '',
    directorFirst: repMember?.directorFirst || repMember?.person?.directorFirst || '',
    directorLast: repMember?.directorLast || repMember?.person?.directorLast || '',
  });
  const [isEditing, setIsEditing] = useState(false);
  const [draftForm, setDraftForm] = useState(form);
  const [unlinkTargetId, setUnlinkTargetId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteImpact, setDeleteImpact] = useState(null);
  const [deleteImpactLoadingId, setDeleteImpactLoadingId] = useState(null);

  const [unlinkStep, setUnlinkStep] = useState(null);
  const [unlinkActionType, setUnlinkActionType] = useState(null);
  const [unlinkForm, setUnlinkForm] = useState(null);
  const [unlinkDraft, setUnlinkDraft] = useState(null);
  const [unlinkEditing, setUnlinkEditing] = useState(false);

  const [adminNote, setAdminNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Members list — keep unlinked rows visible for this visit only so the admin
  // can still treat them as current requests here. Remount reloads normal UI.
  const [members, setMembers] = useState(group.members);
  const [sessionUnlinkedIds, setSessionUnlinkedIds] = useState([]);
  const [unlinkedNotes, setUnlinkedNotes] = useState({});
  const [valuesOpen, setValuesOpen] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [mergePageOpen, setMergePageOpen] = useState(false);

  // Keep confirmation + merge-page values
  const [confirmAction, setConfirmAction] = useState(null); // 'keep' | 'merge' | null
  const [markUnlinkedTarget, setMarkUnlinkedTarget] = useState(null);
  const [modalValues, setModalValues] = useState(null);
  const [mergeEditing, setMergeEditing] = useState(false);


  const openUnlinkModal = (member) => {
    setUnlinkTargetId(member.id);
    setUnlinkStep('review');
    setUnlinkActionType(null);
    const info = member.person || {};
    const initForm = {
      firstName: info.firstName || '',
      lastName: info.lastName || '',
      email: info.email || '',
      location: info.location || '',
      directorFirst: member.directorFirst || info.directorFirst || '',
      directorLast: member.directorLast || info.directorLast || '',
    };
    setUnlinkForm(initForm);
    setUnlinkDraft(initForm);
    setUnlinkEditing(false);
  };

  const updateDraftField = (field, value) => setDraftForm((f) => ({ ...f, [field]: value }));

  const handleEditClick = () => {
    setDraftForm(form);
    setIsEditing(true);
    setValuesOpen(true);
  };

  const handleSaveClick = () => {
    if (!draftForm.firstName.trim() || !draftForm.lastName.trim()) return;
    setForm(draftForm);
    setIsEditing(false);
  };

  const isFormValid = form.firstName.trim() && form.lastName.trim();

  const closeConfirmModal = () => {
    setConfirmAction(null);
    setMergeEditing(false);
  };

  const startMergeEdit = () => {
    setDraftForm(form);
    setMergeEditing(true);
  };

  const saveMergeEdit = () => {
    if (!draftForm.firstName.trim() || !draftForm.lastName.trim()) return;
    setForm(draftForm);
    setModalValues({ ...draftForm });
    setMergeEditing(false);
  };

  const closeMergePage = () => {
    setMergePageOpen(false);
    setModalValues(null);
  };

  /* ── keep existing — open confirm (Case C) ── */
  const openKeepConfirm = () => {
    if (submitting) return;
    setConfirmAction('keep');
  };

  /* ── open the Request History page (timeline + Merge) ── */
  const openHistoryPage = () => {
    if (submitting) return;
    setHistoryExpanded(true);
    setMergePageOpen(true);
  };

  const openMergePage = () => {
    if (submitting) return;
    setHistoryExpanded(true);
    setValuesOpen(true);
    setModalValues({ ...form });
    setMergePageOpen(true);
  };

  const openMergeConfirm = () => {
    if (!isFormValid || submitting) return;
    setModalValues({ ...form });
    setDraftForm({ ...form });
    setConfirmAction('merge');
  };

  const handleConfirmMerge = async () => {
    const values = isEditing ? draftForm : (modalValues || form);
    if (currentRep?.action === 'Remove') {
      await handleResolveRemove(values);
      return;
    }
    if (hasDirectory) {
      await handleConfirmUpdate(values);
    } else {
      await handleResolveAdd(values);
    }
  };

  /* Current request = newest active member (the card Merge is clicked on). */
  const currentSourceRequestId = (() => {
    const active = members.filter((m) => !sessionUnlinkedIds.includes(m.id));
    const current = [...active].sort(
      (a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0),
    )[0];
    return current?.id || group.representativeRequestId || repMember?.id || null;
  })();

  /* ── resolve & remove (Grouped Remove) ── */
  const handleResolveRemove = async (values = form) => {
    if (!values.firstName.trim() || !values.lastName.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (hasDirectory) {
        await resolveGroupDeleteFromDirectory(group.id, {
          directoryPersonId: group.directoryPersonId,
          finalValues: {
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim(),
            email: (values.email || '').trim(),
            location: (values.location || '').trim(),
            role: (values.role || '').trim() || null,
            directorFirst: (values.directorFirst || '').trim() || null,
            directorLast: (values.directorLast || '').trim() || null,
          },
          adminNote: adminNote.trim() || null,
          sourceRequestId: currentSourceRequestId,
        });
      } else {
        await resolveGroupMarkRemoved(group.id, {
          finalValues: {
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim(),
            email: (values.email || '').trim(),
            location: (values.location || '').trim(),
            role: (values.role || '').trim() || null,
            directorFirst: (values.directorFirst || '').trim() || null,
            directorLast: (values.directorLast || '').trim() || null,
          },
          adminNote: adminNote.trim() || null,
          sourceRequestId: currentSourceRequestId,
        });
      }
      closeConfirmModal();
      closeMergePage();
      onResolved('remove_group', personFullName(values));
    } catch (err) {
      onResolved('error', err.message || 'Failed to remove group.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── resolve & add (Case A) ── */
  const handleResolveAdd = async (values = form) => {
    if (!values.firstName.trim() || !values.lastName.trim() || submitting) return;
    setSubmitting(true);
    try {
      await resolveGroupAdd(group.id, {
        finalValues: {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          email: (values.email || '').trim(),
          location: (values.location || '').trim(),
          role: (values.role || '').trim() || null,
          directorFirst: (values.directorFirst || '').trim() || null,
          directorLast: (values.directorLast || '').trim() || null,
        },
        adminNote: adminNote.trim() || null,
        sourceRequestId: currentSourceRequestId,
      });
      closeConfirmModal();
      closeMergePage();
      onResolved('add', personFullName(values));
    } catch (err) {
      onResolved('error', err.message || 'Failed to resolve group.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── resolve & update (Case B) ── */
  const handleConfirmUpdate = async (values = form) => {
    if (submitting) return;
    if (!values.firstName.trim() || !values.lastName.trim()) return;
    setSubmitting(true);
    try {
      await resolveGroupUpdate(group.id, {
        directoryPersonId: group.directoryPersonId,
        finalValues: {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          email: (values.email || '').trim(),
          location: (values.location || '').trim(),
          role: (values.role || '').trim() || null,
          directorFirst: (values.directorFirst || '').trim() || null,
          directorLast: (values.directorLast || '').trim() || null,
        },
        adminNote: adminNote.trim() || null,
        sourceRequestId: currentSourceRequestId,
      });
      closeConfirmModal();
      closeMergePage();
      onResolved('update', personFullName(values));
    } catch (err) {
      onResolved('error', err.message || 'Failed to update Directory.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── resolve — keep existing (Case C) ── */
  const handleKeepExisting = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await resolveGroupKeepExisting(group.id, {
        adminNote: adminNote.trim() || null,
      });
      closeConfirmModal();
      onResolved('keep', null);
    } catch (err) {
      onResolved('error', err.message || 'Failed to resolve group.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── unlink member ── */
  const handleUnlink = async (memberId, actionType, finalValues) => {
    const active = members.filter((m) => !sessionUnlinkedIds.includes(m.id));
    const current = [...active].sort(
      (a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0),
    )[0] || null;
    let peer = null;
    if (current && memberId === current.id) {
      peer = active.find(
        (m) =>
          m.id !== memberId
          && matchClassification(current.person, m.person, { isGll }) !== 'confirmed_duplicate',
      );
    } else if (current && current.id !== memberId) {
      peer = current;
    }
    if (!peer) {
      peer =
        active.find((m) => m.id !== memberId)
        || members.find((m) => m.id !== memberId);
    }
    const requestId1 = peer?.id || group.representativeRequestId || repMember?.id;
    if (!requestId1 || requestId1 === memberId) {
      onResolved('error', 'Need another request in the group to unlink against.');
      return;
    }
    setSubmitting(true);
    try {
      await unlinkGroupMember(group.id, {
        requestId1,
        requestId2: memberId,
        strictSingle: true,
      });

      if (actionType === 'directory' || actionType === 'remove') {
        await fetchJson(`/api/admin/requests/${encodeURIComponent(memberId)}/mark-handled`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminNote: null, finalValues }),
        });
        const nextMembers = members.filter((m) => m.id !== memberId);
        setMembers(nextMembers);
        onResolved(
          actionType === 'directory' ? 'unlinked_added_directory' : 'unlinked_removed_directory',
          personFullName(finalValues)
        );
      } else {
        const nextMembers = members.filter((m) => m.id !== memberId);
        setMembers(nextMembers);
        onResolved('unlinked_new_requests', null);
      }
    } catch (err) {
      onResolved('error', err.message || 'Failed to unlink request.');
    } finally {
      setSubmitting(false);
    }
  };

  const openDeleteConfirm = async (member) => {
    if (!member || deleteImpactLoadingId) return;
    setDeleteImpactLoadingId(member.id);
    try {
      const impact = await getDismissImpact(member.id);
      setDeleteImpact(impact);
    } catch {
      setDeleteImpact(null);
    } finally {
      setDeleteImpactLoadingId(null);
    }
    setDeleteTarget(member);
  };

  /* ── delete member (same dismiss API as New Requests) ── */
  const handleDeleteMember = async () => {
    const member = deleteTarget;
    if (!member || submitting) return;
    setSubmitting(true);
    const alsoIds = new Set(deleteImpact?.confirmedSiblingIds || []);
    try {
      await dismissRequest(member.id);
      const nextMembers = members.filter(
        (m) => m.id !== member.id && !alsoIds.has(m.id),
      );
      const nextUnlinked = sessionUnlinkedIds.filter(
        (id) => id !== member.id && !alsoIds.has(id),
      );
      setMembers(nextMembers);
      setSessionUnlinkedIds(nextUnlinked);
      setDeleteTarget(null);
      setDeleteImpact(null);
      if (nextMembers.length === 0 || (nextMembers.length === 1 && !hasDirectory)) {
        onResolved('member_deleted_done', personFullName(member.person));
      } else {
        onResolved('member_deleted', personFullName(member.person));
      }
    } catch (err) {
      onResolved('error', err.message || 'Failed to delete request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkUnlinked = async () => {
    const member = markUnlinkedTarget;
    if (!member || submitting) return;
    setSubmitting(true);
    const note = (unlinkedNotes[member.id] || '').trim();
    try {
      await fetchJson(`/api/admin/requests/${encodeURIComponent(member.id)}/mark-handled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNote: note || null }),
      });
      const nextMembers = members.filter((m) => m.id !== member.id);
      const nextUnlinked = sessionUnlinkedIds.filter((id) => id !== member.id);
      setMembers(nextMembers);
      setSessionUnlinkedIds(nextUnlinked);
      setMarkUnlinkedTarget(null);
      setUnlinkedNotes((prev) => {
        const next = { ...prev };
        delete next[member.id];
        return next;
      });
      if (nextMembers.length === 0 || (nextMembers.length === 1 && !hasDirectory)) {
        onResolved('unlinked_handled_done', personFullName(member.person));
      } else {
        onResolved('unlinked_handled', personFullName(member.person));
      }
    } catch (err) {
      onResolved('error', err.message || 'Failed to mark request as handled.');
    } finally {
      setSubmitting(false);
    }
  };

  const isSessionUnlinked = (id) => sessionUnlinkedIds.includes(id);
  const activeMembers = members.filter((m) => !isSessionUnlinked(m.id));
  const unlinkedMembers = members.filter((m) => isSessionUnlinked(m.id));
  // After a dissolve unlink, every row is session-unlinked — hide group merge.
  const canStillMerge = activeMembers.length > 0;

  const tag = classificationTag(group.classification);
  const currentRequest = [...activeMembers].sort(
    (a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0),
  )[0] || null;
  const currentRep = currentRequest || repMember;

  const isAlreadyExistsOrRemoved =
    group.classification?.startsWith('already_') ||
    group.classification === 'already_exists' ||
    group.classification === 'already_exists_conflict' ||
    group.classification === 'already_removed' ||
    group.classification === 'already_removed_conflict' ||
    (group.classificationSummary && (
      (group.classificationSummary.already_exists || 0) > 0 ||
      (group.classificationSummary.already_removed || 0) > 0
    ));

  const heroPersonSource = (isAlreadyExistsOrRemoved && dirPerson)
    ? dirPerson
    : currentRep?.person;

  const heroName = formatPersonName(heroPersonSource, { empty: formatPersonName(currentRep?.person) });
  const heroEmail = formatPersonEmail(heroPersonSource, { empty: formatPersonEmail(currentRep?.person, { empty: '' }) });
  const heroLocation = formatPersonLocation(heroPersonSource, { empty: formatPersonLocation(currentRep?.person, { empty: '' }) });

  const personName = heroName;
  const currentManager = managerFieldsFromMember(currentRequest);

  const renderUnlinkedOneVisitNotice = () => (
    <div
      className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
      role="note"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
      <p className="leading-relaxed">
        This separate request is a <span className="font-semibold">one-visit view only</span>.
        If you go back to New Requests, it will move to its own separate request and can be
        handled by opening it separately.
      </p>
    </div>
  );

  const renderUnlinkedCurrentActions = (member) => {
    const isAdd = member.action === 'Add';
    const actionLabel = isAdd ? 'Add User' : 'Remove User';
    return (
      <div className="mt-5 border-t border-[var(--color-border-default)] pt-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {actionLabel}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            Confirm only after you’ve {isAdd ? 'added' : 'removed'}{' '}
            {personFullName(member.person)} in Power Music.
          </p>
        </div>
        <label className="block w-full">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Admin note <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <textarea
            value={unlinkedNotes[member.id] || ''}
            onChange={(e) => setUnlinkedNotes((prev) => ({ ...prev, [member.id]: e.target.value }))}
            placeholder="Saved with the directory record"
            rows={2}
            className="mt-2 w-full resize-none rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-brand-secondary)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-secondary)]/15"
          />
        </label>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={submitting}
            onClick={() => setMarkUnlinkedTarget(member)}
            className={BTN_PRIMARY}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {actionLabel}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="relative z-0 min-w-0 w-full bg-[var(--color-surface-bg)] pb-16 select-none">

      {/* ── breadcrumb ── */}
      <nav aria-label="Breadcrumb" className="mb-8 flex w-full flex-wrap items-center gap-x-3 gap-y-2">
        <HoverTip label="Back to New Requests">
          <Link
            to="/new-requests"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-highlight)] hover:text-[var(--color-text-primary)]"
            aria-label="Back to New Requests"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </HoverTip>
        <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
          <li>
            <Link
              to="/new-requests"
              className="font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              New Requests
            </Link>
          </li>
          <li aria-hidden="true" className="text-[var(--color-text-muted)]">
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li aria-current="page" className="min-w-0 truncate font-medium text-[var(--color-text-primary)]">
            {personName}
          </li>
        </ol>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="mr-1.5 hidden h-4 w-px shrink-0 self-center bg-[var(--color-border-default)] sm:block" aria-hidden="true" />
          {/* Aggregated classification pills — prefer classificationSummary, fall back to single tag */}
          {(() => {
            const summary = group.classificationSummary;
            const pills = groupClassificationPills(summary);
            if (pills.length > 0) {
              return pills.map((pill) => (
                <Tag
                  key={pill.label}
                  variant={pill.variant}
                  label={pill.count != null ? `${pill.label} × ${pill.count}` : pill.label}
                  prefix={pill.prefix}
                />
              ));
            }
            // Fallback for older API responses without classificationSummary
            return <Tag variant={tag.variant} label={tag.label} />;
          })()}
        </div>
      </nav>

      {/* ── header card ── */}
      <header className="relative z-[1]">
        <div className="rounded-2xl border border-[var(--color-border-default)] bg-white px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex items-start gap-4 sm:gap-5">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-surface-bg)] text-lg font-semibold tracking-tight text-[var(--color-brand-secondary)] ring-1 ring-[var(--color-border-default)] sm:h-16 sm:w-16 sm:text-xl"
              aria-hidden="true"
            >
              {initials(heroPersonSource)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold leading-tight tracking-tight text-[var(--color-text-primary)] sm:text-[1.75rem]">
                    {heroName}
                  </h1>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-text-secondary)]">
                    {heroEmail ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate font-mono text-[13px] text-[var(--color-text-primary)]">
                          {heroEmail}
                        </span>
                      </span>
                    ) : null}
                    {heroEmail && heroLocation ? (
                      <span className="text-[var(--color-border-default)]" aria-hidden="true">·</span>
                    ) : null}
                    {heroLocation ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="text-[var(--color-text-primary)]">{heroLocation}</span>
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Tag
                    variant={currentRep?.action === 'Add' ? 'add-action' : 'remove-action'}
                    label={currentRep?.action === 'Add' ? 'Add person' : 'Remove person'}
                  />
                  <Users className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
                  <span className="text-sm text-[var(--color-text-secondary)]">
                    Duplicate exists
                  </span>
                </div>
              </div>
              <div className="mt-4 border-t border-[var(--color-border-default)] pt-4">
                {currentRep?.receivedAt && (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Received {formatAdminDateTime(currentRep.receivedAt)}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {unlinkedMembers.length > 0 ? (
        <div className="mt-4">
          {renderUnlinkedOneVisitNotice()}
        </div>
      ) : null}

      {mergePageOpen ? (
        <SectionCard
          icon={Clock}
          title={`Request History (${members.length})`}
          action={
            <button
              type="button"
              onClick={closeMergePage}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand-primary)] transition-colors hover:text-[var(--color-surface-sidebar-hover)] cursor-pointer"
            >
              ← Back to Current Request
            </button>
          }
        >
          <div className="space-y-4">
            {(() => {
              const sortedByNewest = [...members].sort(
                (a, b) => new Date(b.receivedAt) - new Date(a.receivedAt),
              );
              const latestId = sortedByNewest[0]?.id || null;
              const historyCollapsible = members.length > 2;
              const hiddenCount = sortedByNewest.length - 2;
              const visibleMembers =
                historyCollapsible && !historyExpanded
                  ? sortedByNewest.slice(0, 2)
                  : sortedByNewest;

              return (
                <div className="space-y-4">
                  {visibleMembers.map((member) => {
                    const isLatest = member.id === latestId;
                    const unlinked = isSessionUnlinked(member.id);
                    // Tags stay normal (Current request / Older). Unlinked only unlocks
                    // standalone mark-handled actions for this visit.
                    const role = isLatest
                      ? { variant: 'new-person', label: 'Current request' }
                      : { variant: 'neutral', label: 'Older' };
                    // Unlink only on older rows that are potential matches vs current.
                    const vsCurrent = currentRequest && member.id !== currentRequest.id
                      ? matchClassification(currentRequest.person, member.person, { isGll })
                      : null;
                    const showUnlink = (
                      !unlinked
                      && !isLatest
                      && activeMembers.length > 1
                      && vsCurrent === 'potential_duplicate'
                    );
                    const {
                      managerName,
                      managerEmail,
                      managerClub,
                      notesText,
                    } = managerFieldsFromMember(member);
                    return (
                      <div key={member.id} className="relative">
                        <div
                          className={`rounded-xl border bg-white px-4 py-3.5 ${isLatest
                            ? 'border-[var(--color-surface-sidebar)] ring-2 ring-[var(--color-surface-sidebar)]/20'
                            : 'border-[var(--color-border-default)]'
                            }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold tabular-nums text-[var(--color-text-muted)]">
                                {formatRequestDisplayId(member.displayId)}
                              </span>
                              <Tag
                                variant={member.action === 'Add' ? 'add-action' : 'remove-action'}
                                label={member.action}
                              />
                              <Tag variant={role.variant} label={role.label} />
                            </div>
                            {!unlinked ? (
                              <div className="flex shrink-0 items-center gap-2">
                                {showUnlink ? (
                                  <button
                                    type="button"
                                    onClick={() => openUnlinkModal(member)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-default)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] shadow-[0_1px_0_rgba(26,26,46,0.04)] transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                                  >
                                    <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    Not the same person
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={deleteImpactLoadingId === member.id}
                                  onClick={() => openDeleteConfirm(member)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-600 shadow-[0_1px_0_rgba(26,26,46,0.04)] transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 cursor-pointer disabled:opacity-60"
                                >
                                  <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  {deleteImpactLoadingId === member.id ? 'Loading…' : 'Delete'}
                                </button>
                              </div>
                            ) : null}
                          </div>

                          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                            <MetaItem label="First Name" value={member.person?.firstName || '—'} />
                            <MetaItem label="Last Name" value={member.person?.lastName || '—'} />
                            <MetaItem label="Email" value={member.person?.email || '—'} />
                            <MetaItem label={locationTerm} value={(member.person?.location || '').trim() || 'No location'} />
                            {isHealthFitness && (
                              <>
                                <MetaItem label="Director First Name" value={member.directorFirst || member.person?.directorFirst || '—'} />
                                <MetaItem label="Director Last Name" value={member.directorLast || member.person?.directorLast || '—'} />
                              </>
                            )}

                            <MetaItem label={`${managerTerm} name`} value={managerName || '—'} />
                             <MetaItem label={`${managerTerm} email`} value={managerEmail || '—'} />
                             <MetaItem label={`${managerTerm} ${terms.locationTermLower}`} value={isGll ? ((managerClub || '').trim() || 'No location') : (managerClub || '—')} />
                            <MetaItem label={`${managerTerm} notes`} value={notesText || 'No notes'} />
                            {(!isGll && (terms.isJdGyms || Boolean(member.role || member.person?.role))) && (
                              <MetaItem label="Role" value={(member.role || member.person?.role || '').trim() || 'No role'} />
                            )}
                          </dl>

                          {member.receivedAt && (
                            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                              Received {formatAdminDateTime(member.receivedAt)}
                            </p>
                          )}

                          {unlinked ? (
                            <div className="mt-3">
                              {renderUnlinkedOneVisitNotice()}
                            </div>
                          ) : null}

                          {unlinked ? renderUnlinkedCurrentActions(member) : null}
                        </div>
                      </div>
                    );
                  })}

                  {historyCollapsible && (
                    <button
                      type="button"
                      onClick={() => setHistoryExpanded((open) => !open)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--color-border-default)] bg-white/70 px-3 py-2.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-brand-secondary-border)] hover:bg-[var(--color-surface-highlight)] hover:text-[var(--color-brand-secondary)] transition-colors cursor-pointer"
                      aria-expanded={historyExpanded}
                    >
                      {historyExpanded
                        ? 'Show less'
                        : `View ${hiddenCount} more request${hiddenCount === 1 ? '' : 's'}`}
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${historyExpanded ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
              );
            })()}
          </div>

          {canStillMerge ? (
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                disabled={submitting || !isFormValid || isEditing}
                onClick={() => {
                  setModalValues({ ...form });
                  setDraftForm({ ...form });
                  setConfirmAction('merge');
                }}
                className={BTN_PRIMARY}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                {submitting ? 'Merging…' : 'Merge'}
              </button>
            </div>
          ) : null}
        </SectionCard>
      ) : (
        <>
      {/* ── Section A: Current Directory Record (only if already_exists) ── */}
      {hasDirectory && (
        <SectionCard icon={Database} title="Current Directory Record">
          {dirPerson ? (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-8">
              <MetaItem label="First Name" value={dirPerson.firstName} />
              <MetaItem label="Last Name" value={dirPerson.lastName} />
              <MetaItem label="Email" value={dirPerson.email} />
              <MetaItem label={isGll ? 'Gym Location' : (isHealthFitness ? 'Client' : 'Location')} value={(dirPerson.location || '').trim() || 'No location'} />
              {isHealthFitness && (
                <>
                  <MetaItem label="Director First Name" value={dirPerson.directorFirst || dirPerson.person?.directorFirst || '—'} />
                  <MetaItem label="Director Last Name" value={dirPerson.directorLast || dirPerson.person?.directorLast || '—'} />
                </>
              )}
              {(!isGll && (terms.isJdGyms || Boolean(dirPerson.role || dirPerson.person?.role))) && (
                <MetaItem label="Role" value={(dirPerson.role || dirPerson.person?.role || '').trim() || 'No role'} />
              )}
              {dirPerson.status && <MetaItem label="Status" value={dirPerson.status} />}
            </dl>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)] italic">
              Directory record details not available locally. Values shown in the confirmation step.
            </p>
          )}
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">
            This is the existing Directory record. Keep leaves it unchanged; Merge opens history so you can review and update it with final values.
          </p>
        </SectionCard>
      )}

      {/* ── New Request (active group current) ── */}
      {currentRequest && (
        <SectionCard
          icon={Inbox}
          title="New Request"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold tabular-nums text-[var(--color-text-muted)]">
              {formatRequestDisplayId(currentRequest.displayId)}
            </span>
            <Tag
              variant={currentRequest.action === 'Add' ? 'add-action' : 'remove-action'}
              label={currentRequest.action}
            />
            <Tag variant="new-person" label="Current request" />
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <MetaItem label="First Name" value={currentRequest.person?.firstName} />
            <MetaItem label="Last Name" value={currentRequest.person?.lastName} />
            <MetaItem label="Email" value={currentRequest.person?.email} />
            <MetaItem label={isGll ? 'Gym Location' : locationTerm} value={(currentRequest.person?.location || '').trim() || 'No location'} />
            {isHealthFitness && (
              <>
                <MetaItem label="Director First Name" value={currentRequest.directorFirst || currentRequest.person?.directorFirst || '—'} />
                <MetaItem label="Director Last Name" value={currentRequest.directorLast || currentRequest.person?.directorLast || '—'} />
              </>
            )}
            <MetaItem label={`${managerTerm} name`} value={currentManager.managerName} />
            <MetaItem label={`${managerTerm} email`} value={currentManager.managerEmail} />
            <MetaItem label={`${managerTerm} ${terms.locationTermLower}`} value={isGll ? ((currentManager.managerClub || '').trim() || 'No location') : (currentManager.managerClub || '—')} />
            <MetaItem label={`${managerTerm} notes`} value={currentManager.notesText || 'No notes'} />
            {(!isGll && (terms.isJdGyms || Boolean(currentRequest.role || currentRequest.person?.role))) && (
              <MetaItem label="Role" value={(currentRequest.role || currentRequest.person?.role || '').trim() || 'No role'} />
            )}
          </dl>

          {currentRequest.receivedAt && (
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Received {formatAdminDateTime(currentRequest.receivedAt)}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-default)] pt-4">
            {members.length > 1 ? (
              <button
                type="button"
                onClick={openHistoryPage}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--color-text-primary)] shadow-[0_1px_0_rgba(26,26,46,0.04)] transition-colors hover:bg-[var(--color-surface-highlight)] hover:border-[var(--color-brand-secondary-border)] hover:text-[var(--color-brand-secondary)] cursor-pointer"
              >
                <Clock className="h-4 w-4 shrink-0 text-[var(--color-brand-secondary)]" aria-hidden="true" />
                Previous Requests
              </button>
            ) : null}

            {canStillMerge ? (
              <div className="flex flex-wrap items-center justify-end gap-3 ml-auto">
                {hasDirectory && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={openKeepConfirm}
                    className={BTN_SECONDARY}
                  >
                    Keep Existing and Delete New Request{members.length > 1 ? 's' : ''}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!isFormValid || submitting || isEditing}
                  onClick={openMergeConfirm}
                  className={BTN_PRIMARY}
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {members.length === 1
                    ? (currentRep?.action === 'Remove' ? 'Remove and Update Directory' : 'Add and Update Directory')
                    : (hasDirectory ? 'Merge and Update Directory' : (currentRep?.action === 'Remove' ? 'Merge and Remove' : 'Merge & Add to Directory'))}
                </button>
              </div>
            ) : null}
          </div>
        </SectionCard>
      )}

      {/* ── Unlinked requests — mark-handled UI for this visit only ── */}
      {unlinkedMembers.map((member) => {
        const mgr = managerFieldsFromMember(member);
        const isLatestUnlinked = !members.some(
          (m) => m.id !== member.id && new Date(m.receivedAt || 0) > new Date(member.receivedAt || 0),
        );
        return (
          <SectionCard
            key={`unlinked-${member.id}`}
            icon={Inbox}
            title="New Request"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold tabular-nums text-[var(--color-text-muted)]">
                {formatRequestDisplayId(member.displayId)}
              </span>
              <Tag
                variant={member.action === 'Add' ? 'add-action' : 'remove-action'}
                label={member.action}
              />
              <Tag
                variant={isLatestUnlinked ? 'new-person' : 'neutral'}
                label={isLatestUnlinked ? 'Current request' : 'Older'}
              />
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <MetaItem label="First Name" value={member.person?.firstName} />
              <MetaItem label="Last Name" value={member.person?.lastName} />
              <MetaItem label="Email" value={member.person?.email} />
              <MetaItem label={isGll ? 'Gym Location' : locationTerm} value={(member.person?.location || '').trim() || 'No location'} />
              <MetaItem label={`${managerTerm} name`} value={mgr.managerName} />
              <MetaItem label={`${managerTerm} email`} value={mgr.managerEmail} />
              <MetaItem label={`${managerTerm} ${terms.locationTermLower}`} value={isGll ? ((mgr.managerClub || '').trim() || 'No location') : (mgr.managerClub || '—')} />
              <MetaItem label={`${managerTerm} notes`} value={mgr.notesText || 'No notes'} />
              {(!isGll && (terms.isJdGyms || Boolean(member.role || member.person?.role))) && (
                <MetaItem label="Role" value={(member.role || member.person?.role || '').trim() || 'No role'} />
              )}
            </dl>

            {member.receivedAt && (
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                Received {formatAdminDateTime(member.receivedAt)}
              </p>
            )}

            <div className="mt-3">
              {renderUnlinkedOneVisitNotice()}
            </div>

            {!currentRequest && members.length > 1 ? (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-default)] pt-4">
                <button
                  type="button"
                  onClick={openHistoryPage}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--color-text-primary)] shadow-[0_1px_0_rgba(26,26,46,0.04)] transition-colors hover:bg-[var(--color-surface-highlight)] hover:border-[var(--color-brand-secondary-border)] hover:text-[var(--color-brand-secondary)] cursor-pointer"
                >
                  <Clock className="h-4 w-4 shrink-0 text-[var(--color-brand-secondary)]" aria-hidden="true" />
                  Previous Requests
                </button>
              </div>
            ) : null}

            {renderUnlinkedCurrentActions(member)}
          </SectionCard>
        );
      })}

        </>
      )}

      {/* ── Merge confirmation ── */}
      <Modal
        isOpen={confirmAction === 'merge'}
        onClose={closeConfirmModal}
        title={
          currentRep?.action === 'Remove'
            ? 'Merge and Remove?'
            : hasDirectory
            ? (members.length > 1 ? 'Merge and Update Directory?' : 'Add and Update Directory?')
            : 'Merge and add to Directory?'
        }
        footer={
          <>
            <button
              type="button"
              onClick={closeConfirmModal}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || !isFormValid || mergeEditing}
              onClick={handleConfirmMerge}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
            >
              {submitting
                ? (members.length === 1 ? 'Processing…' : 'Merging…')
                : members.length === 1
                ? (currentRep?.action === 'Remove' ? 'Remove and Update Directory' : 'Add and Update Directory')
                : (hasDirectory ? 'Merge and Update Directory' : (currentRep?.action === 'Remove' ? 'Merge and Remove' : 'Merge & Add to Directory'))}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          {currentRep?.action === 'Remove'
            ? (hasDirectory && members.length > 1
                ? 'The incoming requests will be merged/resolved, the final resolved values will be used, the existing Directory record will be updated to Removed, and the historical request versions will be dissolved.'
                : 'The final resolved values will be used, and the person will be marked as removed in the Directory. The requests in this group will be closed.')
            : hasDirectory
            ? (members.length > 1
                ? 'The incoming requests will be merged/resolved, the final resolved values will be used, the existing Directory record will be updated, and the historical request versions will be dissolved.'
                : 'The final resolved values will overwrite the existing Directory record, and the requests in this group will be closed.')
            : 'A new Directory record will be created from the final resolved values, and the requests in this group will be closed.'}
        </p>

        <div className="mt-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)]/60 p-3.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Final resolved values
            </p>
            {!mergeEditing ? (
              <button
                type="button"
                onClick={startMergeEdit}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-default)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-brand-primary)] cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={saveMergeEdit}
                disabled={!draftForm.firstName.trim() || !draftForm.lastName.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-60 cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Save
              </button>
            )}
          </div>

          {!mergeEditing ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <MetaItem label="First Name" value={form.firstName || '—'} />
              <MetaItem label="Last Name" value={form.lastName || '—'} />
              <MetaItem label="Email" value={form.email || '—'} />
              <MetaItem label={isGll ? 'Gym Location' : (isHealthFitness ? 'Client' : 'Location')} value={(form.location || '').trim() || 'No location'} />
              {isHealthFitness && (
                <>
                  <MetaItem label="Director First Name" value={form.directorFirst || '—'} />
                  <MetaItem label="Director Last Name" value={form.directorLast || '—'} />
                </>
              )}
              {(!isGll && (terms.isJdGyms || Boolean(form.role))) && (
                <MetaItem label="Role" value={form.role ? form.role.trim() : 'No role'} />
              )}
            </dl>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLASS}>First Name *</label>
                <input
                  type="text"
                  value={draftForm.firstName}
                  onChange={(e) => updateDraftField('firstName', e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="First name"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Last Name *</label>
                <input
                  type="text"
                  value={draftForm.lastName}
                  onChange={(e) => updateDraftField('lastName', e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="Last name"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Email</label>
                <input
                  type="email"
                  value={draftForm.email}
                  onChange={(e) => updateDraftField('email', e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="Email address"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>{isGll ? 'Gym Location (Optional)' : (isHealthFitness ? 'Client' : 'Location')}</label>
                <input
                  type="text"
                  value={draftForm.location}
                  onChange={(e) => updateDraftField('location', e.target.value)}
                  className={INPUT_CLASS}
                  placeholder={isGll ? 'e.g. London, Manchester' : (isHealthFitness ? 'Client' : 'Location')}
                />
              </div>
              {isHealthFitness && (
                <>
                  <div>
                    <label className={LABEL_CLASS}>Director First Name</label>
                    <input
                      type="text"
                      value={draftForm.directorFirst || ''}
                      onChange={(e) => updateDraftField('directorFirst', e.target.value)}
                      className={INPUT_CLASS}
                      placeholder="Director first name"
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Director Last Name</label>
                    <input
                      type="text"
                      value={draftForm.directorLast || ''}
                      onChange={(e) => updateDraftField('directorLast', e.target.value)}
                      className={INPUT_CLASS}
                      placeholder="Director last name"
                    />
                  </div>
                </>
              )}
              {(!isGll && (terms.isJdGyms || Boolean(draftForm.role))) && (
              <div>
                <label className={LABEL_CLASS}>Role</label>
                <input
                  type="text"
                  value={draftForm.role || ''}
                  onChange={(e) => updateDraftField('role', e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="Role (e.g. Assistant Manager)"
                />
              </div>
              )}
            </div>
          )}
        </div>

        <label htmlFor="merge-confirm-note" className="mt-4 block w-full">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Admin note <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <textarea
            id="merge-confirm-note"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="Saved with the resolution record"
            rows={2}
            className="mt-2 w-full resize-none rounded-lg border border-[var(--color-border-default)] bg-white px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-brand-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-secondary)]/15"
          />
        </label>
      </Modal>

      {/* ── Keep confirmation ── */}
      <Modal
        isOpen={confirmAction === 'keep'}
        onClose={closeConfirmModal}
        title={members.length > 1 ? "Keep existing and delete new requests?" : "Keep existing and delete new request?"}
        footer={
          <>
            <button
              type="button"
              onClick={closeConfirmModal}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleKeepExisting}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Resolving…' : 'Keep Existing'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          {hasDirectory
            ? (members.length > 1 
                ? 'The existing Directory record will remain unchanged. All incoming requests in this group will be deleted/dissolved, and no Directory changes will be made.'
                : 'The Directory record will stay unchanged. The incoming request will be closed without writing new values.')
            : 'No Directory record will be created. Incoming requests in this group will be closed and discarded.'}
        </p>
      </Modal>

      {/* ── Unlink step-by-step modal ── */}
      <Modal
        isOpen={!!unlinkTargetId}
        onClose={() => setUnlinkTargetId(null)}
        confirm
        title={unlinkStep === 'review' ? "Separate Request" : "Confirm Action"}
        footer={
          unlinkStep === 'review' ? (
            <div className="flex w-full items-center justify-end gap-3">
              {(() => {
                const target = members.find((m) => m.id === unlinkTargetId);
                const isRemove = target?.action === 'Remove';
                return (
                  <button
                    type="button"
                    disabled={unlinkEditing || (!unlinkForm?.firstName?.trim() || !unlinkForm?.lastName?.trim())}
                    onClick={() => {
                      setUnlinkActionType(isRemove ? 'remove' : 'directory');
                      setUnlinkStep('confirm');
                    }}
                    className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
                  >
                    {isRemove ? 'Mark as Removed' : 'Add to Directory'}
                  </button>
                );
              })()}
              <button
                type="button"
                disabled={unlinkEditing}
                onClick={() => {
                  setUnlinkActionType('new_requests');
                  setUnlinkStep('confirm');
                }}
                className="px-4 py-2 border border-[var(--color-border-default)] bg-white text-sm font-semibold text-[var(--color-text-primary)] rounded-lg shadow-sm hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-60"
              >
                Add to New Requests
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setUnlinkStep('review')}
                className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  const target = unlinkTargetId;
                  setUnlinkTargetId(null);
                  handleUnlink(target, unlinkActionType, unlinkForm);
                }}
                className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
              >
                {submitting ? 'Processing...' : (
                  unlinkActionType === 'directory' ? 'Add to Directory' :
                  unlinkActionType === 'remove' ? 'Mark as Removed' :
                  'Add to New Requests'
                )}
              </button>
            </>
          )
        }
      >
        {(() => {
          const target = members.find((m) => m.id === unlinkTargetId);
          if (!target) return null;

          if (unlinkStep === 'review') {
            return (
              <div className="space-y-4">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  This request will be separated from the current group because you indicated that this is a different person.
                </p>

                <div className="mt-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)]/60 p-3.5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                      Person Information
                    </p>
                    {!unlinkEditing ? (
                      <button
                        type="button"
                        onClick={() => {
                          setUnlinkDraft(unlinkForm);
                          setUnlinkEditing(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-default)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-brand-primary)] cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (!unlinkDraft.firstName.trim() || !unlinkDraft.lastName.trim()) return;
                          setUnlinkForm(unlinkDraft);
                          setUnlinkEditing(false);
                        }}
                        disabled={!unlinkDraft.firstName.trim() || !unlinkDraft.lastName.trim()}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-60 cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Save
                      </button>
                    )}
                  </div>

                  {!unlinkEditing ? (
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                      <MetaItem label="First Name" value={unlinkForm.firstName || '—'} />
                      <MetaItem label="Last Name" value={unlinkForm.lastName || '—'} />
                      <MetaItem label="Email" value={unlinkForm.email || '—'} />
                      <MetaItem label={isGll ? 'Gym Location' : (isHealthFitness ? 'Client' : 'Location')} value={(unlinkForm.location || '').trim() || 'No location'} />
                      {isHealthFitness && (
                        <>
                          <MetaItem label="Director First Name" value={unlinkForm.directorFirst || '—'} />
                          <MetaItem label="Director Last Name" value={unlinkForm.directorLast || '—'} />
                        </>
                      )}
                    </dl>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className={LABEL_CLASS}>First Name *</label>
                        <input
                          type="text"
                          value={unlinkDraft.firstName}
                          onChange={(e) => setUnlinkDraft((f) => ({ ...f, firstName: e.target.value }))}
                          className={INPUT_CLASS}
                          placeholder="First name"
                        />
                      </div>
                      <div>
                        <label className={LABEL_CLASS}>Last Name *</label>
                        <input
                          type="text"
                          value={unlinkDraft.lastName}
                          onChange={(e) => setUnlinkDraft((f) => ({ ...f, lastName: e.target.value }))}
                          className={INPUT_CLASS}
                          placeholder="Last name"
                        />
                      </div>
                      <div>
                        <label className={LABEL_CLASS}>Email</label>
                        <input
                          type="email"
                          value={unlinkDraft.email}
                          onChange={(e) => setUnlinkDraft((f) => ({ ...f, email: e.target.value }))}
                          className={INPUT_CLASS}
                          placeholder="Email address"
                        />
                      </div>
                      <div>
                        <label className={LABEL_CLASS}>{isGll ? 'Gym Location (Optional)' : (isHealthFitness ? 'Client' : 'Location')}</label>
                        <input
                          type="text"
                          value={unlinkDraft.location}
                          onChange={(e) => setUnlinkDraft((f) => ({ ...f, location: e.target.value }))}
                          className={INPUT_CLASS}
                          placeholder={isGll ? 'e.g. London, Manchester' : (isHealthFitness ? 'Client' : 'Location')}
                        />
                      </div>
                      {isHealthFitness && (
                        <>
                          <div>
                            <label className={LABEL_CLASS}>Director First Name</label>
                            <input
                              type="text"
                              value={unlinkDraft.directorFirst || ''}
                              onChange={(e) => setUnlinkDraft((f) => ({ ...f, directorFirst: e.target.value }))}
                              className={INPUT_CLASS}
                              placeholder="Director first name"
                            />
                          </div>
                          <div>
                            <label className={LABEL_CLASS}>Director Last Name</label>
                            <input
                              type="text"
                              value={unlinkDraft.directorLast || ''}
                              onChange={(e) => setUnlinkDraft((f) => ({ ...f, directorLast: e.target.value }))}
                              className={INPUT_CLASS}
                              placeholder="Director last name"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          if (unlinkStep === 'confirm') {
            return (
              <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
                {unlinkActionType === 'directory' && (
                  <>
                    <p className="font-semibold text-[var(--color-text-primary)]">Add this person to the Directory?</p>
                    <p>This request will be separated from the current group and the reviewed information will be used for the Directory record.</p>
                  </>
                )}
                {unlinkActionType === 'remove' && (
                  <>
                    <p className="font-semibold text-[var(--color-text-primary)]">Mark this person as removed?</p>
                    <p>This request will be separated from the current group and the person will be marked as removed in the Directory.</p>
                  </>
                )}
                {unlinkActionType === 'new_requests' && (
                  <>
                    <p className="font-semibold text-[var(--color-text-primary)]">Move this request to New Requests?</p>
                    <p>This request will be separated from the current group and created as a standalone New Request.</p>
                  </>
                )}
              </div>
            );
          }

          return null;
        })()}
      </Modal>

      {/* ── Delete request confirmation (same as New Requests) ── */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteImpact(null);
        }}
        title="Delete request"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteImpact(null);
              }}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleDeleteMember}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Deleting…' : 'Confirm'}
            </button>
          </>
        }
      >
        {deleteTarget ? (
          <div className="space-y-4">
            <p>
              Are you sure you want to delete the request for {personFullName(deleteTarget.person)}?
            </p>
            {dismissCascadeCopy(deleteImpact) ? (
              <p>{dismissCascadeCopy(deleteImpact)}</p>
            ) : null}
            <p>
              This action cannot be undone.
            </p>
          </div>
        ) : null}
      </Modal>

      {/* ── Mark unlinked request handled ── */}
      <Modal
        isOpen={!!markUnlinkedTarget}
        onClose={() => setMarkUnlinkedTarget(null)}
        confirm
        title="Confirm action"
        footer={
          <>
            <button
              type="button"
              onClick={() => setMarkUnlinkedTarget(null)}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleMarkUnlinked}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Confirm'}
            </button>
          </>
        }
      >
        {markUnlinkedTarget ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Confirm you have {markUnlinkedTarget.action === 'Add' ? 'added' : 'removed'}{' '}
            <strong>{personFullName(markUnlinkedTarget.person)}</strong> in Power Music before
            continuing. This cannot be undone.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
