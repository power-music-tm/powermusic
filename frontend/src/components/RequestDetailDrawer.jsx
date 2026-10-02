import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Mail,
  MapPin,
  UserRound,
  X,
} from 'lucide-react';
import { Tag, HoverTip } from './ui';
import RequestComparison from './RequestComparison';
import {
  autoMailFromDirectoryRecord,
  hasAnyDataDiffs,
  hasComparisonContext,
  hasMultipleComparisonSources,
} from '../utils/requestComparison';
import {
  formatAttributedManagerFields,
  getManagerDisplayName,
  isAdminEntry,
  isManualEntry,
  MANUAL_ENTRY_CLUB,
} from '../utils/manualEntry';
import {
  TAG_AUTO_MAIL,
  TAG_SENT_BY_ADMIN,
  displayRequestTags,
  requestTagLabel,
  requestTagVariant,
  isAwaitingManagerSubmission,
  isAutomatedIntakeRequest,
} from '../utils/requestTags';
import { getPartnerTerminology } from '../utils/managerAuthBranding';
import { usePartners } from '../context/PartnerContext';
import { formatRequestDisplayId, formatAdminDateTime } from '../utils/requestDisplayId';
import { formatManagerNotes, readAutomatedSubject, readLeaveDate, readManagerNotes } from '../utils/managerNotes';
import { formatPersonFields, formatPersonName } from '../utils/personDisplay';

function initials(person) {
  const name = formatPersonName(person, { empty: '' });
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  }
  if (parts.length === 1) return (parts[0].slice(0, 2) || '?').toUpperCase();
  return '?';
}

function MetaItem({ label, value, mono = false, showEmpty = false }) {
  if (!value && !showEmpty) return null;
  const text = value == null ? '' : String(value);
  const isPlaceholder = /^(No name|No email|No location|No club)$/i.test(text);
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-brand-secondary)]/75">
        {label}
      </dt>
      <dd
        className={`mt-1 break-words text-sm ${
          isPlaceholder
            ? 'font-normal text-[var(--color-text-muted)]'
            : `text-[var(--color-text-primary)] ${mono ? 'font-mono text-[13px]' : 'font-medium'}`
        }`}
      >
        {text || <span className="text-[var(--color-text-muted)]">-</span>}
      </dd>
    </div>
  );
}

function SourceInfoBlock({ id, title, icon: Icon, children, empty, compact = false, className = '' }) {
  const body = empty || children;
  const isCompact = compact || !body;
  return (
    <section
      aria-labelledby={id}
      className={`${isCompact ? 'py-0' : 'py-7'}${className ? ` ${className}` : ''}`}
    >
      <div className={`relative overflow-hidden rounded-r-2xl border-l-[3px] border-l-[var(--color-brand-secondary)] bg-gradient-to-br from-white via-white to-[var(--color-surface-bg)] pl-4 pr-4 shadow-[0_1px_0_rgba(26,26,46,0.04)] sm:pl-5 sm:pr-5 ${
        isCompact ? 'py-2.5' : 'py-5'
      }`}>
        <div
          className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[var(--color-brand-secondary)]/[0.05]"
          aria-hidden="true"
        />
        <div className={`relative flex items-center gap-3${body ? ' mb-4' : ''}`}>
          <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-white/80 text-[var(--color-brand-secondary)] shadow-[0_1px_0_rgba(26,26,46,0.04)] ring-1 ring-[var(--color-brand-secondary-border)]/45 ${
            isCompact ? 'h-7 w-7' : 'h-9 w-9'
          }`}>
            <Icon className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
          </span>
          <h2
            id={id}
            className="text-sm font-semibold tracking-tight text-[var(--color-brand-secondary)]"
          >
            {title}
          </h2>
        </div>
        {body ? <div className="relative">{body}</div> : null}
      </div>
    </section>
  );
}

export default function RequestDetailView({
  request,
  directory = [],
  onConfirmAction,
}) {
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    setNoteText('');
  }, [request?.id]);

  if (!request) return null;

  const { selectedPartner, partners } = usePartners();
  const rawPartnerId = request.partnerId || request.partner_id;
  const matchedPartner = partners?.find((p) => String(p.id) === String(rawPartnerId)) || selectedPartner;
  const partnerName = request.partnerName || request.partner_name || matchedPartner?.name;
  const partnerSlug = request.partnerSlug || request.partner_slug || rawPartnerId || matchedPartner?.slug;
  const terms = getPartnerTerminology(partnerName, partnerSlug);
  const awaitingManager = isAwaitingManagerSubmission(request.tags);
  const adminEntry = isAdminEntry(request);
  const hasAdminOverlay = (request.tags || []).includes(TAG_SENT_BY_ADMIN)
    || Boolean(request.adminPerson);
  const adminOverlayFields = formatAttributedManagerFields(request.adminSubmittedBy, {
    partnerName: request.partnerName,
    partnerSlug: request.partnerSlug,
  });
  const directoryRecord = directory.find(
    (record) => record.id === request.directoryMatch?.directoryId,
  )
    || directory.find((record) => {
      const matchEmail = (
        request.directoryMatch?.fields?.find((f) => f.field === 'email')?.rightValue
        || request.person?.email
        || ''
      ).trim().toLowerCase();
      if (!matchEmail) return false;
      return (record.email || '').trim().toLowerCase() === matchEmail;
    })
    || null;
  const directoryAuto = autoMailFromDirectoryRecord(directoryRecord);
  const hasRequestAutoMail = isAutomatedIntakeRequest(request.tags)
    || Boolean(request.automatedEmail)
    || (request.tags || []).includes(TAG_AUTO_MAIL);
  const hasAutoMail = hasRequestAutoMail
    || Boolean(directoryAuto?.fromEmail || directoryAuto?.receivedAt || directoryAuto?.subject);
  const isAdd = request.action === 'Add';
  const isAlreadyExistsOrRemoved = Boolean(directoryRecord) && (
    (request.tags || []).includes('already_exists') ||
    (request.tags || []).includes('already_removed') ||
    request.intakeMatch?.classification?.startsWith('already_') ||
    request.directoryMatch?.classification?.startsWith('already_')
  );
  const heroPersonSource = (isAlreadyExistsOrRemoved && directoryRecord) ? directoryRecord : request.person;
  const { name: personFullName, email: personEmail, location: personLocation } = formatPersonFields(
    heroPersonSource,
  );

  const notesText = readManagerNotes(request);
  const automatedSubject = readAutomatedSubject(request)
    || (directoryAuto?.subject || '').trim();
  const leaveDate = readLeaveDate(request);
  const hasConflicts = hasAnyDataDiffs(
    request.intakeMatch,
    request.directoryMatch,
    request.adminPerson,
  );
  // Deprecated comparison matrix: current duplicate-group workflow uses GroupResolutionView instead.
  const showComparison = false;
  const clubLabel = awaitingManager
    ? null
    : (() => {
      const club = (request.submittedBy?.club || '').trim();
      if (adminEntry || isManualEntry(request.submittedBy)) {
        return club && club !== MANUAL_ENTRY_CLUB ? club : null;
      }
      return club || null;
    })();
  const secondaryTags = displayRequestTags(request.tags || [], { isAdminEntry: adminEntry });
  const attributedFields = formatAttributedManagerFields(request.submittedBy);
  const attributedManager = attributedFields.hasAny;
  const hasAdminOverlayDetails = hasAdminOverlay && adminOverlayFields.hasAny;
  // Real manager sender, or pure admin entry showing attributed/manager fields in the primary block.
  const hasManagerSender = !awaitingManager && (
    (!adminEntry && Boolean(request.managerId || getManagerDisplayName(request.submittedBy, request.tags, request)))
    || (adminEntry && attributedManager)
  );
  // For overlay rows, the primary card is the real manager — not admin attribution.
  const managerDetails = awaitingManager
    ? null
    : adminEntry
      ? (attributedManager
        ? {
          name: attributedFields.name,
          email: attributedFields.email,
          club: attributedFields.club,
        }
        : { name: '', email: '', club: '' })
      : {
        name: getManagerDisplayName(request.submittedBy, request.tags, request),
        email: request.submittedBy?.email || '',
        club: clubLabel || '',
      };
  const personDisplayName = formatPersonName(request.person, {
    empty: formatRequestDisplayId(request.displayId) || 'Request',
  });
  const autoFromEmail = (
    request.automatedEmail?.fromEmail
    || directoryAuto?.fromEmail
    || ''
  ).trim();
  const autoInboxEmail = (
    request.automatedEmail?.inboxEmail
    || directoryAuto?.inboxEmail
    || ''
  ).trim();
  const autoReceivedAt = request.automatedEmail?.receivedAt
    || (hasRequestAutoMail ? request.receivedAt : null)
    || directoryAuto?.receivedAt
    || null;

  return (
    <div className="relative z-0 min-w-0 w-full bg-[var(--color-surface-bg)] pb-16 select-none">
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
          <li
            aria-current="page"
            className="min-w-0 truncate font-medium text-[var(--color-text-primary)]"
          >
            {personDisplayName}
          </li>
        </ol>
        {secondaryTags.length > 0 ? (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <span
              className="mr-1.5 hidden h-4 w-px shrink-0 self-center bg-[var(--color-border-default)] sm:block"
              aria-hidden="true"
            />
            {secondaryTags.map((tag) => (
              <Tag
                key={tag}
                variant={requestTagVariant(tag)}
                label={requestTagLabel(tag)}
                compact={false}
              />
            ))}
          </div>
        ) : null}
      </nav>

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
                    {personFullName}
                  </h1>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-text-secondary)]">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate font-mono text-[13px] text-[var(--color-text-primary)]">
                        {personEmail}
                      </span>
                    </span>
                    {!terms.isGll && (
                      <>
                        <span className="text-[var(--color-border-default)]" aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="text-[var(--color-text-primary)]">{personLocation}</span>
                        </span>
                      </>
                    )}
                  </p>
                  {terms.isHealthFitness && (
                    <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                      <span className="font-semibold uppercase tracking-wider text-[var(--color-brand-secondary)]">Director: </span>
                      <span className="font-semibold text-[var(--color-text-primary)]">
                        {[
                          request.directorFirst || request.person?.directorFirst,
                          request.directorLast || request.person?.directorLast,
                        ].filter(Boolean).join(' ') || 'No director'}
                      </span>
                    </p>
                  )}
                </div>

                <Tag
                  variant={isAdd ? 'add-action' : 'remove-action'}
                  label={isAdd ? 'Add person' : 'Remove person'}
                />
              </div>

              <div className="mt-4 border-t border-[var(--color-border-default)] pt-4">
                <p className="text-xs text-[var(--color-text-muted)]">
                  <span className="font-medium text-[var(--color-text-secondary)]">
                    {formatRequestDisplayId(request.displayId)}
                  </span>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  {formatAdminDateTime(request.receivedAt)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {showComparison ? (
        <section aria-labelledby="comparison-heading" className="min-w-0 pt-8 pb-8">
          <div
            className={`mb-4 flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 border px-3.5 py-2.5 ${
              hasConflicts
                ? 'border-[var(--color-tag-removed-text)] bg-[var(--color-tag-removed-bg)] text-[var(--color-tag-removed-text)]'
                : 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)] text-white'
            }`}
          >
            {hasConflicts ? (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-white" aria-hidden="true" />
            )}
            <h2
              id="comparison-heading"
              className="text-sm font-semibold tracking-tight"
            >
              Source comparison
            </h2>
            <span
              className={`hidden h-3.5 w-px shrink-0 sm:block ${
                hasConflicts ? 'bg-[var(--color-tag-removed-text)]/25' : 'bg-white/30'
              }`}
              aria-hidden="true"
            />
            <p
              className={`min-w-0 flex-1 text-sm ${
                hasConflicts ? 'text-[var(--color-tag-removed-text)]/90' : 'text-white/90'
              }`}
              role="status"
            >
              {hasConflicts
                ? `Sources disagree. Review fields below, then ${isAdd ? 'add' : 'remove'} in Power Music.`
                : `Sources match. ${isAdd ? 'Add' : 'Remove'} in Power Music, then mark complete.`}
            </p>
            <X
              className={`ml-auto h-4 w-4 shrink-0 self-center ${
                hasConflicts ? 'text-[var(--color-tag-removed-text)]' : 'text-white'
              }`}
              aria-hidden="true"
            />
          </div>
          <RequestComparison
            intakeMatch={request.intakeMatch}
            directoryMatch={request.directoryMatch}
            directory={directory}
            requestPerson={request.person}
            requestManager={managerDetails}
            adminPerson={request.adminPerson}
            adminSubmittedBy={request.adminSubmittedBy}
            autoSenderEmail={autoFromEmail}
            managerSubmittedAt={request.receivedAt}
            autoReceivedAt={autoReceivedAt}
            tags={request.tags}
            managerId={request.managerId}
            submittedBy={request.submittedBy}
            variant="detail"
          />
        </section>
      ) : null}

      <SourceInfoBlock
        id="manager-heading"
        className={awaitingManager || (adminEntry && !attributedManager && !hasAdminOverlay) ? 'mt-5' : 'mt-4'}
        title={
          awaitingManager
            ? `No ${terms.managerTermLower} request yet`
            : hasManagerSender && hasAdminOverlayDetails
              ? 'Sent by'
              : adminEntry
                ? 'Entered via Admin form'
                : hasManagerSender
                  ? `Sent by ${terms.managerTerm} Form`
                  : hasAdminOverlayDetails
                    ? `${terms.managerTerm} details from Admin form`
                    : 'Sent by'
        }
        icon={UserRound}
      >
        {!awaitingManager && (hasManagerSender || hasAdminOverlayDetails) ? (
          <div className="space-y-6">
            {hasManagerSender ? (
              <div>
                {hasManagerSender && hasAdminOverlayDetails ? (
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-secondary)]">
                    {terms.managerTerm} Form
                  </h3>
                ) : null}
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-x-8">
                  <MetaItem
                    label={`${terms.managerTerm} name`}
                    value={
                      attributedManager && adminEntry
                        ? attributedFields.name
                        : getManagerDisplayName(request.submittedBy, request.tags, request)
                    }
                  />
                  <MetaItem
                    label={`${terms.managerTerm} email`}
                    value={
                      attributedManager && adminEntry
                        ? attributedFields.email
                        : (request.submittedBy?.email || null)
                    }
                    mono={!(attributedManager && adminEntry) || Boolean(attributedFields.rawEmail)}
                  />
                  <MetaItem
                    label={`${terms.managerTerm} ${terms.locationTermLower}`}
                    value={
                      terms.isGll
                        ? ((attributedManager && adminEntry ? attributedFields.club : clubLabel) || '').trim() || 'No location'
                        : (attributedManager && adminEntry ? attributedFields.club : clubLabel)
                    }
                  />
                </dl>

                <div className="mt-5">
                  <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-brand-secondary)]/75">
                    {terms.managerTerm} notes
                  </h3>
                  <p
                    className={`max-w-3xl text-sm leading-relaxed whitespace-pre-wrap ${
                      notesText
                        ? 'text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] italic'
                    }`}
                  >
                    {formatManagerNotes(request)}
                  </p>
                </div>

                {terms.isJdGyms && (
                  <div className="mt-5">
                    <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-brand-secondary)]/75">
                      Role
                    </h3>
                    <p
                      className={`max-w-3xl text-sm leading-relaxed whitespace-pre-wrap ${
                        (request.role || request.person?.role)?.trim()
                          ? 'text-[var(--color-text-primary)] font-medium'
                          : 'text-[var(--color-text-muted)] italic'
                      }`}
                    >
                      {(request.role || request.person?.role)?.trim() || 'No role'}
                    </p>
                  </div>
                )}

                {terms.isGll && (
                  <div className="mt-5">
                    <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-brand-secondary)]/75">
                      Gym Location
                    </h3>
                    <p
                      className={`max-w-3xl text-sm leading-relaxed whitespace-pre-wrap ${
                        (request.person?.location || '').trim()
                          ? 'text-[var(--color-text-primary)] font-medium'
                          : 'text-[var(--color-text-muted)] italic'
                      }`}
                    >
                      {(request.person?.location || '').trim() || 'No location'}
                    </p>
                  </div>
                )}
                {terms.isHealthFitness && (
                  <div className="mt-5">
                    <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-brand-secondary)]/75">
                      Director
                    </h3>
                    <p
                      className={`max-w-3xl text-sm leading-relaxed whitespace-pre-wrap ${
                        (request.directorFirst || request.directorLast || request.person?.directorFirst || request.person?.directorLast)
                          ? 'text-[var(--color-text-primary)] font-medium'
                          : 'text-[var(--color-text-muted)] italic'
                      }`}
                    >
                      {[
                        request.directorFirst || request.person?.directorFirst,
                        request.directorLast || request.person?.directorLast,
                      ]
                        .filter(Boolean)
                        .join(' ') || 'No director'}
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {hasAdminOverlayDetails ? (
              <div
                id="admin-form-heading"
                className={hasManagerSender ? 'border-t border-[var(--color-border-default)] pt-6' : undefined}
              >
                {hasManagerSender ? (
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-secondary)]">
                    Admin form
                  </h3>
                ) : null}
                <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
                  Optional {terms.managerTermLower} details entered when this was added via Admin form.
                </p>
                <dl className={`grid grid-cols-1 gap-4 ${terms.isHealthFitness || terms.isGll ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} sm:gap-x-8`}>
                  <MetaItem label={`${terms.managerTerm} name`} value={adminOverlayFields.name} />
                  {!terms.isHealthFitness && (
                    <>
                      <MetaItem
                        label={`${terms.managerTerm} email`}
                        value={adminOverlayFields.email}
                        mono={Boolean(adminOverlayFields.rawEmail)}
                      />
                      <MetaItem
                        label={`${terms.managerTerm} ${terms.locationTermLower}`}
                        value={terms.isGll ? ((adminOverlayFields.club || '').trim() || 'No location') : adminOverlayFields.club}
                      />
                    </>
                  )}
                </dl>
              </div>
            ) : null}
          </div>
        ) : null}
      </SourceInfoBlock>

      <SourceInfoBlock
        id="automated-email-heading"
        title={
          hasAutoMail
            ? (hasRequestAutoMail
              ? 'Automated email received'
              : 'Previously received via automated email')
            : 'No automated email'
        }
        icon={Mail}
      >
        {hasAutoMail ? (
          <>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-x-8">
              <MetaItem label="Received from" value={autoFromEmail || null} mono showEmpty />
              <MetaItem label="Inbox" value={autoInboxEmail || null} mono showEmpty />
              <MetaItem
                label="Received at"
                value={autoReceivedAt ? formatAdminDateTime(autoReceivedAt) : null}
                showEmpty
              />
              {leaveDate ? (
                <MetaItem label="Leave date" value={leaveDate} />
              ) : null}
            </dl>

            {automatedSubject ? (
              <div className="mt-5">
                <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-brand-secondary)]/75">
                  Details
                </h3>
                <p className="max-w-3xl text-sm leading-relaxed text-[var(--color-text-primary)]">
                  {automatedSubject}
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </SourceInfoBlock>

      <section aria-labelledby="finish-heading" className="py-7">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border-default)] bg-white py-5 px-4 sm:px-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-bg)] text-[var(--color-text-secondary)] ring-1 ring-[var(--color-border-default)]">
              <Check className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2
                id="finish-heading"
                className="text-sm font-semibold tracking-tight text-[var(--color-text-primary)]"
              >
                {isAdd ? 'Add User' : 'Remove User'}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                Confirm only after you’ve {isAdd ? 'added' : 'removed'} {personFullName} in Power Music.
              </p>
            </div>
          </div>

          <label htmlFor="request-detail-note" className="block w-full">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              Admin note <span className="normal-case tracking-normal">(optional)</span>
            </span>
            <textarea
              id="request-detail-note"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Saved with the directory record"
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3.5 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-brand-secondary)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-secondary)]/15"
            />
          </label>

          <div className="mt-5 flex justify-end border-t border-[var(--color-border-default)] pt-4">
            <button
              type="button"
              onClick={() => onConfirmAction(request, noteText.trim())}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-primary)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-surface-sidebar-hover)]"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {isAdd ? 'Add User' : 'Remove User'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
