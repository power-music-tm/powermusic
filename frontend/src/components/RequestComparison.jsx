import { useMemo } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { formatAdminDateTime } from '../utils/requestDisplayId';
import {
  autoMailFromDirectoryRecord,
  hasAnyDataDiffs,
  hasComparisonContext,
} from '../utils/requestComparison';
import {
  isAdminEntry,
  formatAttributedManagerFields,
  MANUAL_ENTRY_CLUB,
  NO_MANAGER_EMAIL,
  NO_MANAGER_LOCATION,
  NO_MANAGER_NAME,
  SENT_BY_ADMIN_LABEL,
} from '../utils/manualEntry';
import { ADMIN_FORM_LABEL, TAG_AUTO_MAIL, TAG_PARTNER_REQUEST, TAG_SENT_BY_ADMIN } from '../utils/requestTags';
import { getPartnerTerminology } from '../utils/managerAuthBranding';
import { usePartners } from '../context/PartnerContext';

const norm = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') {
    const role = (value.role || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const name = (value.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const email = (value.email || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const club = (value.club || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return `${role}|${name}|${email}|${club}`;
  }
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
};

const hasValue = (value) => {
  if (value == null) return false;
  if (typeof value === 'object') {
    if (value.kind === 'admin-details-link') return true;
    return Boolean(
      (value.role || '').trim()
      || (value.name || '').trim()
      || (value.email || '').trim()
      || (value.club || '').trim(),
    );
  }
  return String(value).trim() !== '';
};

const PERSON_FIELD_ROWS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email', mono: true },
  { key: 'location', label: 'Location' },
  { key: 'directorFirst', label: 'Director First Name' },
  { key: 'directorLast', label: 'Director Last Name' },
  { key: 'role', label: 'Role' },
];

/**
 * One matrix: fields as rows, sources as columns.
 * Fits the available page width (table-fixed, wrapping) — no horizontal scroll.
 */
function ComparisonMatrix({ sources, embedded = false, includeManagerRow = false, locationLabel = 'Location', isHealthFitness = false, isJdGyms = false }) {
  const rows = [
    ...PERSON_FIELD_ROWS
      .filter(({ key }) => key !== 'role' || isJdGyms)
      .filter(({ key }) => (key !== 'directorFirst' && key !== 'directorLast') || isHealthFitness)
      .map((r) => r.key === 'location' ? { ...r, label: locationLabel } : r)
      .filter(({ key }) => sources.some((source) => source.values[key])),
    ...(includeManagerRow ? [{ key: 'manager', label: 'Sent by' }] : []),
  ];

  const anchor = sources[0];
  const fieldColClass =
    'w-[5.5rem] bg-[var(--color-brand-secondary-muted)] px-2.5 text-center align-middle text-[var(--color-brand-secondary)] sm:w-24 sm:px-3';
  const titleBorder = 'border-[var(--color-brand-secondary)]';

  return (
    <div
      className={
        embedded
          ? 'min-w-0 overflow-hidden bg-white'
          : 'min-w-0 overflow-hidden rounded-xl border border-[var(--color-brand-secondary)] bg-white'
      }
    >
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm leading-normal">
        <caption className="sr-only">
          Person details from each source. Highlighted values differ from the first column.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className={`${fieldColClass} border-b ${titleBorder} py-2.5 text-[11px] font-semibold uppercase tracking-wide`}
            >
              Field
            </th>
            {sources.map((source) => (
              <th
                key={source.key}
                scope="col"
                className={`border-b ${titleBorder} bg-[var(--color-brand-secondary-muted)] px-2.5 py-2.5 text-center align-middle sm:px-3`}
              >
                <span className="block text-[12px] font-semibold leading-snug text-[var(--color-brand-secondary)] sm:text-[13px]">
                  {source.title}
                </span>
                {source.caption ? (
                  <span className="mt-0.5 block text-[10px] font-normal normal-case leading-snug text-[var(--color-brand-secondary)]/80 sm:text-[11px]">
                    {source.caption}
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, mono }, rowIndex) => {
            const presentValues = sources
              .map((s) => s.values[key])
              .filter(hasValue);
            const conflict =
              key !== 'manager'
              && presentValues.length > 1
              && new Set(presentValues.map(norm)).size > 1;
            const isLastRow = rowIndex === rows.length - 1;

            return (
              <tr key={key}>
                <th
                  scope="row"
                  className={`${fieldColClass} border-r ${titleBorder} py-3 text-sm font-semibold`}
                >
                  {label}
                  {conflict ? (
                    <span className="mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-[var(--color-brand-accent)]">
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                      Conflict
                    </span>
                  ) : null}
                </th>
                {sources.map((source, i) => {
                  const value = source.values[key];
                  const differs =
                    conflict &&
                    i !== 0 &&
                    hasValue(value) &&
                    norm(value) !== norm(anchor.values[key]);

                  return (
                    <td
                      key={`${source.key}-${key}`}
                      className={`px-2.5 py-3 text-center align-middle sm:px-3 ${
                        isLastRow ? '' : 'border-b border-[var(--color-border-default)]'
                      } ${
                        differs ? 'bg-[var(--color-brand-accent)]/10' : 'bg-white'
                      }`}
                    >
                      <div className="flex flex-col items-center justify-center">
                        <span
                          className={`block min-w-0 text-center ${
                            mono
                              ? 'truncate font-mono text-[12px] sm:text-[13px]'
                              : 'break-words [overflow-wrap:anywhere]'
                          } ${
                            differs
                              ? 'font-semibold text-[var(--color-brand-accent)]'
                              : 'font-medium text-[var(--color-text-primary)]'
                          }`}
                          title={typeof value === 'string' ? value : undefined}
                        >
                          {key === 'manager' ? (
                            renderManagerValue(value, differs, isHealthFitness)
                          ) : (
                            <>
                              {value || <span className="text-[var(--color-text-muted)]">-</span>}
                              {differs ? (
                                <span className="sr-only"> (differs from {anchor.title})</span>
                              ) : null}
                            </>
                          )}
                        </span>
                        {differs && key !== 'manager' ? (
                          <span className="mt-1 flex items-center justify-center text-[var(--color-brand-accent)]" aria-label="Field differs">
                            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TableReviewCell({ hasDiffs: showYes, onViewDetails }) {
  if (!showYes) {
    return (
      <span className="block text-center text-xs font-medium text-[var(--color-text-muted)]">No</span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-x-1 text-center text-xs font-medium text-[var(--color-text-muted)]">
      <span className="text-[var(--color-text-muted)]">Yes</span>
      <span aria-hidden="true">·</span>
      {onViewDetails ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onViewDetails();
          }}
          className="font-semibold text-[var(--color-brand-secondary)] hover:underline"
        >
          View details
        </button>
      ) : (
        <span className="font-semibold text-[var(--color-brand-secondary)]">View details</span>
      )}
    </span>
  );
}

function renderManagerValue(value, differs, isHealthFitness = false) {
  if (value?.kind === 'admin-details-link') {
    const href = value.href || '#admin-form-heading';
    return (
      <>
        <span className={`block text-[11px] font-semibold uppercase tracking-wide ${differs ? '' : 'text-[var(--color-text-secondary)]'}`}>
          Admin
        </span>
        <span className="mt-0.5 block text-[12px] font-normal leading-snug text-[var(--color-text-secondary)] sm:text-[13px]">
          Manager details added
        </span>
        <a
          href={href}
          className="mt-1 inline-block text-[12px] font-semibold text-[var(--color-brand-secondary)] hover:underline"
          onClick={(event) => {
            event.preventDefault();
            const target = document.getElementById(href.replace(/^#/, ''));
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          View
        </a>
      </>
    );
  }
  const parsed = parseManagerValue(value);
  if (!parsed.role && !parsed.name && !parsed.email && !parsed.club) {
    return <span className="text-[var(--color-text-muted)]">-</span>;
  }
  const isPlaceholder = (text) => (
    text === NO_MANAGER_NAME
    || text === NO_MANAGER_EMAIL
    || text === NO_MANAGER_LOCATION
  );
  const secondaryClass = differs
    ? ''
    : 'font-normal text-[var(--color-text-secondary)]';
  const placeholderClass = 'font-normal text-[var(--color-text-muted)]';
  return (
    <>
      {parsed.role ? (
        <span className={`block text-[11px] font-semibold uppercase tracking-wide ${differs ? '' : 'text-[var(--color-text-secondary)]'}`}>
          {parsed.role}
        </span>
      ) : null}
      {parsed.name ? (
        <span className={`block ${parsed.role ? 'mt-0.5' : ''} ${isPlaceholder(parsed.name) ? placeholderClass : ''}`.trim()}>
          {parsed.name}
        </span>
      ) : null}
      {!isHealthFitness && parsed.email ? (
        <span className={`mt-0.5 block text-[12px] sm:text-[13px] ${isPlaceholder(parsed.email) ? placeholderClass : `font-mono ${secondaryClass}`}`.trim()}>
          {parsed.email}
        </span>
      ) : null}
      {!isHealthFitness && parsed.club ? (
        <span className={`mt-0.5 block text-[12px] sm:text-[13px] ${isPlaceholder(parsed.club) ? placeholderClass : secondaryClass}`.trim()}>
          {parsed.club}
        </span>
      ) : null}
    </>
  );
}

function parseManagerValue(value) {
  if (!value) return { role: '', name: '', email: '', club: '' };
  if (typeof value === 'object') {
    return {
      role: (value.role || '').trim(),
      name: (value.name || '').trim(),
      email: (value.email || '').trim(),
      club: (value.club || '').trim(),
    };
  }
  const text = String(value).trim();
  const paren = text.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    return { role: '', name: paren[1].trim(), email: paren[2].trim(), club: '' };
  }
  if (text.includes('\n')) {
    const [name, ...rest] = text.split('\n');
    return { role: '', name: name.trim(), email: rest.join('\n').trim(), club: '' };
  }
  if (text.includes('@')) return { role: '', name: '', email: text, club: '' };
  return { role: '', name: text, email: '', club: '' };
}

function managerCell({ role = '', name = '', email = '', club = '' } = {}) {
  const displayRole = (role || '').trim();
  const displayName = (name || '').trim();
  const displayEmail = (email || '').trim();
  const displayClub = (club || '').trim();
  if (!displayName && !displayEmail && !displayClub) {
    // Role-only is allowed for Auto email / Admin so the label still shows.
    const roleKey = displayRole.toLowerCase();
    if (roleKey !== 'auto email' && roleKey !== 'admin') return null;
  }
  if (!displayRole && !displayName && !displayEmail && !displayClub) return null;
  return {
    role: displayRole,
    name: displayName,
    email: displayEmail,
    club: displayClub,
  };
}

function directorySenderFromRecord(directoryRecord) {
  const name = (directoryRecord?.managerName || '').trim();
  const email = (directoryRecord?.managerEmail || '').trim();
  const club = (directoryRecord?.club || '').trim();
  if (name || email || club) {
    return managerCell({
      role: 'Manager',
      name,
      email,
      club,
    });
  }

  const history = Array.isArray(directoryRecord?.requestHistory)
    ? directoryRecord.requestHistory
    : [];
  const autoEvent = history.find((event) => {
    if (event?.type !== 'auto_mail') return false;
    return Boolean((event.fromEmail || '').trim());
  });
  if (autoEvent) {
    return managerCell({
      role: 'Auto email',
      email: autoEvent.fromEmail,
    });
  }
  return null;
}

function personValuesFromRequest(requestPerson) {
  if (!requestPerson) return null;
  const first = (requestPerson.firstName || '').trim();
  const last = (requestPerson.lastName || '').trim();
  const name = [first, last].filter((part) => part && part.toLowerCase() !== 'null').join(' ');
  return {
    name,
    email: (requestPerson.email || '').trim(),
    location: (requestPerson.location || '').trim(),
    role: (requestPerson.role || requestPerson.person?.role || '').trim(),
    directorFirst: (requestPerson.directorFirst || requestPerson.person?.directorFirst || '').trim(),
    directorLast: (requestPerson.directorLast || requestPerson.person?.directorLast || '').trim(),
  };
}

export default function RequestComparison({
  intakeMatch,
  directoryMatch,
  directory = [],
  requestPerson,
  requestManager = null,
  adminPerson = null,
  adminSubmittedBy = null,
  autoSenderEmail = null,
  managerSubmittedAt = null,
  autoReceivedAt = null,
  tags = [],
  managerId = null,
  submittedBy = null,
  variant = 'table',
  needsReview = false,
  duplicateGroupId = null,
  onViewDetails,
  className = '',
  embedded = false,
  partnerName = null,
  partnerSlug = null,
}) {
  const { selectedPartner } = usePartners();
  const terms = getPartnerTerminology(
    partnerName || selectedPartner?.name,
    partnerSlug || selectedPartner?.slug,
  );
  const directoryRecord = useMemo(() => {
    if (!directoryMatch) return null;
    const byId = directory.find((record) => record.id === directoryMatch.directoryId);
    if (byId) return byId;
    const matchEmail = (
      directoryMatch.fields?.find((f) => f.field === 'email')?.rightValue
      || ''
    ).trim().toLowerCase();
    if (!matchEmail) return null;
    return directory.find(
      (record) => (record.email || '').trim().toLowerCase() === matchEmail,
    ) || null;
  }, [directory, directoryMatch]);

  const anyDiffs = hasAnyDataDiffs(intakeMatch, directoryMatch, adminPerson);
  const hasContext = hasComparisonContext(intakeMatch, directoryMatch, tags, adminPerson);
  const showNeedsReview = Boolean(needsReview || duplicateGroupId || anyDiffs);

  if (variant === 'table') {
    return (
      <div
        className={`flex min-w-0 items-center justify-center ${className}`.trim()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <TableReviewCell hasDiffs={showNeedsReview} onViewDetails={onViewDetails} />
      </div>
    );
  }

  if (!hasContext) return null;

  const intakeField = (field, side) =>
    intakeMatch?.fields?.find((f) => f.field === field)?.[side] || '';

  const adminEntry = isAdminEntry({ tags, managerId, submittedBy });
  const hasAdminOverlay = (tags || []).includes(TAG_SENT_BY_ADMIN) || Boolean(adminPerson);
  const hasManagerForm = (tags || []).includes(TAG_PARTNER_REQUEST)
    || Boolean(intakeMatch?.fields?.some((field) => (field.leftValue || '').trim()));
  const directoryAuto = autoMailFromDirectoryRecord(directoryRecord);
  const hasAutoMail = (tags || []).includes(TAG_AUTO_MAIL)
    || Boolean(intakeMatch?.fields?.some((field) => (field.rightValue || '').trim()))
    || Boolean(autoSenderEmail)
    || Boolean(directoryAuto?.fromEmail || directoryAuto?.receivedAt);

  const requestPersonValues = personValuesFromRequest(requestPerson);
  const adminPersonValues = personValuesFromRequest(adminPerson);
  const adminManagerFields = formatAttributedManagerFields(adminSubmittedBy, { partnerName, partnerSlug });

  const includeDirectory = Boolean(directoryRecord || directoryMatch);
  const directoryManager = directorySenderFromRecord(directoryRecord);
  const senderRole = adminEntry && !hasAdminOverlay ? 'Admin' : terms.managerTerm;
  const requestManagerValue = typeof requestManager === 'object' && requestManager !== null
    ? (() => {
        const rawName = (requestManager.name || '').trim();
        const name = (rawName === 'Admin' || rawName === SENT_BY_ADMIN_LABEL) && adminEntry
          ? ''
          : rawName;
        const email = (requestManager.email || '').trim();
        const club = (requestManager.club || '').trim();
        const clubDisplay = club === MANUAL_ENTRY_CLUB ? '' : club;
        return managerCell({
          role: senderRole,
          name,
          email,
          club: clubDisplay,
        }) || (adminEntry && !hasAdminOverlay ? managerCell({ role: 'Admin' }) : null);
      })()
    : (() => {
        const parsed = parseManagerValue(requestManager);
        const rawName = (parsed.name || '').trim();
        const name = (rawName === 'Admin' || rawName === SENT_BY_ADMIN_LABEL) && adminEntry
          ? ''
          : rawName;
        const club = (parsed.club || '').trim();
        const clubDisplay = club === MANUAL_ENTRY_CLUB ? '' : club;
        return managerCell({
          role: adminEntry || name || parsed.email || clubDisplay ? senderRole : '',
          name,
          email: parsed.email,
          club: clubDisplay,
        }) || (adminEntry && !hasAdminOverlay ? managerCell({ role: 'Admin' }) : null);
      })();
  const adminSenderValue = adminManagerFields.hasAny
    ? {
      kind: 'admin-details-link',
      href: '#admin-form-heading',
    }
    : managerCell({ role: 'Admin' });
  const effectiveAutoEmail = (autoSenderEmail || directoryAuto?.fromEmail || '').trim();
  const effectiveAutoAt = autoReceivedAt || directoryAuto?.receivedAt || null;
  const autoSenderValue = managerCell({
    role: 'Auto email',
    email: effectiveAutoEmail,
  });

  const primarySourceTitle = adminEntry && !hasAdminOverlay ? ADMIN_FORM_LABEL : `${terms.managerTerm} request`;

  const sources = [
    hasManagerForm
      ? {
          key: 'manager',
          title: primarySourceTitle,
          caption: managerSubmittedAt
            ? formatAdminDateTime(managerSubmittedAt)
            : '',
          values: {
            name: intakeField('name', 'leftValue') || requestPersonValues?.name || '',
            email: intakeField('email', 'leftValue') || requestPersonValues?.email || '',
            location: intakeField('location', 'leftValue') || requestPersonValues?.location || '',
            role: intakeField('role', 'leftValue') || requestPersonValues?.role || '',
            manager: requestManagerValue,
          },
        }
      : null,
    hasAdminOverlay
      ? {
          key: 'admin',
          title: ADMIN_FORM_LABEL,
          caption: '',
          values: {
            name: adminPersonValues?.name || '',
            email: adminPersonValues?.email || '',
            location: adminPersonValues?.location || '',
            role: adminPersonValues?.role || '',
            manager: adminSenderValue,
          },
        }
      : null,
    hasAutoMail
      ? {
          key: 'auto',
          title: 'Automated email',
          caption: effectiveAutoAt
            ? formatAdminDateTime(effectiveAutoAt)
            : '',
          values: {
            name: intakeField('name', 'rightValue')
              || (directoryRecord
                ? `${directoryRecord.firstName || ''} ${directoryRecord.lastName || ''}`.trim()
                : '')
              || requestPersonValues?.name
              || '',
            email: intakeField('email', 'rightValue')
              || directoryRecord?.email
              || requestPersonValues?.email
              || '',
            location: intakeField('location', 'rightValue')
              || directoryRecord?.location
              || requestPersonValues?.location
              || '',
            role: intakeField('role', 'rightValue')
              || directoryRecord?.role
              || directoryRecord?.person?.role
              || requestPersonValues?.role
              || '',
            manager: autoSenderValue,
          },
        }
      : null,
    includeDirectory
      ? {
          key: 'directory',
          title: 'Already in Directory',
          caption: directoryRecord?.dateAdded
            ? `Added ${formatAdminDateTime(directoryRecord.dateAdded)}`
            : 'Existing record',
          values: directoryRecord
            ? {
                name: `${directoryRecord.firstName || ''} ${directoryRecord.lastName || ''}`.trim(),
                email: directoryRecord.email,
                location: directoryRecord.location,
                role: directoryRecord.role || directoryRecord.person?.role || '',
                manager: directoryManager,
              }
            : {
                name: directoryMatch?.directoryName || '',
                email: directoryMatch?.fields?.find((f) => f.field === 'email')?.rightValue || '',
                location:
                  directoryMatch?.fields?.find((f) => f.field === 'location')?.rightValue || '',
                role: directoryMatch?.fields?.find((f) => f.field === 'role')?.rightValue || '',
                manager: directoryManager,
              },
        }
      : null,
  ].filter(Boolean);

  const includeSentByRow = sources.some((source) => hasValue(source.values.manager));

  return (
    <div className={`min-w-0 w-full ${className}`.trim()}>
      <ComparisonMatrix
        sources={sources}
        embedded={embedded}
        includeManagerRow={includeSentByRow || includeDirectory}
        locationLabel={terms.locationTerm}
        isHealthFitness={terms.isHealthFitness}
        isJdGyms={terms.isJdGyms}
      />
    </div>
  );
}
