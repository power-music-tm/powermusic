import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, ChevronDown, Check, Database, Clock, Pencil,
  X, Users, Inbox, Trash2, AlertTriangle, Mail, MapPin, Loader2,
} from 'lucide-react';
import { Tag, Modal, HoverTip } from './ui';
import { usePartners } from '../context/PartnerContext';
import { getPartnerTerminology } from '../utils/managerAuthBranding';
import { formatAdminDateTime, formatRequestDisplayId } from '../utils/requestDisplayId';
import { getManagerDisplayName, isManualEntry, MANUAL_ENTRY_CLUB } from '../utils/manualEntry';
import { readManagerNotesWithLeaveDate } from '../utils/managerNotes';
import { fetchJson } from '../utils/api';
import { dismissRequest, getDismissImpact, suppressNewRequests, removeRequestsFromCache, bumpCacheEpoch, REQUESTS_PAGE_CACHE_KEY } from '../utils/pilot2Api';
import {
  fetchGroupDetail,
  learnNicknamePair,
  resolveGroupAdd,
  resolveGroupAddAsNew,
  resolveGroupUpdate,
  resolveGroupKeepExisting,
  resolveGroupKeepExistingAndArchive,
  unlinkGroupMember,
  reattachGroupLookalike,
  mergeGroupPeers,
  resolveGroupDeleteFromDirectory,
  resolveGroupMarkRemoved,
} from '../utils/duplicateGroupApi';
import {
  patchRequestsCacheAfterPeerMerge,
  writeMergedGroupCache,
} from '../utils/groupDetailCache';
import { markDirectoryPersonHighlight } from '../utils/adminUiHighlights';
import {
  displayFirstName,
  isNicknameOnlyFirstMatch,
  hasPotentialDuplicatePeer,
  matchClassification,
  normalizeFirstName,
  orderedNicknamePairKey,
} from '../utils/duplicateMatch';
import {
  alignClassificationSummaryWithMembers,
  groupClassificationPills,
} from '../utils/requestTags';
import {
  formatPersonName,
  formatPersonEmail,
  formatPersonLocation,
} from '../utils/personDisplay';

/* ─── helpers ────────────────────────────────────────────────────────────── */

const byNewestReceived = (a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0);

/** Newest open request — the Current Request card and the merge target. */
function latestMember(list, excludeId = null) {
  const open = (Array.isArray(list) ? list : []).filter((m) => m?.id && m.id !== excludeId);
  return [...open].sort(byNewestReceived)[0] || null;
}

function memberFormValues(member) {
  return {
    firstName: member?.person?.firstName || member?.firstName || '',
    lastName: member?.person?.lastName || member?.lastName || '',
    email: member?.person?.email || member?.email || '',
    location: member?.person?.location || member?.location || '',
    role: member?.person?.role || member?.role || '',
    directorFirst: member?.directorFirst || member?.person?.directorFirst || '',
    directorLast: member?.directorLast || member?.person?.directorLast || '',
  };
}

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
  const notesText = readManagerNotesWithLeaveDate(member);
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

/** Primary Directory resolve label — never says "Merge". */
function resolvePrimaryLabel({ hasDirectory, action, submitting = false }) {
  const isRemove = action === 'Remove';
  if (submitting) {
    if (isRemove) return 'Removing…';
    return hasDirectory ? 'Updating…' : 'Adding…';
  }
  if (hasDirectory) {
    return isRemove ? 'Remove and Update Directory' : 'Add and Update Directory';
  }
  // No active Directory target (including Already Removed / archived-only): this
  // path is mark-removed, not "archive / remove the existing Directory row".
  return isRemove ? 'Remove User' : 'Add to Directory';
}

function isDirectoryPersonArchived(person) {
  return Boolean(
    person?.archivedAt
    || String(person?.status || '').toLowerCase() === 'removed'
    || String(person?.outcome || '').toLowerCase() === 'removed',
  );
}

/** Confirm copy for Add/Remove against an eligible active Directory record. */
function directoryResolveScenario({ action }) {
  if (action === 'Remove') {
    return {
      key: 'remove_active',
      title: 'Confirm: archive and update Directory record?',
      body: 'After you confirm, the Directory record you chose will be moved to archive and updated with the final resolved values below. No new Directory record will be created. Other matching Directory records are left unchanged.',
      confirmLabel: 'Archive and Update Record',
      submittingLabel: 'Archiving…',
    };
  }
  return {
    key: 'add_active',
    title: 'Confirm: update Directory record?',
    body: 'After you confirm, the Directory record you chose will be updated with the final resolved values below and will remain active. No duplicate Directory record will be created. Other matching Directory records are left unchanged.',
    confirmLabel: 'Update Directory Record',
    submittingLabel: 'Updating…',
  };
}

/* ─── main export ────────────────────────────────────────────────────────── */

function safeNewRequestsBackPath(from) {
  if (typeof from !== 'string') return '/new-requests';
  if (!from.startsWith('/new-requests')) return '/new-requests';
  if (from.includes('://') || from.includes('//')) return '/new-requests';
  return from;
}

export default function GroupResolutionView({
  group,
  directory = [],
  onResolved,
}) {
  const location = useLocation();
  const backTo = safeNewRequestsBackPath(location.state?.from);
  const backLabel = backTo === '/new-requests' ? 'Back to New Requests' : 'Back to previous request';
  const groupPath = `/new-requests/group/${encodeURIComponent(group.id)}`;
  const { selectedPartnerId } = usePartners();
  const requestsCacheKey = selectedPartnerId ? `${REQUESTS_PAGE_CACHE_KEY}:${selectedPartnerId}` : REQUESTS_PAGE_CACHE_KEY;
  const repMember = group.members.find((m) => m.isRepresentative) || group.members[0];
  // Prefer backend multi-match list; fall back to single directoryPerson / local directory.
  // Only Added/Active rows are update/selection targets — archived matches are excluded.
  const allDirectoryPersons = (() => {
    if (Array.isArray(group.directoryPersons) && group.directoryPersons.length > 0) {
      return group.directoryPersons;
    }
    const single =
      group.directoryPerson ||
      (group.directoryPersonId
        ? directory.find((d) => d.id === group.directoryPersonId) || null
        : null);
    return single ? [single] : [];
  })();
  const directoryPersons = allDirectoryPersons.filter((p) => !isDirectoryPersonArchived(p));
  const dirPerson = directoryPersons[0] || null;
  // Eligible active Directory target(s) for Add/Remove and Update.
  const hasDirectory = directoryPersons.length > 0;
  // Any Directory link (including archived-only) — badge / primary Add|Remove still apply.
  const hasDirectoryLink = Boolean(
    group.directoryPersonId || allDirectoryPersons.length > 0 || hasDirectory,
  );
  const directoryIsArchived = Boolean(
    hasDirectoryLink
    && !hasDirectory
    && (
      group.classification?.startsWith('already_removed')
      || allDirectoryPersons.some(isDirectoryPersonArchived)
    ),
  );
  // Delete New Request still applies when the only match is archived (discard the
  // incoming request). Add New / Archive are redundant vs archived-only matches —
  // archive is never overwritten, and primary Add/Remove already creates the outcome.
  const showKeepExistingDelete = hasDirectoryLink;
  const showKeepExistingAddOrArchive = hasDirectory;
  // Archive is always kept — drop the empty "Keep Existing" wording there.
  const deleteNewRequestLabel = (plural = false) => {
    const suffix = plural ? 's' : '';
    if (!hasDirectory) return `Delete New Request${suffix}`;
    return `Keep Existing and Delete New Request${suffix}`;
  };

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

  // Final values form state — pre-filled from the latest request
  const [form, setForm] = useState(() => memberFormValues(
    latestMember(group.members, group.directoryPersonId) || repMember,
  ));
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
  // confirmAction: 'keep' | 'merge' | 'peers_merge' | 'add_as_new' | 'keep_and_archive' | 'nickname_check' | 'select_directory' | null
  const [confirmAction, setConfirmAction] = useState(null);
  // Which resolve action opened Request History — history Merge resumes this modal.
  // pendingConfirmAction: 'keep' | 'merge' | 'add_as_new' | 'keep_and_archive' | null
  const [pendingConfirmAction, setPendingConfirmAction] = useState(null);
  const [markUnlinkedTarget, setMarkUnlinkedTarget] = useState(null);
  const [modalValues, setModalValues] = useState(null);
  const [mergeEditing, setMergeEditing] = useState(false);
  const [attachLookalikeOpen, setAttachLookalikeOpen] = useState(false);
  const [attachLookalikeId, setAttachLookalikeId] = useState(null);
  // Explicit Directory target for Add/Remove-and-Update (never auto-picked after choose).
  const [selectedDirectoryId, setSelectedDirectoryId] = useState(null);
  // Peer IDs frozen when peers_merge / Add-to-Directory confirm opens —
  // late arrivals stay out of that action.
  const [peersMergeMemberIds, setPeersMergeMemberIds] = useState(null);
  // Nickname pairs answered this visit (Yes/No) — skip modal immediately.
  const [localAnsweredNicknameKeys, setLocalAnsweredNicknameKeys] = useState(() => new Set());
  // Freeze the pair shown in the nickname modal so content does not flip mid-click.
  const [nicknameModalPair, setNicknameModalPair] = useState(null);

  // Newest linked request among current members (same as Current request card).
  const formValuesFromLatest = (list = members) => {
    const linked = (Array.isArray(list) ? list : []).filter(
      (m) => m?.id && !sessionUnlinkedIds.includes(m.id) && m.id !== group.directoryPersonId,
    );
    const newest = latestMember(linked) || latestMember(list, group.directoryPersonId);
    return newest ? memberFormValues(newest) : null;
  };

  // When parent refreshes group detail (cache → network), sync members/form so
  // pills and history don't stay stuck on the stale cached snapshot.
  useEffect(() => {
    const nextMembers = Array.isArray(group.members) ? group.members : [];
    const nextIds = nextMembers.map((m) => m.id).join('|');
    const prevIds = members.map((m) => m.id).join('|');
    if (nextIds === prevIds) return;

    setMembers(nextMembers);
    setSessionUnlinkedIds((ids) => ids.filter((id) => nextMembers.some((m) => m.id === id)));

    if (isEditing || mergeEditing || confirmAction) return;
    const nextRep =
      latestMember(
        nextMembers.filter((m) => m?.id && m.id !== group.directoryPersonId),
      )
      || nextMembers.find((m) => m.isRepresentative)
      || nextMembers[0]
      || null;
    if (!nextRep) return;
    const nextForm = memberFormValues(nextRep);
    setForm(nextForm);
    setDraftForm(nextForm);
    // History / merge preview must follow the new Current request — do not keep
    // an older modalValues snapshot (e.g. location 111 after 112 arrives).
    if (mergePageOpen) setModalValues(nextForm);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: sync from group.members only
  }, [group.members, group.id]);

  // Keep final-values form on the Current request even when the member set was
  // already complete on first paint (no id-join change to trigger the effect above).
  const latestOpenId = latestMember(
    members.filter(
      (m) => m?.id && !sessionUnlinkedIds.includes(m.id) && m.id !== group.directoryPersonId,
    ),
  )?.id || null;
  useEffect(() => {
    if (!latestOpenId || isEditing || mergeEditing || confirmAction) return;
    const nextForm = formValuesFromLatest();
    if (!nextForm) return;
    setForm((prev) => (
      prev.firstName === nextForm.firstName
      && prev.lastName === nextForm.lastName
      && prev.email === nextForm.email
      && prev.location === nextForm.location
      && prev.role === nextForm.role
      && prev.directorFirst === nextForm.directorFirst
      && prev.directorLast === nextForm.directorLast
        ? prev
        : nextForm
    ));
    setDraftForm(nextForm);
    if (mergePageOpen) setModalValues(nextForm);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- align to Current request id only
  }, [latestOpenId]);


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
    // Block dismiss while an action is in flight or final-values Edit is open
    // (user must Save before Cancel / X).
    if (submitting || mergeEditing) return;
    setConfirmAction(null);
    setMergeEditing(false);
    setSelectedDirectoryId(null);
    setPeersMergeMemberIds(null);
    setNicknameModalPair(null);
    setPendingConfirmAction(null);
  };

  const incomingMemberCount = () =>
    members.filter(
      (m) => !sessionUnlinkedIds.includes(m.id) && m.id !== group.directoryPersonId,
    ).length;

  const answeredNicknameKeys = (() => {
    const keys = new Set(localAnsweredNicknameKeys);
    const fromGroup = Array.isArray(group.answeredNicknamePairs)
      ? group.answeredNicknamePairs
      : [];
    for (const row of fromGroup) {
      const key = orderedNicknamePairKey(row?.nameA, row?.nameB);
      if (key) keys.add(key);
    }
    return keys;
  })();

  const rejectedNicknameKeys = (() => {
    const keys = new Set();
    const fromGroup = Array.isArray(group.answeredNicknamePairs)
      ? group.answeredNicknamePairs
      : [];
    for (const row of fromGroup) {
      if (row?.decision !== 'different') continue;
      const key = orderedNicknamePairKey(row?.nameA, row?.nameB);
      if (key) keys.add(key);
    }
    return keys;
  })();

  /**
   * First-name check vs Directory for Keep / Add New.
   * Prefer nickname-linked pairs (learning applies); otherwise any different first names.
   * Skip pairs already answered Yes or No (persisted or this visit).
   */
  const nicknameCheckPair = () => {
    if (!hasDirectory) return null;
    const directoryFirst =
      dirPerson?.firstName
      || dirPerson?.person?.firstName
      || '';
    if (!directoryFirst) return null;

    const candidates = [];
    const values = modalValues || form;
    if (values?.firstName) candidates.push(values.firstName);
    if (repMember?.person?.firstName || repMember?.firstName) {
      candidates.push(repMember?.person?.firstName || repMember?.firstName);
    }
    for (const m of members) {
      if (m?.id === group.directoryPersonId) continue;
      const first = m?.person?.firstName || m?.firstName;
      if (first) candidates.push(first);
    }

    let differentPair = null;
    for (const requestFirst of candidates) {
      const reqNorm = normalizeFirstName(requestFirst);
      const dirNorm = normalizeFirstName(directoryFirst);
      if (!reqNorm || !dirNorm || reqNorm === dirNorm) continue;

      const answerKey = orderedNicknamePairKey(requestFirst, directoryFirst);
      // Already decided for this nickname pair — never ask again.
      if (answerKey && answeredNicknameKeys.has(answerKey)) continue;

      const isNickname = isNicknameOnlyFirstMatch(requestFirst, directoryFirst, {
        rejectedPairs: rejectedNicknameKeys,
      });
      const pair = {
        requestFirst: displayFirstName(requestFirst),
        directoryFirst: displayFirstName(directoryFirst),
        isNickname,
      };
      if (pair.isNickname) return pair;
      if (!differentPair) differentPair = pair;
    }
    return differentPair;
  };

  const rememberNicknameAnswer = (pair, decision) => {
    if (!pair?.isNickname) return;
    const key = orderedNicknamePairKey(pair.requestFirst, pair.directoryFirst);
    if (key) {
      setLocalAnsweredNicknameKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }
    // Fire-and-forget — do not await (avoids modal title flipping while open).
    learnNicknamePair({
      firstNameA: pair.requestFirst,
      firstNameB: pair.directoryFirst,
      decision,
      sourceGroupId: group.id,
    }).catch(() => {
      // Local skip still applies this visit; DB write can retry next time.
    });
  };

  const snapshotPeersForMerge = () => {
    const linked = members.filter(
      (m) => !sessionUnlinkedIds.includes(m.id) && m.id !== group.directoryPersonId,
    );
    return linked.map((m) => m.id).filter(Boolean);
  };

  /** After nickname answer (or when no nickname pair): history if siblings, else confirm. */
  const proceedKeepOrAddAsNew = (action) => {
    if (incomingMemberCount() > 1 && !mergePageOpen) {
      setPendingConfirmAction(action);
      openHistoryPage({ clearPending: false });
      return;
    }
    setPendingConfirmAction(null);
    // Freeze peers now — late arrivals must not be swept into Keep / Add New.
    if (action === 'keep' || action === 'add_as_new') {
      setPeersMergeMemberIds(snapshotPeersForMerge());
    }
    setConfirmAction(action);
  };

  const openConfirmOrNicknameCheck = (nextAction) => {
    // Nickname modal first — including before Request History when peers exist.
    // Remember which button opened this so Yes/No cannot switch Keep Delete → Add New.
    const pair = nicknameCheckPair();
    if (pair) {
      setNicknameModalPair(pair);
      setPendingConfirmAction(nextAction);
      setConfirmAction('nickname_check');
      return;
    }
    proceedKeepOrAddAsNew(nextAction);
  };

  /** Nickname Yes/No only learns the pair; the originating button always proceeds. */
  const continueAfterNicknameAnswer = (decision) => {
    const pair = nicknameModalPair || nicknameCheckPair();
    setNicknameModalPair(null);
    rememberNicknameAnswer(pair, decision);
    setModalValues((prev) => prev || { ...form });
    const intended = pendingConfirmAction === 'add_as_new' ? 'add_as_new' : 'keep';
    proceedKeepOrAddAsNew(intended);
  };

  const continueAfterNicknameYes = () => continueAfterNicknameAnswer('same');
  const continueAfterNicknameNo = () => continueAfterNicknameAnswer('different');

  const startMergeEdit = () => {
    if (submitting) return;
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
    setPendingConfirmAction(null);
  };

  /* ── open the Request History page (timeline + Merge) ── */
  const openHistoryPage = ({ clearPending = true } = {}) => {
    if (submitting) return;
    if (clearPending) setPendingConfirmAction(null);
    setHistoryExpanded(true);
    setMergePageOpen(true);
  };

  /* ── keep existing — nickname check first, then history / confirm ── */
  const openKeepConfirm = () => {
    if (submitting || !showKeepExistingDelete) return;
    const latestValues = formValuesFromLatest() || { ...form };
    setForm(latestValues);
    setModalValues(latestValues);
    openConfirmOrNicknameCheck('keep');
  };

  /* ── not the same as Directory — nickname check first, then history / confirm ── */
  const openAddAsNewConfirm = () => {
    if (submitting || !showKeepExistingAddOrArchive) return;
    if (currentRep?.action === 'Remove') return;
    const latestValues = formValuesFromLatest() || { ...form };
    setForm(latestValues);
    setModalValues(latestValues);
    setDraftForm(latestValues);
    openConfirmOrNicknameCheck('add_as_new');
  };

  /* ── Remove false positive vs Directory — archive Remove request ── */
  const openKeepAndArchiveConfirm = () => {
    if (submitting || !showKeepExistingAddOrArchive) return;
    if (currentRep?.action !== 'Remove') return;
    const latestValues = formValuesFromLatest() || { ...form };
    setForm(latestValues);
    setModalValues(latestValues);
    setDraftForm(latestValues);
    setMergeEditing(false);
    if (incomingMemberCount() > 1 && !mergePageOpen) {
      setPendingConfirmAction('keep_and_archive');
      openHistoryPage({ clearPending: false });
      return;
    }
    setPendingConfirmAction(null);
    // Freeze now — late arrivals stay out of Keep Existing and Archive.
    setPeersMergeMemberIds(snapshotPeersForMerge());
    setConfirmAction('keep_and_archive');
  };

  const openMergePage = () => {
    if (submitting) return;
    setPendingConfirmAction(null);
    setHistoryExpanded(true);
    setValuesOpen(true);
    // Always seed from Current request — form may still hold an older visit's values.
    const latestValues = formValuesFromLatest() || { ...form };
    setForm(latestValues);
    setDraftForm(latestValues);
    setModalValues(latestValues);
    setMergePageOpen(true);
  };

  const openDirectorySelect = () => {
    // Step 2 of 3 when multiple active Directory matches: radio, no pre-select.
    setSelectedDirectoryId(null);
    setConfirmAction('select_directory');
  };

  const openDirectoryConfirm = (directoryId) => {
    // Step 3: confirm final resolved values against the chosen Directory record.
    const id = directoryId || null;
    if (!id && hasDirectory) return;
    setSelectedDirectoryId(id);
    setConfirmAction('merge');
  };

  const openMergeConfirm = () => {
    if (!isFormValid || submitting) return;
    const latestValues = formValuesFromLatest() || { ...form };
    setForm(latestValues);
    setModalValues(latestValues);
    setDraftForm(latestValues);
    // Same as Keep flows: review Previous Requests first when multiple matches.
    if (incomingMemberCount() > 1 && !mergePageOpen) {
      setPendingConfirmAction('merge');
      openHistoryPage({ clearPending: false });
      return;
    }
    setPendingConfirmAction(null);
    // Freeze now — late arrivals after Add/Update confirm stay out of this resolve.
    setPeersMergeMemberIds(snapshotPeersForMerge());
    if (hasDirectory && directoryPersons.length > 1) {
      // Multi-match: always radio first — never jump to a pre-selected confirm.
      openDirectorySelect();
      return;
    }
    if (hasDirectory && directoryPersons.length === 1) {
      openDirectoryConfirm(directoryPersons[0].id);
      return;
    }
    // No eligible active Directory target — normal new Add / Remove flow.
    // Archived matches are never selected or restored here.
    setSelectedDirectoryId(null);
    setConfirmAction('merge');
  };

  const handleConfirmMerge = async () => {
    const values = isEditing ? draftForm : (modalValues || form);
    if (hasDirectory) {
      const targetId = selectedDirectoryId;
      if (!targetId) {
        onResolved('error', 'Select a Directory record before continuing.');
        return;
      }
      if (currentRep?.action === 'Remove') {
        await handleResolveRemove(values, targetId);
        return;
      }
      await handleConfirmUpdate(values, targetId);
      return;
    }
    if (currentRep?.action === 'Remove') {
      await handleResolveRemove(values, null);
      return;
    }
    await handleResolveAdd(values);
  };

  const returnToCurrentRequest = () => {
    setMergePageOpen(false);
    setModalValues(null);
    setPendingConfirmAction(null);
  };

  // If peers are reduced to one (e.g. Delete / history Merge), leave
  // history so the main action buttons show on the Current Request card.
  useEffect(() => {
    if (!mergePageOpen) return;
    if (
      pendingConfirmAction !== 'keep'
      && pendingConfirmAction !== 'add_as_new'
      && pendingConfirmAction !== 'keep_and_archive'
      && pendingConfirmAction !== 'merge'
    ) return;
    const count = members.filter(
      (m) => !sessionUnlinkedIds.includes(m.id) && m.id !== group.directoryPersonId,
    ).length;
    if (count !== 1) return;
    setMergePageOpen(false);
    setModalValues(null);
    setPendingConfirmAction(null);
  }, [
    mergePageOpen,
    pendingConfirmAction,
    members,
    sessionUnlinkedIds,
    group.directoryPersonId,
  ]);

  const openPeersMergeConfirm = () => {
    const ids = snapshotPeersForMerge();
    if (ids.length < 2) return false;
    // Final values = newest request in this merge set (Current request card).
    const snapshotMembers = members.filter(
      (m) => ids.includes(m.id) && m.id !== group.directoryPersonId,
    );
    const latestValues = memberFormValues(latestMember(snapshotMembers)) || formValuesFromLatest();
    if (latestValues) {
      setForm(latestValues);
      setDraftForm(latestValues);
      setModalValues(latestValues);
    }
    setMergeEditing(false);
    // Freeze now — live arrivals after this stay in the group, not this merge.
    setPeersMergeMemberIds(ids);
    setConfirmAction('peers_merge');
    return true;
  };

  /* Collapse Request History to one request; group stays active — no Directory write. */
  const consolidatePeersToCurrent = async (values = form) => {
    if (submitting) return;
    const nextValues = {
      firstName: (values.firstName || '').trim(),
      lastName: (values.lastName || '').trim(),
      email: (values.email || '').trim(),
      location: (values.location || '').trim(),
      role: (values.role || '').trim(),
      directorFirst: (values.directorFirst || '').trim(),
      directorLast: (values.directorLast || '').trim(),
    };
    if (!nextValues.firstName || !nextValues.lastName) return;

    // Prefer confirm-open snapshot so late arrivals are not merged/deleted.
    const snapshotIds = Array.isArray(peersMergeMemberIds) && peersMergeMemberIds.length >= 2
      ? peersMergeMemberIds
      : snapshotPeersForMerge();
    const snapshotSet = new Set(snapshotIds);
    const active = members.filter(
      (m) => snapshotSet.has(m.id) && m.id !== group.directoryPersonId,
    );
    const sortedActive = [...active].sort(byNewestReceived);
    const sourceRequestId = sortedActive[0]?.id || group.representativeRequestId || null;
    if (snapshotIds.length <= 1) {
      setForm(nextValues);
      setModalValues(nextValues);
      closeConfirmModal();
      returnToCurrentRequest();
      return;
    }

    setForm(nextValues);
    setModalValues(nextValues);
    setSubmitting(true);
    try {
      const result = await mergeGroupPeers(group.id, {
        finalValues: {
          firstName: nextValues.firstName,
          lastName: nextValues.lastName,
          email: nextValues.email,
          location: nextValues.location,
          role: nextValues.role || null,
          directorFirst: nextValues.directorFirst || null,
          directorLast: nextValues.directorLast || null,
        },
        sourceRequestId,
        memberIds: snapshotIds,
      });
      const deletedIds = Array.isArray(result?.deletedIds) ? result.deletedIds : [];
      const survivorId = result?.survivorRequestId || sourceRequestId;
      const priorSurvivor = sortedActive.find((m) => m.id === survivorId) || sortedActive[0];
      const survivorMember = priorSurvivor
        ? {
            ...priorSurvivor,
            id: survivorId,
            isRepresentative: true,
            person: {
              ...(priorSurvivor.person || {}),
              firstName: nextValues.firstName,
              lastName: nextValues.lastName,
              email: nextValues.email,
              location: nextValues.location,
              role: nextValues.role || null,
              directorFirst: nextValues.directorFirst || null,
              directorLast: nextValues.directorLast || null,
            },
            firstName: nextValues.firstName,
            lastName: nextValues.lastName,
            email: nextValues.email,
            location: nextValues.location,
            role: nextValues.role || null,
            directorFirst: nextValues.directorFirst || null,
            directorLast: nextValues.directorLast || null,
          }
        : null;

      // Keep peers that arrived after the merge modal opened (not in snapshot).
      const lateArrivals = members.filter(
        (m) =>
          m?.id
          && !snapshotSet.has(m.id)
          && m.id !== group.directoryPersonId
          && !deletedIds.includes(m.id),
      );
      const merged = survivorMember
        ? [
            survivorMember,
            ...lateArrivals.filter((m) => m.id !== survivorMember.id),
          ]
        : lateArrivals;
      // A request that arrived mid-merge is newer than the survivor: it becomes the
      // current request, so the next merge lands on it with its own values.
      const latest = latestMember(merged);
      const remaining = merged.map((m) => ({ ...m, isRepresentative: m.id === latest?.id }));
      const survivorEntry = remaining.find((m) => m.id === survivorId) || survivorMember;
      if (latest && latest.id !== survivorId) {
        const latestValues = memberFormValues(latest);
        setForm(latestValues);
        setDraftForm(latestValues);
        setModalValues(null);
      }

      if (deletedIds.length > 0) {
        suppressNewRequests({ requestIds: deletedIds, hard: true });
        removeRequestsFromCache(requestsCacheKey, { requestIds: deletedIds });
        bumpCacheEpoch(requestsCacheKey);
      }
      if (remaining.length > 0) {
        setMembers(remaining);
        setSessionUnlinkedIds((ids) =>
          ids.filter((id) => remaining.some((m) => m.id === id)),
        );
      }
      const optimisticGroup = writeMergedGroupCache(group.id, group, {
        survivor: survivorEntry,
        deletedIds,
        members: remaining,
        representativeId: latest?.id || null,
      });
      patchRequestsCacheAfterPeerMerge(requestsCacheKey, group.id, {
        survivorId,
        representativeId: latest?.id || null,
        deletedIds,
        members: remaining,
        classificationSummary: optimisticGroup?.classificationSummary || null,
      });
      closeConfirmModal();
      // Stay on history/detail when late arrivals remain so admin can still review them.
      if (lateArrivals.length === 0) {
        returnToCurrentRequest();
      }
      onResolved('peers_merged', optimisticGroup || null);
    } catch (err) {
      onResolved('error', err.message || 'Failed to merge requests.');
    } finally {
      setSubmitting(false);
    }
  };

  /*
   * History Merge:
   * - Keep / Add New / Keep & Archive intent → peers-merge confirm (editable final
   *   values), then back to Current Request for Keep Existing actions.
   * - Merge and Update / Previous Requests → directory merge confirm.
   */
  const continueFromHistoryMerge = () => {
    if (submitting || !isFormValid) return;
    // openPeersMergeConfirm re-seeds from the latest snapshot member; only
    // pre-fill here when we are not about to open that confirm.
    if (
      pendingConfirmAction === 'keep'
      || pendingConfirmAction === 'add_as_new'
      || pendingConfirmAction === 'keep_and_archive'
    ) {
      if (incomingMemberCount() > 1) {
        openPeersMergeConfirm();
        return;
      }
      const latestValues = formValuesFromLatest() || { ...form };
      setForm(latestValues);
      setModalValues(latestValues);
      setDraftForm(latestValues);
      returnToCurrentRequest();
      return;
    }
    if (incomingMemberCount() > 1) {
      openPeersMergeConfirm();
      return;
    }
    const latestValues = formValuesFromLatest() || { ...form };
    setForm(latestValues);
    setModalValues(latestValues);
    setDraftForm(latestValues);
    // Peers already consolidated (or only one request) after starting Add/Remove
    // and Update: continue to Directory selection / status-aware confirm.
    if (pendingConfirmAction === 'merge') {
      setMergePageOpen(false);
      setPendingConfirmAction(null);
      setPeersMergeMemberIds(snapshotPeersForMerge());
      if (hasDirectory && directoryPersons.length > 1) {
        openDirectorySelect();
        return;
      }
      if (hasDirectory && directoryPersons.length === 1) {
        openDirectoryConfirm(directoryPersons[0].id);
        return;
      }
      setSelectedDirectoryId(null);
      setConfirmAction('merge');
      return;
    }
    returnToCurrentRequest();
  };

  const handleConfirmPeersMerge = async () => {
    const values = mergeEditing ? draftForm : (modalValues || form);
    await consolidatePeersToCurrent(values);
  };

  const openAttachLookalikeModal = () => {
    if (submitting) return;
    if (incomingMemberCount() !== 1) return;
    const lookalikes = Array.isArray(group.separatedLookalikeRequests)
      ? group.separatedLookalikeRequests
      : [];
    if (lookalikes.length === 0) return;
    setAttachLookalikeId(lookalikes[0]?.id || null);
    setAttachLookalikeOpen(true);
  };

  const closeAttachLookalikeModal = () => {
    if (submitting) return;
    setAttachLookalikeOpen(false);
    setAttachLookalikeId(null);
  };

  const handleConfirmAttachLookalike = async () => {
    if (!attachLookalikeId || submitting) return;
    setSubmitting(true);
    const targetId = attachLookalikeId;
    try {
      const result = await reattachGroupLookalike(group.id, {
        targetRequestId: targetId,
      });
      const newGroupId = result?.newGroupId || null;
      let detail = null;
      if (newGroupId) {
        try {
          detail = await fetchGroupDetail(newGroupId);
        } catch {
          detail = null;
        }
      }
      setAttachLookalikeOpen(false);
      setAttachLookalikeId(null);
      // Pass full payload + destination detail so the parent can upsert the list
      // row and navigate without tombstoning survivor request IDs.
      onResolved('reattached', {
        newGroupId,
        sourceRequestId: result?.sourceRequestId || null,
        targetRequestId: result?.targetRequestId || targetId,
        previousGroupId: result?.previousGroupId || group.id,
        detail,
      });
    } catch (err) {
      onResolved('error', err.message || 'Failed to transfer to that request.');
    } finally {
      setSubmitting(false);
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
  const handleResolveRemove = async (values = form, directoryTargetId = selectedDirectoryId) => {
    if (!values.firstName.trim() || !values.lastName.trim() || submitting) return;
    const snapshotIds = Array.isArray(peersMergeMemberIds) && peersMergeMemberIds.length > 0
      ? peersMergeMemberIds
      : snapshotPeersForMerge();
    setSubmitting(true);
    try {
      if (hasDirectory) {
        const targetId = directoryTargetId || selectedDirectoryId;
        if (!targetId) {
          throw new Error('Select a Directory record before continuing.');
        }
        await resolveGroupDeleteFromDirectory(group.id, {
          directoryPersonId: targetId,
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
          memberIds: snapshotIds,
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
          memberIds: snapshotIds,
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
    const snapshotIds = Array.isArray(peersMergeMemberIds) && peersMergeMemberIds.length > 0
      ? peersMergeMemberIds
      : snapshotPeersForMerge();
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
        memberIds: snapshotIds,
      });
      closeConfirmModal();
      closeMergePage();
      if ((values.email || '').trim()) {
        markDirectoryPersonHighlight(values.email.trim());
      }
      onResolved('add', personFullName(values));
    } catch (err) {
      onResolved('error', err.message || 'Failed to resolve group.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── not same as Directory — add as new (Case A2) ── */
  const handleAddAsNew = async (values = form) => {
    if (!values.firstName.trim() || !values.lastName.trim() || submitting) return;
    if (!showKeepExistingAddOrArchive) return;
    const snapshotIds = Array.isArray(peersMergeMemberIds) && peersMergeMemberIds.length > 0
      ? peersMergeMemberIds
      : snapshotPeersForMerge();
    setSubmitting(true);
    try {
      await resolveGroupAddAsNew(group.id, {
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
        memberIds: snapshotIds,
      });
      closeConfirmModal();
      closeMergePage();
      if ((values.email || '').trim()) {
        markDirectoryPersonHighlight(values.email.trim());
      }
      onResolved('add_as_new', personFullName(values));
    } catch (err) {
      onResolved('error', err.message || 'Failed to add as new person.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Remove false positive — keep Directory, archive Remove request ── */
  const handleKeepAndArchive = async (values = form) => {
    if (!values.firstName.trim() || !values.lastName.trim() || submitting) return;
    if (!showKeepExistingAddOrArchive || currentRep?.action !== 'Remove') return;
    const snapshotIds = Array.isArray(peersMergeMemberIds) && peersMergeMemberIds.length > 0
      ? peersMergeMemberIds
      : snapshotPeersForMerge();
    setSubmitting(true);
    try {
      await resolveGroupKeepExistingAndArchive(group.id, {
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
        memberIds: snapshotIds,
      });
      closeConfirmModal();
      closeMergePage();
      onResolved('keep_and_archive', personFullName(values));
    } catch (err) {
      onResolved('error', err.message || 'Failed to archive remove request.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── resolve & update (Case B) ── */
  const handleConfirmUpdate = async (values = form, directoryTargetId = selectedDirectoryId) => {
    if (submitting) return;
    if (!values.firstName.trim() || !values.lastName.trim()) return;
    const targetId = directoryTargetId || selectedDirectoryId;
    if (!targetId) {
      onResolved('error', 'Select a Directory record before continuing.');
      return;
    }
    const snapshotIds = Array.isArray(peersMergeMemberIds) && peersMergeMemberIds.length > 0
      ? peersMergeMemberIds
      : snapshotPeersForMerge();
    setSubmitting(true);
    try {
      await resolveGroupUpdate(group.id, {
        directoryPersonId: targetId,
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
        memberIds: snapshotIds,
      });
      closeConfirmModal();
      closeMergePage();
      if ((values.email || '').trim()) {
        markDirectoryPersonHighlight(values.email.trim());
      }
      onResolved('update', personFullName(values));
    } catch (err) {
      onResolved('error', err.message || 'Failed to update Directory.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── resolve — keep existing (Case C) ── */
  const handleKeepExisting = async () => {
    if (submitting || !showKeepExistingDelete) return;
    const snapshotIds = Array.isArray(peersMergeMemberIds) && peersMergeMemberIds.length > 0
      ? peersMergeMemberIds
      : snapshotPeersForMerge();
    setSubmitting(true);
    try {
      await resolveGroupKeepExisting(group.id, {
        adminNote: adminNote.trim() || null,
        memberIds: snapshotIds,
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
    if (submitting) return;
    const active = members.filter((m) => !sessionUnlinkedIds.includes(m.id));
    const target = active.find((m) => m.id === memberId)
      || members.find((m) => m.id === memberId);
    const current = [...active].sort(
      (a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0),
    )[0] || null;
    // Prefer a pairwise potential peer (the edge that justified the tag), then
    // current, then any other active member.
    let peer = active.find(
      (m) =>
        m.id !== memberId
        && matchClassification(target?.person, m.person, { isGll }) === 'potential_duplicate',
    );
    if (!peer && current && current.id !== memberId) {
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
    let leaveForNewRequests = false;
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
        suppressNewRequests({ requestIds: [memberId], hard: true });
        removeRequestsFromCache(requestsCacheKey, { requestIds: [memberId] });
        const nextMembers = members.filter((m) => m.id !== memberId);
        setMembers(nextMembers);
        setUnlinkTargetId(null);
        setUnlinkStep(null);
        setUnlinkActionType(null);
        onResolved(
          actionType === 'directory' ? 'unlinked_added_directory' : 'unlinked_removed_directory',
          personFullName(finalValues)
        );
      } else {
        // Keep the confirm modal open with its loading state until GroupDetail
        // navigates to New Requests (this view unmounts). Clearing unlinkTargetId
        // early made it look like the modal dismissed with no loading.
        leaveForNewRequests = true;
        const remainingMembers = members.filter((m) => m.id !== memberId);
        const unlinkedMember = members.find((m) => m.id === memberId) || null;
        onResolved('unlinked_new_requests', {
          requestId: memberId,
          groupId: group.id,
          member: unlinkedMember,
          remainingMembers,
        });
      }
    } catch (err) {
      onResolved('error', err.message || 'Failed to unlink request.');
    } finally {
      if (!leaveForNewRequests) setSubmitting(false);
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
    // Freeze cascade from confirm-open impact — late arrivals stay in the group.
    const alsoIds = Array.isArray(deleteImpact?.confirmedSiblingIds)
      ? deleteImpact.confirmedSiblingIds.filter(Boolean)
      : [];
    const alsoSet = new Set(alsoIds);
    try {
      await dismissRequest(member.id, { alsoDeleteIds: alsoIds });
      const removeIds = [member.id, ...alsoIds];
      suppressNewRequests({ requestIds: removeIds, hard: true });
      removeRequestsFromCache(requestsCacheKey, { requestIds: removeIds });
      // Drop in-flight list GETs that started before the delete committed.
      bumpCacheEpoch(requestsCacheKey);
      const nextMembers = members.filter(
        (m) => m.id !== member.id && !alsoSet.has(m.id),
      );
      const nextUnlinked = sessionUnlinkedIds.filter(
        (id) => id !== member.id && !alsoSet.has(id),
      );
      setMembers(nextMembers);
      setSessionUnlinkedIds(nextUnlinked);
      setDeleteTarget(null);
      setDeleteImpact(null);
      const deletedName = personFullName(member.person);
      // Group dissolved / solo survivor left → leave this URL (do not refresh into
      // "Group not found"). Solo survivor opens as its own request detail.
      if (nextMembers.length === 0) {
        onResolved('member_deleted_done', { name: deletedName, survivorId: null });
      } else if (nextMembers.length === 1 && !hasDirectoryLink) {
        const survivor = nextMembers[0];
        onResolved('member_deleted_done', {
          name: deletedName,
          survivorId: survivor?.id || null,
          survivor,
        });
      } else {
        onResolved('member_deleted', { name: deletedName });
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
      suppressNewRequests({ requestIds: [member.id], hard: true });
      removeRequestsFromCache(requestsCacheKey, { requestIds: [member.id] });
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
      if (nextMembers.length === 0 || (nextMembers.length === 1 && !hasDirectoryLink)) {
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
    <div className="relative z-0 min-w-0 w-full bg-[var(--color-surface-bg)] pb-16">

      {/* ── breadcrumb ── */}
      <nav aria-label="Breadcrumb" className="mb-8 flex w-full flex-wrap items-center gap-x-3 gap-y-2">
        <HoverTip label={backLabel}>
          <Link
            to={backTo}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-highlight)] hover:text-[var(--color-text-primary)]"
            aria-label={backLabel}
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
          {/* Aggregated classification pills — peer duplicate counts only when history has 2+ */}
          {(() => {
            const peerCount = activeMembers.length;
            const raw = alignClassificationSummaryWithMembers(
              group.classificationSummary || {},
              peerCount,
            );
            const summary = peerCount <= 1
              ? { ...raw, duplicateCount: 0, potentialCount: 0 }
              : raw;
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
            // Solo peer history: do not fall back to stale Duplicate / Potential labels.
            if (peerCount <= 1 && !hasDirectoryLink) return null;
            if (peerCount <= 1 && hasDirectoryLink) {
              // Prefer explicit group classification; archived-only link → Already Removed.
              // Keep Potential Duplicate visible when that is the live classification.
              if (group.classification === 'potential_duplicate') {
                const pills = [
                  classificationTag('potential_duplicate'),
                  classificationTag(directoryIsArchived || !hasDirectory ? 'already_removed' : 'already_exists'),
                ];
                return pills.map((pill) => (
                  <Tag key={pill.label} variant={pill.variant} label={pill.label} />
                ));
              }
              const dirClass = group.classification?.startsWith('already_removed')
                || directoryIsArchived
                || !hasDirectory
                ? (group.classification?.startsWith('already_removed')
                  ? group.classification
                  : 'already_removed')
                : (group.classification?.startsWith('already_exists')
                  ? group.classification
                  : 'already_exists');
              const dirTag = classificationTag(dirClass);
              return <Tag variant={dirTag.variant} label={dirTag.label} />;
            }
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
                  {activeMembers.length > 1 ? (
                    <>
                      <Users className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
                      <span className="text-sm text-[var(--color-text-secondary)]">
                        Duplicate exists
                      </span>
                    </>
                  ) : null}
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

      {Array.isArray(group.separatedLookalikeRequests) && group.separatedLookalikeRequests.length > 0 ? (
        <div
          role="status"
          className="mt-6 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-950"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="leading-relaxed">
              Also similar to{' '}
              {group.separatedLookalikeRequests.map((lookalike, index) => {
                const href = lookalike.duplicateGroupId
                  ? `/new-requests/group/${encodeURIComponent(lookalike.duplicateGroupId)}`
                  : `/new-requests/${encodeURIComponent(lookalike.id)}`;
                const label = formatRequestDisplayId(lookalike.displayId || lookalike.id);
                const count = group.separatedLookalikeRequests.length;
                const sep =
                  index === count - 1
                    ? ''
                    : index === count - 2
                      ? (count === 2 ? ' and ' : ', and ')
                      : ', ';
                return (
                  <span key={lookalike.id}>
                    <Link
                      to={href}
                      state={{ from: groupPath }}
                      className="font-semibold text-amber-950 underline decoration-amber-400/80 underline-offset-2 transition-colors hover:text-[var(--color-brand-primary)] hover:decoration-[var(--color-brand-primary)]"
                    >
                      {label}
                    </Link>
                    {sep}
                  </span>
                );
              })}
              . You previously chose <span className="font-semibold">Not the same person</span> for
              these. This request was transferred to the latest match only; those requests stay separate.
            </p>
            {(() => {
              const needsMerge = incomingMemberCount() > 1;
              const attachBtn = (
                <button
                  type="button"
                  disabled={submitting || needsMerge}
                  onClick={openAttachLookalikeModal}
                  className="inline-flex items-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 shadow-[0_1px_0_rgba(26,26,46,0.04)] transition-colors hover:border-amber-400 hover:bg-amber-100/60 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Transfer to a similar request
                </button>
              );
              if (!needsMerge) return attachBtn;
              return (
                <HoverTip label="Merge Request History to one request first">
                  <span className="inline-flex">{attachBtn}</span>
                </HoverTip>
              );
            })()}
          </div>
        </div>
      ) : null}
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
                    // Unlink on older rows that are a potential duplicate of any
                    // other active history member (pairwise), not only vs current.
                    // Never on the current (newest) request. Confirmed-only edges
                    // do not unlock the button.
                    const showUnlink = (
                      !unlinked
                      && !isLatest
                      && activeMembers.length > 1
                      && hasPotentialDuplicatePeer(
                        member.person,
                        activeMembers
                          .filter((m) => m.id !== member.id)
                          .map((m) => m.person),
                        { isGll },
                      )
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
              {/* Delete New Request still applies for archived-only; Add New / Archive need active Directory */}
              {showKeepExistingDelete && incomingMemberCount() === 1 ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={openKeepConfirm}
                  className={BTN_SECONDARY}
                >
                  {deleteNewRequestLabel(false)}
                </button>
              ) : null}
              {showKeepExistingAddOrArchive && incomingMemberCount() === 1 && currentRep?.action !== 'Remove' ? (
                <button
                  type="button"
                  disabled={!isFormValid || submitting || isEditing}
                  onClick={openAddAsNewConfirm}
                  className={BTN_SECONDARY}
                >
                  Keep Existing and Add New
                </button>
              ) : null}
              {showKeepExistingAddOrArchive && incomingMemberCount() === 1 && currentRep?.action === 'Remove' ? (
                <button
                  type="button"
                  disabled={!isFormValid || submitting || isEditing}
                  onClick={openKeepAndArchiveConfirm}
                  className={BTN_SECONDARY}
                >
                  Keep Existing and Archive
                </button>
              ) : null}
              <button
                type="button"
                disabled={
                  submitting
                  || isEditing
                  || (pendingConfirmAction !== 'keep' && !isFormValid)
                }
                onClick={continueFromHistoryMerge}
                className={BTN_PRIMARY}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                {incomingMemberCount() > 1
                  ? (submitting ? 'Merging…' : 'Merge')
                  : 'Back to Current Request'}
              </button>
            </div>
          ) : null}
        </SectionCard>
      ) : (
        <>
      {/* ── Section A: Current Directory Record(s) — active matches only ── */}
      {hasDirectory && (
        <div
          className={
            directoryPersons.length > 1
              ? 'max-h-[min(70vh,36rem)] space-y-4 overflow-y-auto pr-1'
              : undefined
          }
        >
          {directoryPersons.map((person, index) => (
              <SectionCard
                key={person.id || `dir-${index}`}
                icon={Database}
                title={
                  directoryPersons.length > 1
                    ? `Current Directory Record ${index + 1}`
                    : 'Current Directory Record'
                }
              >
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-8">
                  <MetaItem label="First Name" value={person.firstName} />
                  <MetaItem label="Last Name" value={person.lastName} />
                  <MetaItem label="Email" value={person.email} />
                  <MetaItem
                    label={isGll ? 'Gym Location' : (isHealthFitness ? 'Client' : 'Location')}
                    value={(person.location || '').trim() || 'No location'}
                  />
                  {isHealthFitness && (
                    <>
                      <MetaItem
                        label="Director First Name"
                        value={person.directorFirst || person.person?.directorFirst || '—'}
                      />
                      <MetaItem
                        label="Director Last Name"
                        value={person.directorLast || person.person?.directorLast || '—'}
                      />
                    </>
                  )}
                  {(!isGll && (terms.isJdGyms || Boolean(person.role || person.person?.role))) && (
                    <MetaItem
                      label="Role"
                      value={(person.role || person.person?.role || '').trim() || 'No role'}
                    />
                  )}
                </dl>
                {index === directoryPersons.length - 1 ? (
                  <p className="mt-4 text-xs leading-relaxed text-[var(--color-text-muted)]">
                    {directoryPersons.length > 1 ? (
                      <>
                        These are existing active Directory records that also match this request.
                        When you choose{' '}
                        <span className="font-semibold text-[var(--color-text-secondary)]">
                          {resolvePrimaryLabel({ hasDirectory: true, action: currentRep?.action })}
                        </span>
                        , you will pick which record to update (nothing is pre-selected), then confirm the final values.
                        Archived matches are not listed.
                      </>
                    ) : currentRep?.action === 'Remove' ? (
                      <>
                        This is the existing Directory record.{' '}
                        <span className="font-semibold text-[var(--color-text-secondary)]">Keep Existing and Delete</span>
                        {' '}removes the new request.{' '}
                        <span className="font-semibold text-[var(--color-text-secondary)]">Keep Existing and Archive</span>
                        {' '}archives the Remove request without changing Directory.{' '}
                        <span className="font-semibold text-[var(--color-text-secondary)]">Remove and Update</span>
                        {' '}marks this Directory person as removed.
                      </>
                    ) : (
                      <>
                        This is the existing Directory record.{' '}
                        <span className="font-semibold text-[var(--color-text-secondary)]">Keep Existing and Delete</span>
                        {' '}removes the new request.{' '}
                        <span className="font-semibold text-[var(--color-text-secondary)]">Keep Existing and Add New</span>
                        {' '}creates a separate Directory person.{' '}
                        <span className="font-semibold text-[var(--color-text-secondary)]">Add and Update</span>
                        {' '}overwrites this record.
                      </>
                    )}
                  </p>
                ) : null}
              </SectionCard>
          ))}
        </div>
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
                {showKeepExistingDelete ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={openKeepConfirm}
                    className={BTN_SECONDARY}
                  >
                    {deleteNewRequestLabel(members.length > 1)}
                  </button>
                ) : null}
                {showKeepExistingAddOrArchive && currentRep?.action !== 'Remove' ? (
                  <button
                    type="button"
                    disabled={!isFormValid || submitting || isEditing}
                    onClick={openAddAsNewConfirm}
                    className={BTN_SECONDARY}
                  >
                    Keep Existing and Add New
                  </button>
                ) : null}
                {showKeepExistingAddOrArchive && currentRep?.action === 'Remove' ? (
                  <button
                    type="button"
                    disabled={!isFormValid || submitting || isEditing}
                    onClick={openKeepAndArchiveConfirm}
                    className={BTN_SECONDARY}
                  >
                    Keep Existing and Archive
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!isFormValid || submitting || isEditing}
                  onClick={openMergeConfirm}
                  className={BTN_PRIMARY}
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {resolvePrimaryLabel({
                    hasDirectory,
                    action: currentRep?.action,
                    submitting,
                  })}
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

      {/* ── Step 2: Multi-match Directory selection (radio; no default) ── */}
      <Modal
        isOpen={confirmAction === 'select_directory'}
        onClose={closeConfirmModal}
        closeDisabled={submitting}
        title={
          currentRep?.action === 'Remove'
            ? 'Which Directory record should be archived and updated?'
            : 'Which Directory record should be updated?'
        }
        footer={
          <>
            <button
              type="button"
              onClick={closeConfirmModal}
              disabled={submitting}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || !selectedDirectoryId}
              onClick={() => openDirectoryConfirm(selectedDirectoryId)}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Continue to confirmation
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          More than one active Directory record matches this request. Choose exactly one to
          {' '}{currentRep?.action === 'Remove' ? 'archive and update' : 'update'}
          , then confirm the final values on the next step. Nothing is selected yet.
          Archived Directory records are not listed.
        </p>
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Matching active Directory records</legend>
          {directoryPersons.map((person, index) => {
            const id = person.id;
            const checked = selectedDirectoryId === id;
            const name = [person.firstName, person.lastName].filter(Boolean).join(' ').trim() || 'Unknown';
            const locLabel = isGll ? 'Gym Location' : (isHealthFitness ? 'Client' : 'Location');
            return (
              <label
                key={id || name}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors ${
                  checked
                    ? 'border-[var(--color-brand-primary)] bg-[var(--color-surface-highlight)]'
                    : 'border-[var(--color-border-default)] bg-white hover:bg-[var(--color-surface-bg)]'
                }`}
              >
                <input
                  type="radio"
                  name="directory-target"
                  className="mt-1"
                  checked={checked}
                  disabled={submitting || !id}
                  onChange={() => id && setSelectedDirectoryId(id)}
                />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
                    Directory record {index + 1}: {name}
                  </span>
                  <span className="block text-xs text-[var(--color-text-secondary)]">
                    Email: {(person.email || '').trim() || 'No email'}
                  </span>
                  <span className="block text-xs text-[var(--color-text-secondary)]">
                    {locLabel}: {((person.location || '').trim() || 'No location')}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </Modal>

      {/* ── Directory resolve OR peer consolidate confirmation ── */}
      {(() => {
        const selectedDirPerson =
          directoryPersons.find((p) => p.id === selectedDirectoryId)
          || (selectedDirectoryId ? dirPerson : null);
        const dirScenario = hasDirectory && confirmAction === 'merge'
          ? directoryResolveScenario({ action: currentRep?.action })
          : null;
        return (
      <Modal
        isOpen={confirmAction === 'merge' || confirmAction === 'peers_merge'}
        onClose={closeConfirmModal}
        closeDisabled={submitting || mergeEditing}
        title={
          confirmAction === 'peers_merge'
            ? 'Merge requests?'
            : (dirScenario?.title || `${resolvePrimaryLabel({ hasDirectory, action: currentRep?.action })}?`)
        }
        footer={
          <>
            <button
              type="button"
              onClick={closeConfirmModal}
              disabled={submitting || mergeEditing}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                submitting
                || !(mergeEditing ? draftForm : form).firstName.trim()
                || !(mergeEditing ? draftForm : form).lastName.trim()
                || mergeEditing
                || (hasDirectory && confirmAction === 'merge' && !selectedDirectoryId)
              }
              onClick={confirmAction === 'peers_merge' ? handleConfirmPeersMerge : handleConfirmMerge}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {confirmAction === 'peers_merge'
                ? (submitting ? 'Merging…' : 'Merge')
                : (submitting
                  ? (dirScenario?.submittingLabel || resolvePrimaryLabel({ hasDirectory, action: currentRep?.action, submitting: true }))
                  : (dirScenario?.confirmLabel || resolvePrimaryLabel({ hasDirectory, action: currentRep?.action })))}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          {confirmAction === 'peers_merge'
            ? `These ${incomingMemberCount()} new requests will be merged into the person below, and the older versions will be removed. Directory stays unchanged for now. After this, choose ${hasDirectory ? 'Keep Existing' : 'Delete New Request'} or ${resolvePrimaryLabel({ hasDirectory, action: currentRep?.action })} on the current request.`
            : hasDirectory
            ? (dirScenario?.body || 'The selected Directory record will be updated with the final resolved values below, and the requests in this group will be closed.')
            : currentRep?.action === 'Remove'
            ? (directoryIsArchived
              ? 'The request will be completed as Remove User. The existing archived Directory record stays unchanged, and the requests in this group will be closed.'
              : 'The final resolved values will be used, and the person will be marked as removed in the Directory. The requests in this group will be closed.')
            : 'A new Directory record will be created from the final resolved values, and the requests in this group will be closed.'}
        </p>
        {hasDirectory && selectedDirPerson && confirmAction === 'merge' ? (
          <div className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)]/60 px-3.5 py-2.5 text-xs text-[var(--color-text-secondary)]">
            <div className="min-w-0">
              <span className="font-semibold text-[var(--color-text-primary)]">Updating Directory record: </span>
              {[selectedDirPerson.firstName, selectedDirPerson.lastName].filter(Boolean).join(' ') || 'Unknown'}
              {' · '}
              {selectedDirPerson.email || 'No email'}
              {' · '}
              {((selectedDirPerson.location || '').trim() || 'No location')}
            </div>
            {directoryPersons.length > 1 ? (
              <button
                type="button"
                disabled={submitting || mergeEditing}
                onClick={openDirectorySelect}
                className="shrink-0 text-xs font-semibold text-[var(--color-brand-secondary)] underline-offset-2 hover:underline cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                Change selection
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)]/60 p-3.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Final resolved values
            </p>
            {!mergeEditing ? (
              <button
                type="button"
                onClick={startMergeEdit}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-default)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-brand-primary)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={saveMergeEdit}
                disabled={submitting || !draftForm.firstName.trim() || !draftForm.lastName.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
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
        );
      })()}

      {/* ── First-name check (before Keep / Add New when names differ) ── */}
      <Modal
        isOpen={confirmAction === 'nickname_check'}
        onClose={closeConfirmModal}
        closeDisabled={submitting}
        title={
          (nicknameModalPair || nicknameCheckPair())?.isNickname
            ? 'Is this the right nickname?'
            : 'Different first names'
        }
        footer={
          <>
            <button
              type="button"
              onClick={continueAfterNicknameNo}
              disabled={submitting}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              No, different people
            </button>
            <button
              type="button"
              onClick={continueAfterNicknameYes}
              disabled={submitting}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
            >
              Yes, same person
            </button>
          </>
        }
      >
        {(() => {
          const pair = nicknameModalPair || nicknameCheckPair();
          const requestName = pair?.requestFirst || '—';
          const directoryName = pair?.directoryFirst || '—';
          const isNickname = Boolean(pair?.isNickname);
          return (
            <>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {isNickname ? (
                  <>
                    Is{' '}
                    <span className="font-semibold text-[var(--color-text-primary)]">{requestName}</span>
                    {' '}a nickname for{' '}
                    <span className="font-semibold text-[var(--color-text-primary)]">{directoryName}</span>
                    ?
                  </>
                ) : (
                  <>
                    The new request is{' '}
                    <span className="font-semibold text-[var(--color-text-primary)]">{requestName}</span>
                    {' '}and Directory is{' '}
                    <span className="font-semibold text-[var(--color-text-primary)]">{directoryName}</span>
                    . Are they the same person?
                  </>
                )}
              </p>
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                {pendingConfirmAction === 'add_as_new'
                  ? (isNickname
                    ? 'Your Yes or No only updates nickname matching. Either way, the Directory stays unchanged and this request is added as a new Directory person.'
                    : 'Your Yes or No only records whether these first names are the same person for matching. Either way, the Directory stays unchanged and this request is added as a new Directory person.')
                  : (isNickname
                    ? 'Your Yes or No only updates nickname matching. Either way, the Directory stays unchanged and the new request is deleted.'
                    : 'Your Yes or No only records whether these first names are the same person for matching. Either way, the Directory stays unchanged and the new request is deleted.')}
              </p>
            </>
          );
        })()}
      </Modal>

      {/* ── Keep / Delete New Request confirmation ── */}
      <Modal
        isOpen={confirmAction === 'keep'}
        onClose={closeConfirmModal}
        closeDisabled={submitting}
        title={
          !hasDirectory
            ? (incomingMemberCount() > 1 ? 'Delete new requests?' : 'Delete new request?')
            : (incomingMemberCount() > 1 ? 'Keep existing and delete new requests?' : 'Keep existing and delete new request?')
        }
        footer={
          <>
            <button
              type="button"
              onClick={closeConfirmModal}
              disabled={submitting}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleKeepExisting}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
            >
              {submitting
                ? (hasDirectory ? 'Resolving…' : 'Deleting…')
                : (hasDirectory ? 'Keep Existing' : 'Delete')}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          {hasDirectoryLink
            ? (incomingMemberCount() > 1
                ? (hasDirectory
                  ? `The existing Directory record will remain unchanged. All ${incomingMemberCount()} incoming requests in this group will be deleted, and no Directory changes will be made.`
                  : `The archived Directory record stays unchanged. All ${incomingMemberCount()} incoming requests in this group will be deleted.`)
                : (hasDirectory
                  ? 'The Directory record will stay unchanged. The incoming request will be closed without writing new values.'
                  : 'The archived Directory record stays unchanged. The incoming request will be deleted.'))
            : 'No Directory record will be created. Incoming requests in this group will be closed and discarded.'}
        </p>
      </Modal>

      {/* ── Not the same person — add as new ── */}
      <Modal
        isOpen={confirmAction === 'add_as_new'}
        onClose={closeConfirmModal}
        closeDisabled={submitting}
        title="Keep existing and add new?"
        footer={
          <>
            <button
              type="button"
              onClick={closeConfirmModal}
              disabled={submitting}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || !isFormValid}
              onClick={() => handleAddAsNew(modalValues || form)}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Adding…' : 'Keep Existing and Add New'}
            </button>
          </>
        }
      >
        {(() => {
          const values = modalValues || form;
          return (
            <>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {incomingMemberCount() > 1
                  ? `The existing Directory record will stay unchanged. The ${incomingMemberCount()} matching new requests will be merged into the one person below, that person is added to Directory, the other new requests are removed, and they will not be linked again as a duplicate of that Directory record.`
                  : 'The existing Directory record will stay unchanged. This request will be added as a separate new person, and they will not be linked again as a duplicate of that Directory record.'}
              </p>
              <div className="mt-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)]/60 p-3.5">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  New Directory person
                </p>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <MetaItem label="First Name" value={values.firstName || '—'} />
                  <MetaItem label="Last Name" value={values.lastName || '—'} />
                  <MetaItem label="Email" value={values.email || '—'} />
                  <MetaItem
                    label={isGll ? 'Gym Location' : (isHealthFitness ? 'Client' : 'Location')}
                    value={(values.location || '').trim() || 'No location'}
                  />
                </dl>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* ── Remove false positive — keep Directory and archive Remove request ── */}
      <Modal
        isOpen={confirmAction === 'keep_and_archive'}
        onClose={closeConfirmModal}
        closeDisabled={submitting || mergeEditing}
        title="Keep existing and archive?"
        footer={
          <>
            <button
              type="button"
              onClick={closeConfirmModal}
              disabled={submitting || mergeEditing}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                submitting
                || !(mergeEditing ? draftForm : (modalValues || form)).firstName?.trim()
                || !(mergeEditing ? draftForm : (modalValues || form)).lastName?.trim()
                || mergeEditing
              }
              onClick={() => handleKeepAndArchive(mergeEditing ? draftForm : (modalValues || form))}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Archiving…' : 'Keep Existing and Archive'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          The existing Directory record will stay unchanged. This Remove request will be archived with the values below, and it will not be linked again as a duplicate of that Directory record.
        </p>
        <div className="mt-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)]/60 p-3.5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Archived Remove request values
            </p>
            {!mergeEditing ? (
              <button
                type="button"
                onClick={startMergeEdit}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-default)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-brand-primary)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={saveMergeEdit}
                disabled={submitting || !draftForm.firstName.trim() || !draftForm.lastName.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:opacity-60 cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Save
              </button>
            )}
          </div>

          {!mergeEditing ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <MetaItem label="First Name" value={(modalValues || form).firstName || '—'} />
              <MetaItem label="Last Name" value={(modalValues || form).lastName || '—'} />
              <MetaItem label="Email" value={(modalValues || form).email || '—'} />
              <MetaItem
                label={isGll ? 'Gym Location' : (isHealthFitness ? 'Client' : 'Location')}
                value={((modalValues || form).location || '').trim() || 'No location'}
              />
              {isHealthFitness && (
                <>
                  <MetaItem label="Director First Name" value={(modalValues || form).directorFirst || '—'} />
                  <MetaItem label="Director Last Name" value={(modalValues || form).directorLast || '—'} />
                </>
              )}
              {(!isGll && (terms.isJdGyms || Boolean((modalValues || form).role))) && (
                <MetaItem label="Role" value={((modalValues || form).role || '').trim() || 'No role'} />
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
        <label htmlFor="keep-archive-confirm-note" className="mt-4 block w-full">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Admin note <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <textarea
            id="keep-archive-confirm-note"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="Saved with the resolution record"
            rows={2}
            className="mt-2 w-full resize-none rounded-lg border border-[var(--color-border-default)] bg-white px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-brand-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-secondary)]/15"
          />
        </label>
      </Modal>

      {/* ── Transfer to a separated lookalike ── */}
      <Modal
        isOpen={attachLookalikeOpen}
        onClose={closeAttachLookalikeModal}
        closeDisabled={submitting}
        title="Transfer to a similar request?"
        footer={
          <>
            <button
              type="button"
              onClick={closeAttachLookalikeModal}
              disabled={submitting}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || !attachLookalikeId}
              onClick={handleConfirmAttachLookalike}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Transferring…' : 'Transfer'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          Choose which request to transfer this to. Only one can be selected.
          The current request will leave this group and join that request. Other similar
          requests stay separate.
        </p>
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Similar requests</legend>
          {(group.separatedLookalikeRequests || []).map((lookalike) => {
            const label = formatRequestDisplayId(lookalike.displayId || lookalike.id);
            const inputId = `attach-lookalike-${lookalike.id}`;
            return (
              <label
                key={lookalike.id}
                htmlFor={inputId}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-sm transition-colors ${
                  attachLookalikeId === lookalike.id
                    ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/5'
                    : 'border-[var(--color-border-default)] bg-white hover:bg-[var(--color-surface-highlight)]'
                }`}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="attach-lookalike"
                  value={lookalike.id}
                  checked={attachLookalikeId === lookalike.id}
                  onChange={() => setAttachLookalikeId(lookalike.id)}
                  className="h-4 w-4 shrink-0 accent-[var(--color-brand-primary)]"
                />
                <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">
                  {label}
                </span>
              </label>
            );
          })}
        </fieldset>
      </Modal>

      {/* ── Unlink step-by-step modal ── */}
      <Modal
        isOpen={!!unlinkTargetId}
        onClose={() => {
          if (submitting || unlinkEditing) return;
          setUnlinkTargetId(null);
          setUnlinkStep(null);
          setUnlinkActionType(null);
        }}
        closeDisabled={submitting || unlinkEditing}
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
                    disabled={submitting || unlinkEditing || (!unlinkForm?.firstName?.trim() || !unlinkForm?.lastName?.trim())}
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
                disabled={submitting || unlinkEditing}
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
                disabled={submitting}
                onClick={() => setUnlinkStep('review')}
                className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={submitting || !unlinkTargetId}
                onClick={() => handleUnlink(unlinkTargetId, unlinkActionType, unlinkForm)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-white text-sm font-semibold rounded-lg bg-[var(--color-brand-primary)] hover:bg-[var(--color-surface-sidebar-hover)] shadow-sm cursor-pointer disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Processing…</span>
                  </>
                ) : (
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
                        disabled={submitting}
                        onClick={() => {
                          if (submitting) return;
                          setUnlinkDraft(unlinkForm);
                          setUnlinkEditing(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-default)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel)] hover:text-[var(--color-brand-primary)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (submitting) return;
                          if (!unlinkDraft.firstName.trim() || !unlinkDraft.lastName.trim()) return;
                          setUnlinkForm(unlinkDraft);
                          setUnlinkEditing(false);
                        }}
                        disabled={submitting || !unlinkDraft.firstName.trim() || !unlinkDraft.lastName.trim()}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand-primary)] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
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
          if (submitting) return;
          setDeleteTarget(null);
          setDeleteImpact(null);
        }}
        closeDisabled={submitting}
        title="Delete request"
        footer={
          <>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                if (submitting) return;
                setDeleteTarget(null);
                setDeleteImpact(null);
              }}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
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
        onClose={() => {
          if (submitting) return;
          setMarkUnlinkedTarget(null);
        }}
        closeDisabled={submitting}
        confirm
        title="Confirm action"
        footer={
          <>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                if (submitting) return;
                setMarkUnlinkedTarget(null);
              }}
              className="px-4 py-2 border border-[var(--color-border-default)] rounded-lg text-sm font-medium text-[var(--color-text-primary)] hover:bg-white transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
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
