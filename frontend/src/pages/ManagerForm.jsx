import { useState, useMemo, useEffect, useRef, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { formatAdminDate } from '../utils/dateTime';
import { Toast, useToast } from '../components/ui';
import { fetchJson } from '../utils/api';
import { clearCache, getManagerPartnerBranding } from '../utils/pilot2Api';
import { waitForSubmissionJob } from '../utils/managerSubmissionJobs';
import { useAuth } from '../context/AuthContext';
import {
  readManagerFormDraft,
  writeManagerFormDraft,
  clearManagerFormDraft,
  EMPTY_PERSON_FORM,
  MAX_MANAGER_PERSON_ROWS,
  normalizePersonFormsFromDraft,
} from '../utils/managerFormDraft';
import {
  filterDirectorySearch,
  findFormMatchCandidates,
  formHasMatchCriteria,
  getSearchQueryHint,
  isUsableSearchQuery,
} from '../utils/managerDirectory';
import {
  PERSON_FIELD_LIMITS,
  sanitizePersonFieldInput,
  validatePersonForms,
  firstInvalidPersonField,
} from '../utils/managerFormValidation';
import ManagerRequestHistoryPanel from '../components/manager/ManagerRequestHistoryPanel';
import { useManagerRequestPortal } from '../components/manager/ManagerRequestHistory';
import ManagerFormHeader from '../components/manager/ManagerFormHeader';
import ManagerPortalHero from '../components/manager/ManagerPortalHero';
import ManagerRequestChoice from '../components/manager/ManagerRequestChoice';
import ManagerPortalIntro, {
  cacheManagerPortalBranding,
  clearManagerIntroSeen,
  markManagerIntroSeen,
  readCachedManagerPortalBranding,
  shouldShowManagerPortalIntro,
} from '../components/manager/ManagerPortalIntro';
import { getPublicPartnerBranding } from '../utils/pilot2Api';
import { getPartnerTerminology } from '../utils/managerAuthBranding';
import { FlowGradientBackground } from '../components/ui/flow-gradient-hero-section';
import { useManagerDirectory } from '../hooks/useManagerDirectory';
import ManagerPartnerLinkConflict from '../components/auth/ManagerPartnerLinkConflict';
import { ManagerAuthLoading } from '../components/auth/ManagerAuthShell';
import {
  partnerSlugFromName,
  readCachedPartnerSlugBranding,
} from '../utils/partnerSlugBrandingCache';
import { instantPartnerBrandingFromSlug } from '../utils/managerAuthBranding';
import {
  clearManagerIntendedPartnerSlug,
  readManagerIntendedPartnerSlug,
} from '../utils/managerPartnerLinkIntent';
import { signOutToManagerAuth } from '../utils/managerPartnerConflictSignOut';
import { getManagerPartnerLinkConflict } from '../utils/managerPartnerLinkConflict';

const formCardClass =
  'overflow-hidden rounded-2xl border border-[var(--color-manager-border)] bg-[var(--color-manager-panel)] shadow-[var(--shadow-manager-form)]';

const workspaceShellClass = 'mx-auto w-full max-w-[1520px]';

const workspaceOuterClass = 'flex min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-5';

const workspaceSplitClass =
  'flex min-h-0 flex-1 flex-col gap-5 sm:gap-6 lg:flex-row lg:items-stretch lg:gap-6';

const workspaceFormColumnClass =
  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-manager-border)] bg-white p-4 sm:p-5';

const workspaceDirectoryColumnClass =
  'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--color-manager-border-strong)] bg-[var(--color-manager-directory)] p-5 sm:p-6 lg:w-[44%] xl:w-[42%] lg:min-w-[420px] lg:max-w-[620px]';

const directorySectionClass =
  'flex min-h-0 flex-1 flex-col gap-5 overflow-hidden sm:gap-6';

const directorySearchInputClass =
  'w-full h-11 rounded-xl border border-[var(--color-manager-border-strong)] bg-white px-3.5 pl-10 text-sm text-[var(--color-text-primary)] shadow-[0_1px_3px_rgba(26,26,46,0.05)] placeholder:text-[var(--color-text-muted)] transition-[border-color,box-shadow] focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/15 disabled:cursor-not-allowed disabled:bg-[var(--color-manager-panel)]';

const directoryResultsClass =
  'overflow-hidden rounded-xl border border-[var(--color-manager-border-strong)] bg-white shadow-[0_4px_18px_rgba(26,26,46,0.06)]';

const directoryTableHeadClass =
  'border-b border-[var(--color-manager-border)] bg-[var(--color-manager-panel)]';

const inputClass =
  'w-full h-10 rounded-lg border border-[var(--color-manager-border-strong)] bg-white px-3.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-[border-color,box-shadow] focus:border-[var(--color-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/15 disabled:cursor-not-allowed disabled:bg-[var(--color-manager-panel)]';

const invalidInputClass =
  'border-red-300 focus:border-red-400 focus:ring-red-200/60';

const textareaClass = `${inputClass} h-auto resize-none py-2`;

const managerReadonlyInputClass =
  'w-full h-10 cursor-not-allowed rounded-lg border border-[var(--color-manager-border)] bg-[var(--color-manager-panel)] px-3.5 text-sm text-[var(--color-text-secondary)] shadow-none focus:outline-none focus:ring-0 disabled:opacity-100';

const readonlyLabelClass = 'mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]';

const labelClass = 'mb-1.5 block text-xs font-medium text-[var(--color-text-primary)]';

const sectionTitleClass =
  'text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-secondary)]';

const directorySectionTitleClass =
  'text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-primary)]';

const managerGridClass = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4';

function Field({ id, label, required, hint, error, children, labelMuted = false }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className={labelMuted ? readonlyLabelClass : labelClass}>
        {label}
        {required && (
          <>
            <span className="text-[var(--color-brand-accent)]" aria-hidden="true">
              {' '}
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </label>
      {typeof children === 'function'
        ? children({ errorId, describedBy, invalid: Boolean(error) })
        : children}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-[11px] text-red-600">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
          {hint}
        </p>
      )}
    </div>
  );
}

function FormSection({ title, children }) {
  return (
    <fieldset className="m-0 space-y-3 border-0 border-t border-[var(--color-manager-border)] p-0 pt-5 first:border-t-0 first:pt-0">
      <legend className={sectionTitleClass}>{title}</legend>
      {children}
    </fieldset>
  );
}

function directoryRowMatchesForm(row) {
  return Array.isArray(row.matchReasons) && row.matchReasons.length > 0;
}

function formatDirectoryDate(dateStr) {
  if (!dateStr) return null;
  return formatAdminDate(dateStr) || null;
}

function activeFormUserIndexes(personForms) {
  return personForms
    .map((form, index) => (formHasMatchCriteria(form) ? index + 1 : null))
    .filter(Boolean);
}

function directoryResultsEmptyMessage({
  hasSearchQuery,
  hasFormCriteria,
  isSearchTooBroad,
  isHealthFitness = false,
  isRemoveAction = false,
  managerLocation = '',
}) {
  if (isSearchTooBroad) return 'Nothing matched that search. Try a name or email address.';
  if (hasSearchQuery) return 'No one matched that search.';
  if (hasFormCriteria) return 'No directory matches for the details entered on the left yet.';
  if (isHealthFitness) {
    return isRemoveAction ? 'No removed users found.' : 'No active directory users found.';
  }
  const loc = managerLocation ? ` for ${managerLocation}` : '';
  return isRemoveAction ? `No removed users found${loc}.` : `No active directory users found${loc}.`;
}

function directoryLiveStatusMessage({
  personForms,
  formMatchResults,
  hasSearchQuery,
  displayResults,
  multipleUsers,
  isHealthFitness = false,
  isRemoveAction = false,
  totalCount = 0,
  managerLocation = '',
}) {
  const activeUsers = activeFormUserIndexes(personForms);

  if (formMatchResults.length > 0) {
    if (multipleUsers && activeUsers.length > 1) {
      return `${formMatchResults.length} possible match${formMatchResults.length === 1 ? '' : 'es'} across User ${activeUsers.join(', User ')}. Highlighted on the right.`;
    }
    return `${formMatchResults.length} possible match${formMatchResults.length === 1 ? '' : 'es'} from your form. Highlighted rows on the right.`;
  }

  if (!hasSearchQuery) {
    const term = isRemoveAction ? 'removed' : 'active directory';
    if (isHealthFitness) {
      return `${totalCount} ${term} user${totalCount === 1 ? '' : 's'} shown by default. Search by name, email, or client to filter.`;
    }
    const locText = managerLocation ? ` for ${managerLocation}` : '';
    return `${totalCount} ${term} user${totalCount === 1 ? '' : 's'}${locText} shown by default. Search by name, email, or location to filter.`;
  }

  if (activeUsers.length > 0) {
    if (multipleUsers) {
      return `Watching User ${activeUsers.join(', User ')} as you type. Matches appear beside your form.`;
    }
    return 'Watching your entries as you type. Matches appear beside your form.';
  }

  if (hasSearchQuery && displayResults.length > 0) {
    return `${displayResults.length} search result${displayResults.length === 1 ? '' : 's'} shown.`;
  }

  return 'Enter person details on the left or search here. Results update as you type.';
}

export default function ManagerForm() {
  const formId = useId();
  const { showToast } = useToast();
  const { profile, user, session, logout } = useAuth();
  const navigate = useNavigate();
  const draftRestoredRef = useRef(false);

  const [submitted, setSubmitted] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(1);
  const [requestRefreshToken, setRequestRefreshToken] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [partnerBranding, setPartnerBranding] = useState(() => readCachedManagerPortalBranding());
  const [partnerBrandingReady, setPartnerBrandingReady] = useState(false);
  const [partnerConflictDismissed, setPartnerConflictDismissed] = useState(false);
  const [portalIntro, setPortalIntro] = useState(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [flowStep, setFlowStep] = useState('choose');
  const introCheckedRef = useRef(false);
  const [action, setAction] = useState('Add');
  const directoryOutcome = action === 'Remove' ? 'Removed' : 'Added';
  const formActive = flowStep === 'form';
  const { people: directoryPeople, loading: directoryLoading, error: directoryError } =
    useManagerDirectory(user?.id, session?.access_token, {
      enabled: formActive && !submitted && Boolean(user?.id && session?.access_token),
      outcome: directoryOutcome,
      partnerId: partnerBranding?.partnerId,
    });
  const [searchInput, setSearchInput] = useState('');
  const [directorFirstName, setDirectorFirstName] = useState('');
  const [directorLastName, setDirectorLastName] = useState('');

  const [personForms, setPersonForms] = useState([{ ...EMPTY_PERSON_FORM }]);
  const [touchedFields, setTouchedFields] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const personFieldRefs = useRef({});
  const directorySectionRef = useRef(null);

  const { totalBadgeCount, ...requestPortal } =
    useManagerRequestPortal(requestRefreshToken, requestsOpen);

  const closeRequestHistory = () => {
    requestPortal.closeHistory();
    setRequestsOpen(false);
  };

  const managerDetails = useMemo(() => {
    const nameParts = (profile?.full_name || '').trim().split(/\s+/).filter(Boolean);
    const rawClub = (profile?.club !== undefined && profile?.club !== null)
      ? profile.club
      : user?.user_metadata?.club;
    return {
      firstName: profile?.first_name || nameParts[0] || '',
      lastName: profile?.last_name || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : ''),
      email: profile?.email || user?.email || '',
      club: typeof rawClub === 'string' ? rawClub.trim() : '',
    };
  }, [profile, user]);

  const intendedSlug = readManagerIntendedPartnerSlug();
  const activePartnerSlug = partnerBranding?.partnerName
    ? partnerSlugFromName(partnerBranding.partnerName)
    : '';

  const terms = useMemo(
    () => getPartnerTerminology(partnerBranding?.partnerName, activePartnerSlug || intendedSlug),
    [partnerBranding?.partnerName, activePartnerSlug, intendedSlug],
  );
  const isHealthFitness = terms.isHealthFitness;
  const isGll = terms.isGll;
  const isJdGyms = terms.isJdGyms;

  const managerGridClass = isGll
    ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'
    : 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4';

  const personFieldIds = (index) => ({
    first: `${formId}-person-${index}-first`,
    last: `${formId}-person-${index}-last`,
    email: `${formId}-person-${index}-email`,
    location: `${formId}-person-${index}-location`,
    role: `${formId}-person-${index}-role`,
    notes: `${formId}-person-${index}-notes`,
  });

  const personValidation = useMemo(
    () =>
      validatePersonForms(personForms, {
        locationLabel: isHealthFitness ? 'User Client' : 'User Location',
        requiresLocation: !isGll,
      }),
    [personForms, isHealthFitness, isGll],
  );

  const touchKey = (index, field) => `${index}.${field}`;

  const shouldShowFieldError = (index, field) =>
    submitAttempted || Boolean(touchedFields[touchKey(index, field)]);

  const getFieldError = (index, field) => {
    if (!shouldShowFieldError(index, field)) return '';
    return personValidation.errorsByRow[index]?.[field] || '';
  };

  const setPersonFieldRef = (index, field, node) => {
    personFieldRefs.current[touchKey(index, field)] = node;
  };

  const ids = {
    managerFirst: `${formId}-manager-first`,
    managerLast: `${formId}-manager-last`,
    managerEmail: `${formId}-manager-email`,
    managerClub: `${formId}-manager-club`,
    search: `${formId}-search`,
  };

  useEffect(() => {
    if (!user?.id || submitted) return;

    const draft = readManagerFormDraft(user.id);
    if (!draft) {
      draftRestoredRef.current = false;
      return;
    }

    draftRestoredRef.current = true;
    setPersonForms(normalizePersonFormsFromDraft(draft));
    if (draft.action) setAction(draft.action);
    if (typeof draft.searchInput === 'string') setSearchInput(draft.searchInput);

    const hasDraftContent =
      (typeof draft.searchInput === 'string' && draft.searchInput.trim()) ||
      (Array.isArray(draft.personForms) &&
        draft.personForms.some((person) =>
          Object.values(person || {}).some((value) => String(value || '').trim()),
        ));

    if (draft.action && hasDraftContent) {
      setFlowStep('form');
    }
  }, [user?.id, submitted]);

  useEffect(() => {
    if (!user?.id || introCheckedRef.current) return;
    introCheckedRef.current = true;

    if (!shouldShowManagerPortalIntro(user.id)) {
      setPortalIntro(false);
      return;
    }

    const showIntro = (branding) => {
      if (branding?.partnerName) {
        setPartnerBranding((prev) => (prev?.partnerName ? prev : branding));
      }
      setPortalIntro(true);
    };

    const cached = readCachedManagerPortalBranding();
    if (cached?.partnerName) {
      showIntro(cached);
      return;
    }

    const email = profile?.email || user?.email;
    if (!email) {
      showIntro(null);
      return;
    }

    let active = true;
    getPublicPartnerBranding(email)
      .then((data) => {
        if (!active) return;
        if (data?.partnerName) cacheManagerPortalBranding(data);
        showIntro(data);
      })
      .catch(() => {
        if (active) showIntro(null);
      });

    return () => {
      active = false;
    };
  }, [user?.id, profile?.email, user?.email]);

  useEffect(() => {
    if (!session?.access_token) {
      setPartnerBrandingReady(true);
      return;
    }
    const partnerIdParam = partnerBranding?.partnerId || undefined;
    getManagerPartnerBranding(partnerIdParam)
      .then((data) => {
        if (data?.partnerName) {
          setPartnerBranding(data);
          cacheManagerPortalBranding(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        setPartnerBrandingReady(true);
      });
  }, [session?.access_token]);

  useEffect(() => {
    const intended = readManagerIntendedPartnerSlug();
    const sessionSlug = partnerBranding?.partnerName
      ? partnerSlugFromName(partnerBranding.partnerName)
      : '';
    if (intended && sessionSlug && intended === sessionSlug) {
      clearManagerIntendedPartnerSlug();
    }
  }, [partnerBranding?.partnerName]);

  useEffect(() => {
    if (portalIntro !== null) return undefined;
    const timer = window.setTimeout(() => setPortalIntro(false), 2000);
    return () => window.clearTimeout(timer);
  }, [portalIntro]);

  const handlePortalIntroComplete = () => {
    if (user?.id) markManagerIntroSeen(user.id);
    setPortalIntro(false);
  };

  useEffect(() => {
    if (!user?.id || submitted || !formActive) return undefined;

    const persistDraft = () => {
      const hasContent =
        personForms.some((person) => Object.values(person).some((v) => String(v).trim())) ||
        searchInput.trim();

      if (!hasContent) {
        clearManagerFormDraft(user.id);
        return;
      }

      writeManagerFormDraft(user.id, {
        personForms,
        action,
        searchInput,
      });
      draftRestoredRef.current = true;
    };

    const timer = window.setTimeout(persistDraft, 400);

    const handleHidden = () => {
      if (document.visibilityState === 'hidden') persistDraft();
    };
    window.addEventListener('visibilitychange', handleHidden);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('visibilitychange', handleHidden);
    };
  }, [user?.id, personForms, action, searchInput, submitted, formActive]);

  const handleSelectRequestType = (nextAction) => {
    setAction(nextAction);
    setFlowStep('form');
    setPersonForms([{ ...EMPTY_PERSON_FORM }]);
    setDirectorFirstName('');
    setDirectorLastName('');
    setTouchedFields({});
    setSubmitAttempted(false);
    setSearchInput('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToChoice = () => {
    setFlowStep('choose');
    setPersonForms([{ ...EMPTY_PERSON_FORM }]);
    setDirectorFirstName('');
    setDirectorLastName('');
    setTouchedFields({});
    setSubmitAttempted(false);
    setSearchInput('');
    if (user?.id) clearManagerFormDraft(user.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePersonChange = (index, field, val) => {
    const sanitized = sanitizePersonFieldInput(field, val);
    setPersonForms((prev) =>
      prev.map((person, rowIndex) =>
        rowIndex === index ? { ...person, [field]: sanitized } : person,
      ),
    );
  };

  const handlePersonBlur = (index, field) => {
    setTouchedFields((prev) => ({ ...prev, [touchKey(index, field)]: true }));
    if (field === 'email') {
      setPersonForms((prev) =>
        prev.map((person, rowIndex) =>
          rowIndex === index
            ? { ...person, email: person.email.trim().toLowerCase() }
            : person,
        ),
      );
    }
  };

  const handleAddPersonRow = () => {
    setPersonForms((prev) => {
      if (prev.length >= MAX_MANAGER_PERSON_ROWS) return prev;
      return [...prev, { ...EMPTY_PERSON_FORM }];
    });
  };

  const handleRemovePersonRow = (index) => {
    setPersonForms((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, rowIndex) => rowIndex !== index);
    });
  };

  const isFormValid = useMemo(
    () =>
      (isHealthFitness
        ? directorFirstName.trim() !== '' &&
          directorLastName.trim() !== '' &&
          managerDetails.firstName.trim() !== '' &&
          managerDetails.lastName.trim() !== '' &&
          managerDetails.email.trim() !== ''
        : isGll
          ? managerDetails.firstName.trim() !== '' &&
            managerDetails.lastName.trim() !== '' &&
            managerDetails.email.trim() !== ''
          : managerDetails.firstName.trim() !== '' &&
            managerDetails.lastName.trim() !== '' &&
            managerDetails.email.trim() !== '' &&
            managerDetails.club.trim() !== '') &&
      personForms.length > 0 &&
      personValidation.ok,
    [
      isHealthFitness,
      isGll,
      directorFirstName,
      directorLastName,
      managerDetails,
      personForms.length,
      personValidation.ok,
    ],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitAttempted(true);

    const validation = validatePersonForms(personForms, {
      locationLabel: isHealthFitness ? 'User Client' : 'User Location',
      requiresLocation: !isGll,
    });
    if (
      (isHealthFitness
        ? !directorFirstName.trim() ||
          !directorLastName.trim() ||
          !managerDetails.firstName.trim() ||
          !managerDetails.lastName.trim() ||
          !managerDetails.email.trim()
        : isGll
          ? !managerDetails.firstName.trim() ||
            !managerDetails.lastName.trim() ||
            !managerDetails.email.trim()
          : !managerDetails.firstName.trim() ||
            !managerDetails.lastName.trim() ||
            !managerDetails.email.trim() ||
            !managerDetails.club.trim()) ||
      !validation.ok
    ) {
      const firstInvalid = firstInvalidPersonField(validation.errorsByRow);
      if (firstInvalid) {
        const ref = personFieldRefs.current[touchKey(firstInvalid.rowIndex, firstInvalid.field)];
        ref?.focus?.();
        ref?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        showToast(firstInvalid.message, 'error');
      } else {
        showToast('Fill all required fields to submit.', 'error');
      }
      return;
    }

    if (submitting) return;

    const normalizedPeople = validation.normalizedForms;
    const submittedByPayload = isGll
      ? {
          firstName: managerDetails.firstName,
          lastName: managerDetails.lastName,
          email: managerDetails.email,
        }
      : managerDetails;

    setSubmitting(true);
    try {
      const endpoint =
        normalizedPeople.length === 1 ? '/api/requests' : '/api/requests/batch';
      const body =
        normalizedPeople.length === 1
          ? {
              submittedBy: submittedByPayload,
              partnerId: partnerBranding?.partnerId || undefined,
              person: {
                firstName: normalizedPeople[0].firstName,
                lastName: normalizedPeople[0].lastName,
                email: normalizedPeople[0].email,
                location: normalizedPeople[0].location?.trim() || undefined,
                role: isJdGyms && normalizedPeople[0].role?.trim() ? normalizedPeople[0].role.trim() : undefined,
                directorFirst: isHealthFitness ? directorFirstName.trim() : undefined,
                directorLast: isHealthFitness ? directorLastName.trim() : undefined,
              },
              action,
              notes: normalizedPeople[0].notes?.trim() || undefined,
            }
          : {
              submittedBy: submittedByPayload,
              partnerId: partnerBranding?.partnerId || undefined,
              people: normalizedPeople.map(({ firstName, lastName, email, location, role, notes }) => ({
                firstName,
                lastName,
                email,
                location: location?.trim() || undefined,
                role: isJdGyms && role?.trim() ? role.trim() : undefined,
                directorFirst: isHealthFitness ? directorFirstName.trim() : undefined,
                directorLast: isHealthFitness ? directorLastName.trim() : undefined,
                notes: notes?.trim() || undefined,
              })),
              action,
            };

      if (normalizedPeople.length === 1) {
        await fetchJson(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        const queued = await fetchJson(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (queued?.status === 'pending' || queued?.status === 'processing') {
          showToast('Processing your requests…', 'success');
          await waitForSubmissionJob(queued.jobId);
        } else if (queued?.status === 'failed') {
          throw new Error(queued.error || 'Could not process your batch submission.');
        }
      }

      const count = normalizedPeople.length;
      showToast(
        count === 1 ? 'Request submitted.' : `${count} requests submitted.`,
        'success',
      );
      if (user?.id) clearManagerFormDraft(user.id);
      clearCache('manager_requests_all');
      clearCache('manager_requests_summary');
      setSubmittedCount(count);
      setRequestRefreshToken((token) => token + 1);
      setSearchInput('');
      setDirectorFirstName('');
      setDirectorLastName('');
      setPersonForms([{ ...EMPTY_PERSON_FORM }]);
      setTouchedFields({});
      setSubmitAttempted(false);
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      const msg = err.message || 'Failed to submit request.';
      showToast(
        msg.includes('429') || msg.includes('Too many')
          ? 'Too many submissions. Please try again later.'
          : msg,
        'error',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAnotherRequest = () => {
    setSubmitted(false);
    setSubmittedCount(1);
    setPersonForms([{ ...EMPTY_PERSON_FORM }]);
    setDirectorFirstName('');
    setDirectorLastName('');
    setTouchedFields({});
    setSubmitAttempted(false);
    setSearchInput('');
    setAction('Add');
    setFlowStep('choose');
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (user?.id) {
        clearManagerFormDraft(user.id);
        clearManagerIntroSeen(user.id);
      }
      await logout();
      navigate('/submit/signup', { replace: true });
    } catch (err) {
      console.error(err);
      showToast('Could not sign out. Please try again.', 'error');
    } finally {
      setSigningOut(false);
    }
  };

  const hasSearchInput = searchInput.trim().length >= 2;
  const hasSearchQuery = isUsableSearchQuery(searchInput);
  const searchQueryHint = getSearchQueryHint(searchInput);
  const isSearchTooBroad = hasSearchInput && !hasSearchQuery;

  const searchResults = useMemo(
    () => filterDirectorySearch(directoryPeople, searchInput),
    [directoryPeople, searchInput],
  );

  const formMatchResults = useMemo(() => {
    const byId = new Map();

    for (const personForm of personForms) {
      for (const row of findFormMatchCandidates(directoryPeople, personForm)) {
        if (!row?.id) continue;
        const existing = byId.get(row.id);
        const reasons = new Set([
          ...(existing?.matchReasons || []),
          ...(row.matchReasons || []),
        ]);
        byId.set(row.id, {
          ...(existing || {}),
          ...row,
          matchReasons: [...reasons],
        });
      }
    }

    return Array.from(byId.values());
  }, [directoryPeople, personForms]);

  const formMatchUsersByRowId = useMemo(() => {
    const map = new Map();
    personForms.forEach((form, index) => {
      for (const row of findFormMatchCandidates(directoryPeople, form)) {
        if (!row?.id) continue;
        const users = map.get(row.id) || [];
        const label = index + 1;
        if (!users.includes(label)) users.push(label);
        map.set(row.id, users);
      }
    });
    return map;
  }, [directoryPeople, personForms]);

  const defaultLocationPeople = useMemo(() => {
    if (isHealthFitness || isGll) {
      return directoryPeople;
    }
    const managerLoc = (managerDetails.club || '').trim().toLowerCase();
    if (!managerLoc) {
      return directoryPeople;
    }
    return directoryPeople.filter((person) => {
      const personLoc = (person.location || '').trim().toLowerCase();
      return personLoc === managerLoc;
    });
  }, [directoryPeople, isHealthFitness, isGll, managerDetails.club]);

  const displayResults = useMemo(() => {
    const byId = new Map();

    const mergeRow = (row, source) => {
      if (!row?.id) return;
      const existing = byId.get(row.id);
      const reasons = new Set([
        ...(existing?.matchReasons || []),
        ...(row.matchReasons || []),
      ]);

      byId.set(row.id, {
        ...(existing || {}),
        ...row,
        matchReasons: [...reasons],
        fromFormMatch: source === 'form' || existing?.fromFormMatch,
        fromManualSearch: source === 'search' || existing?.fromManualSearch,
      });
    };

    if (!hasSearchQuery) {
      for (const row of defaultLocationPeople) {
        mergeRow(row, 'default');
      }
      for (const row of formMatchResults) {
        mergeRow(row, 'form');
      }
    } else {
      for (const row of searchResults) {
        mergeRow(row, 'search');
      }
      for (const row of formMatchResults) {
        mergeRow(row, 'form');
      }
    }

    return Array.from(byId.values()).sort((a, b) => {
      const aForm = a.fromFormMatch ? 1 : 0;
      const bForm = b.fromFormMatch ? 1 : 0;
      if (bForm !== aForm) return bForm - aForm;

      if (hasSearchQuery) {
        const aSearch = a.fromManualSearch ? 1 : 0;
        const bSearch = b.fromManualSearch ? 1 : 0;
        if (bSearch !== aSearch) return bSearch - aSearch;
      }

      const aScore = a.matchReasons?.length || 0;
      const bScore = b.matchReasons?.length || 0;
      if (bScore !== aScore) return bScore - aScore;
      return 0;
    });
  }, [defaultLocationPeople, searchResults, formMatchResults, hasSearchQuery]);

  const showDirectoryResults = !submitted;
  const hasFormMatchCriteria = personForms.some(formHasMatchCriteria);
  const directoryLiveStatus = directoryLiveStatusMessage({
    personForms,
    formMatchResults,
    hasSearchQuery,
    displayResults,
    multipleUsers: personForms.length > 1,
    isHealthFitness,
    isRemoveAction: action === 'Remove',
    totalCount: isHealthFitness ? directoryPeople.length : defaultLocationPeople.length,
    managerLocation: managerDetails.club,
  });
  const directoryEmptyMessage = directoryResultsEmptyMessage({
    hasSearchQuery,
    hasFormCriteria: hasFormMatchCriteria,
    isSearchTooBroad,
    isHealthFitness,
    isRemoveAction: action === 'Remove',
    managerLocation: managerDetails.club,
  });

  const showInitialDirectoryLoading = directoryLoading && directoryPeople.length === 0;
  const multipleUsers = personForms.length > 1;
  const userSectionTitle =
    action === 'Add'
      ? multipleUsers
        ? 'Users to add'
        : 'User to add'
      : multipleUsers
        ? 'Users to remove'
        : 'User to remove';
  const isRemoveAction = action === 'Remove';
  const directoryPanelDescription = isRemoveAction
    ? isHealthFitness
      ? 'Search removed users by name, email, or client. Person details on the form are checked automatically.'
      : 'Search removed users by name or email. Person details on the form are checked automatically.'
    : isHealthFitness
      ? 'Search directory by name, email, or client. Person details on the form are checked automatically.'
      : 'Search by name or email. Person details on the form are checked automatically.';
  const directoryDateColumnLabel = isRemoveAction ? 'Removed' : 'Added';
  const directoryLoadingLabel = isRemoveAction ? 'Loading removed users…' : 'Loading directory…';
  const directoryFooterText = isRemoveAction
    ? isHealthFitness
      ? 'Rows that share any name, email, or client detail with your form are also listed here from removed users.'
      : 'Rows that share any name, email, or location detail with your form are also listed here from removed users.'
    : isHealthFitness
      ? 'Rows that share any name, email, or client detail with your form are also listed here.'
      : 'Rows that share any name, email, or location detail with your form are also listed here.';

  const intendedPartnerSlug = readManagerIntendedPartnerSlug();
  const cachedPartnerConflict = intendedPartnerSlug
    ? getManagerPartnerLinkConflict(intendedPartnerSlug)
    : null;
  const sessionPartnerSlug = partnerBranding?.partnerName
    ? partnerSlugFromName(partnerBranding.partnerName)
    : '';
  const partnerLinkConflict = Boolean(
    !partnerConflictDismissed &&
      (cachedPartnerConflict ||
        (intendedPartnerSlug &&
          (!sessionPartnerSlug || intendedPartnerSlug !== sessionPartnerSlug))),
  );
  const conflictUrlBranding =
    cachedPartnerConflict?.urlBranding ||
    readCachedPartnerSlugBranding(intendedPartnerSlug) ||
    instantPartnerBrandingFromSlug(intendedPartnerSlug);

  if (partnerLinkConflict) {
    if (!partnerBrandingReady && !cachedPartnerConflict) return <ManagerAuthLoading />;
    return (
      <ManagerPartnerLinkConflict
        urlPartnerBranding={conflictUrlBranding}
        urlPartnerSlug={intendedPartnerSlug || cachedPartnerConflict?.urlSlug}
        sessionPartnerBranding={partnerBranding || cachedPartnerConflict?.sessionBranding}
        signingOut={signingOut}
        onGoToPortal={() => {
          clearManagerIntendedPartnerSlug();
          setPartnerConflictDismissed(true);
        }}
        onLogout={async () => {
          if (signingOut) return;
          setSigningOut(true);
          try {
            if (user?.id) {
              clearManagerFormDraft(user.id);
              clearManagerIntroSeen(user.id);
            }
            const targetSlug =
              intendedPartnerSlug || cachedPartnerConflict?.urlSlug || '';
            await signOutToManagerAuth(targetSlug, { logout, navigate });
          } catch (err) {
            console.error(err);
            showToast('Could not sign out. Please try again.', 'error');
          } finally {
            setSigningOut(false);
          }
        }}
      />
    );
  }

  if (portalIntro === null) {
    return (
      <div className="fixed inset-0 overflow-hidden bg-[var(--color-brand-primary)]">
        <FlowGradientBackground className="pointer-events-none fixed inset-0" interactive />
      </div>
    );
  }

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-[var(--color-manager-canvas)] font-sans antialiased">
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-72 bg-gradient-to-b from-[var(--color-manager-hero-from)]/20 via-[var(--color-manager-canvas-deep)]/40 to-transparent"
        aria-hidden="true"
      />
      {portalIntro ? (
        <ManagerPortalIntro
          firstName={managerDetails.firstName}
          email={managerDetails.email}
          partnerName={partnerBranding?.partnerName}
          logoDataUrl={partnerBranding?.logoDataUrl}
          onComplete={handlePortalIntroComplete}
        />
      ) : null}

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-[600ms] ${
          portalIntro ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
      <Toast />
      <a
        href="#manager-request-form"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to form
      </a>

      <ManagerFormHeader
        partnerName={partnerBranding?.partnerName}
        logoDataUrl={partnerBranding?.logoDataUrl}
        managerName={managerDetails.firstName || managerDetails.lastName
          ? `${managerDetails.firstName} ${managerDetails.lastName}`.trim()
          : null}
        userEmail={managerDetails.email}
        clubLocation={managerDetails.club}
        onSignOut={handleSignOut}
        signingOut={signingOut}
      />

      <ManagerPortalHero
        firstName={managerDetails.firstName}
        email={managerDetails.email}
        partnerName={partnerBranding?.partnerName}
        clubLocation={managerDetails.club}
        pendingCount={requestPortal.pendingCount}
        handledCount={Math.max(0, (requestPortal.summaryTotal || 0) - (requestPortal.pendingCount || 0))}
        totalCount={requestPortal.summaryTotal || 0}
        badgeCount={totalBadgeCount}
        loading={requestPortal.summaryPending}
        onOpenRequests={() => setRequestsOpen(true)}
      />

      <main className="relative z-[1] mx-auto flex min-h-0 w-full max-w-[1520px] flex-1 flex-col gap-3 overflow-hidden p-4 sm:gap-4 sm:p-5 md:p-6">
        {flowStep === 'choose' && !submitted && !requestsOpen ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ManagerRequestChoice onSelect={handleSelectRequestType} />
          </div>
        ) : (
        <div className={`${workspaceShellClass} flex min-h-0 flex-1 flex-col overflow-hidden`}>
          {requestsOpen ? (
            <div
              className={`${formCardClass} relative flex min-h-0 flex-1 flex-col overflow-hidden`}
            >
              <div
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-gradient-to-r from-[var(--color-brand-accent)] via-[var(--color-brand-secondary)] to-[var(--color-brand-accent)]"
                aria-hidden="true"
              />
              <ManagerRequestHistoryPanel
                embedded
                backLabel={flowStep === 'form' ? 'Back to form' : 'Back'}
                onBack={closeRequestHistory}
                requests={requestPortal.requests}
                pendingUnseenCount={requestPortal.pendingUnseenCount}
                loading={requestPortal.listLoading}
                error={requestPortal.historyError}
                highlightVersion={requestPortal.highlightVersion}
                onHighlightChange={requestPortal.bumpHighlights}
                partnerName={partnerBranding?.partnerName}
                partnerSlug={activePartnerSlug || intendedPartnerSlug}
              />
            </div>
          ) : submitted ? (
            <div
              className={`${formCardClass} flex flex-1 flex-col items-center justify-center p-6 text-center sm:p-10`}
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-7 w-7 text-[var(--color-signal-green)]" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {submittedCount === 1
                  ? 'Request submitted successfully'
                  : `${submittedCount} requests submitted successfully`}
              </h2>
              <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
                Power Music admin will action {submittedCount === 1 ? 'this' : 'these'} shortly.
                Open <span className="font-medium text-[var(--color-text-primary)]">Your requests</span> to track progress.
              </p>
              <button
                type="button"
                onClick={handleStartAnotherRequest}
                className="mt-8 flex h-11 w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-primary)] px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-surface-sidebar-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/35 focus-visible:ring-offset-1"
              >
                Submit another request
              </button>
            </div>
          ) : (
            <form
              id="manager-request-form"
              onSubmit={handleSubmit}
              className={`${formCardClass} relative flex min-h-0 flex-1 flex-col overflow-hidden`}
            >
              <div
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-gradient-to-r from-[var(--color-brand-accent)] via-[var(--color-brand-secondary)] to-[var(--color-brand-accent)]"
                aria-hidden="true"
              />

              <div className={workspaceOuterClass}>
                <button
                  type="button"
                  onClick={handleBackToChoice}
                  className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/25"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Back
                </button>

                <div className={`${workspaceSplitClass} mt-3 sm:mt-4`}>
                <div className={workspaceFormColumnClass}>
              <h1 className="shrink-0 text-base font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-lg">
                {action === 'Add'
                  ? multipleUsers
                    ? 'Add users'
                    : 'Add a user'
                  : multipleUsers
                    ? 'Remove users'
                    : 'Remove a user'}
              </h1>
              <div className="mt-4 flex min-h-0 flex-1 flex-col sm:mt-5">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain sm:space-y-6">
              <FormSection title={terms.managerDetailsTitle}>
                <p className="-mt-1 text-[11px] text-[var(--color-text-secondary)]">
                  Taken from your signed-in account and cannot be changed here.
                </p>
                <div className={isGll ? 'grid grid-cols-1 gap-3 sm:grid-cols-3' : managerGridClass}>
                  <Field id={ids.managerFirst} label={terms.managerFirstLabel} required labelMuted>
                    <input
                      id={ids.managerFirst}
                      type="text"
                      disabled
                      readOnly
                      aria-readonly="true"
                      autoComplete="given-name"
                      value={managerDetails.firstName}
                      className={managerReadonlyInputClass}
                    />
                  </Field>
                  <Field id={ids.managerLast} label={terms.managerLastLabel} required labelMuted>
                    <input
                      id={ids.managerLast}
                      type="text"
                      disabled
                      readOnly
                      aria-readonly="true"
                      autoComplete="family-name"
                      value={managerDetails.lastName}
                      className={managerReadonlyInputClass}
                    />
                  </Field>
                  <Field id={ids.managerEmail} label={terms.managerEmailLabel} required labelMuted>
                    <input
                      id={ids.managerEmail}
                      type="email"
                      disabled
                      readOnly
                      aria-readonly="true"
                      autoComplete="email"
                      value={managerDetails.email}
                      className={managerReadonlyInputClass}
                    />
                  </Field>
                  {!isGll && (
                    <Field id={ids.managerClub} label={terms.managerClubLabel} required labelMuted>
                      <input
                        id={ids.managerClub}
                        type="text"
                        disabled
                        readOnly
                        aria-readonly="true"
                        autoComplete="organization"
                        value={managerDetails.club}
                        className={managerReadonlyInputClass}
                      />
                    </Field>
                  )}
                </div>
              </FormSection>

              {isHealthFitness && (
                <FormSection title={terms.directorDetailsTitle}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                      id={`${formId}-director-first`}
                      label={terms.directorFirstLabel}
                      required
                      error={submitAttempted && !directorFirstName.trim() ? `${terms.directorFirstLabel} is required` : ''}
                    >
                      {({ describedBy, invalid }) => (
                        <input
                          id={`${formId}-director-first`}
                          type="text"
                          required
                          autoComplete="given-name"
                          spellCheck={false}
                          value={directorFirstName}
                          onChange={(e) => setDirectorFirstName(e.target.value)}
                          aria-invalid={invalid || undefined}
                          aria-describedby={describedBy}
                          className={`${inputClass}${invalid ? ` ${invalidInputClass}` : ''}`}
                        />
                      )}
                    </Field>
                    <Field
                      id={`${formId}-director-last`}
                      label={terms.directorLastLabel}
                      required
                      error={submitAttempted && !directorLastName.trim() ? `${terms.directorLastLabel} is required` : ''}
                    >
                      {({ describedBy, invalid }) => (
                        <input
                          id={`${formId}-director-last`}
                          type="text"
                          required
                          autoComplete="family-name"
                          spellCheck={false}
                          value={directorLastName}
                          onChange={(e) => setDirectorLastName(e.target.value)}
                          aria-invalid={invalid || undefined}
                          aria-describedby={describedBy}
                          className={`${inputClass}${invalid ? ` ${invalidInputClass}` : ''}`}
                        />
                      )}
                    </Field>
                  </div>
                </FormSection>
              )}

              <FormSection title={userSectionTitle}>
                <div className="space-y-4">
                  {personForms.map((personForm, index) => {
                    const rowIds = personFieldIds(index);
                    const rowMatches = findFormMatchCandidates(directoryPeople, personForm);
                    const showRowLabel = personForms.length > 1;

                    return (
                      <div
                        key={`person-row-${index}`}
                        className={
                          showRowLabel
                            ? 'space-y-3 rounded-xl border border-[var(--color-manager-border)] bg-[var(--color-manager-panel)]/60 p-3.5'
                            : 'space-y-3'
                        }
                      >
                        {showRowLabel && (
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
                              User {index + 1}
                            </p>
                            <button
                              type="button"
                              onClick={() => handleRemovePersonRow(index)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-white hover:text-[var(--color-tag-remove-action-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/30"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Remove
                            </button>
                          </div>
                        )}
                        <div className={managerGridClass}>
                          <Field
                            id={rowIds.first}
                            label="User First Name"
                            required
                            error={getFieldError(index, 'firstName')}
                          >
                            {({ errorId, describedBy, invalid }) => (
                              <input
                                ref={(node) => setPersonFieldRef(index, 'firstName', node)}
                                id={rowIds.first}
                                type="text"
                                required
                                autoComplete="given-name"
                                spellCheck={false}
                                maxLength={PERSON_FIELD_LIMITS.firstName}
                                value={personForm.firstName}
                                onChange={(e) =>
                                  handlePersonChange(index, 'firstName', e.target.value)
                                }
                                onBlur={() => handlePersonBlur(index, 'firstName')}
                                aria-invalid={invalid || undefined}
                                aria-describedby={describedBy}
                                className={`${inputClass}${invalid ? ` ${invalidInputClass}` : ''}`}
                              />
                            )}
                          </Field>
                          <Field
                            id={rowIds.last}
                            label="User Last Name"
                            required
                            error={getFieldError(index, 'lastName')}
                          >
                            {({ errorId, describedBy, invalid }) => (
                              <input
                                ref={(node) => setPersonFieldRef(index, 'lastName', node)}
                                id={rowIds.last}
                                type="text"
                                required
                                autoComplete="family-name"
                                spellCheck={false}
                                maxLength={PERSON_FIELD_LIMITS.lastName}
                                value={personForm.lastName}
                                onChange={(e) =>
                                  handlePersonChange(index, 'lastName', e.target.value)
                                }
                                onBlur={() => handlePersonBlur(index, 'lastName')}
                                aria-invalid={invalid || undefined}
                                aria-describedby={describedBy}
                                className={`${inputClass}${invalid ? ` ${invalidInputClass}` : ''}`}
                              />
                            )}
                          </Field>

                          <Field
                            id={rowIds.email}
                            label="User Email"
                            required
                            error={getFieldError(index, 'email')}
                          >
                            {({ describedBy, invalid }) => (
                              <input
                                ref={(node) => setPersonFieldRef(index, 'email', node)}
                                id={rowIds.email}
                                type="email"
                                required
                                inputMode="email"
                                autoComplete="email"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                maxLength={PERSON_FIELD_LIMITS.email}
                                value={personForm.email}
                                onChange={(e) => handlePersonChange(index, 'email', e.target.value)}
                                onBlur={() => handlePersonBlur(index, 'email')}
                                aria-invalid={invalid || undefined}
                                aria-describedby={describedBy}
                                className={`${inputClass}${invalid ? ` ${invalidInputClass}` : ''}`}
                              />
                            )}
                          </Field>
                          {!terms.isGll && (
                            <Field
                              id={rowIds.location}
                              label={isHealthFitness ? 'User Client' : 'User Location'}
                              required
                              error={getFieldError(index, 'location')}
                            >
                              {({ describedBy, invalid }) => (
                                <input
                                  ref={(node) => setPersonFieldRef(index, 'location', node)}
                                  id={rowIds.location}
                                  type="text"
                                  required
                                  autoComplete="organization"
                                  maxLength={PERSON_FIELD_LIMITS.location}
                                  value={personForm.location}
                                  onChange={(e) =>
                                    handlePersonChange(index, 'location', e.target.value)
                                  }
                                  onBlur={() => handlePersonBlur(index, 'location')}
                                  aria-invalid={invalid || undefined}
                                  aria-describedby={describedBy}
                                  className={`${inputClass}${invalid ? ` ${invalidInputClass}` : ''}`}
                                />
                              )}
                            </Field>
                          )}

                          {terms.isGll && (
                            <Field
                              id={rowIds.location}
                              label="Gym Location (Optional)"
                              error={getFieldError(index, 'location')}
                            >
                              {({ describedBy, invalid }) => (
                                <input
                                  ref={(node) => setPersonFieldRef(index, 'location', node)}
                                  id={rowIds.location}
                                  type="text"
                                  autoComplete="organization"
                                  maxLength={PERSON_FIELD_LIMITS.location}
                                  value={personForm.location || ''}
                                  onChange={(e) =>
                                    handlePersonChange(index, 'location', e.target.value)
                                  }
                                  onBlur={() => handlePersonBlur(index, 'location')}
                                  placeholder="e.g. London, Manchester"
                                  aria-invalid={invalid || undefined}
                                  aria-describedby={describedBy}
                                  className={`${inputClass}${invalid ? ` ${invalidInputClass}` : ''}`}
                                />
                              )}
                            </Field>
                          )}

                        </div>

                        {isJdGyms && (
                          <Field
                            id={rowIds.role}
                            label="Role (Optional)"
                            error={getFieldError(index, 'role')}
                          >
                            {({ describedBy, invalid }) => (
                              <input
                                ref={(node) => setPersonFieldRef(index, 'role', node)}
                                id={rowIds.role}
                                type="text"
                                maxLength={PERSON_FIELD_LIMITS.role}
                                value={personForm.role || ''}
                                onChange={(e) =>
                                  handlePersonChange(index, 'role', e.target.value)
                                }
                                onBlur={() => handlePersonBlur(index, 'role')}
                                placeholder="e.g. PT, Instructor, Assistant Manager"
                                aria-invalid={invalid || undefined}
                                aria-describedby={describedBy}
                                className={`${inputClass}${invalid ? ` ${invalidInputClass}` : ''}`}
                              />
                            )}
                          </Field>
                        )}

                        {rowMatches.length > 0 && (
                          <div
                            role="alert"
                            className="flex gap-2.5 rounded-lg border border-amber-200 bg-[var(--color-tag-already-exists-bg)] px-3.5 py-3 text-xs text-[var(--color-tag-already-exists-text)]"
                          >
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <div className="space-y-1">
                              <p className="font-semibold">
                                {showRowLabel ? `User ${index + 1}: ` : ''}
                                {rowMatches.length === 1
                                  ? isRemoveAction
                                    ? 'This person may already be removed from the system.'
                                    : 'This person may already be in the system.'
                                  : `${rowMatches.length} possible matches found in the ${isRemoveAction ? 'removed users' : 'directory'}.`}
                              </p>
                              <p className="opacity-90">
                                Please review before submitting. You can still proceed.
                              </p>
                            </div>
                          </div>
                        )}

                        <Field
                          id={rowIds.notes}
                          label={
                            showRowLabel
                              ? `Additional notes for User ${index + 1} (optional)`
                              : 'Additional notes for this request (optional)'
                          }
                          error={getFieldError(index, 'notes')}
                        >
                          {({ describedBy, invalid }) => (
                            <textarea
                              ref={(node) => setPersonFieldRef(index, 'notes', node)}
                              id={rowIds.notes}
                              value={personForm.notes}
                              onChange={(e) => handlePersonChange(index, 'notes', e.target.value)}
                              onBlur={() => handlePersonBlur(index, 'notes')}
                              placeholder="Any additional information for this request..."
                              rows={2}
                              maxLength={PERSON_FIELD_LIMITS.notes}
                              aria-invalid={invalid || undefined}
                              aria-describedby={describedBy}
                              className={`${textareaClass}${invalid ? ` ${invalidInputClass}` : ''}`}
                            />
                          )}
                        </Field>
                      </div>
                    );
                  })}
                </div>

                {personForms.length < MAX_MANAGER_PERSON_ROWS && (
                  <button
                    type="button"
                    onClick={handleAddPersonRow}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-border-default)] px-3 text-xs font-semibold text-[var(--color-brand-primary)] transition-colors hover:border-[var(--color-brand-primary)] hover:bg-[var(--color-brand-primary)]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/30"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add another user
                  </button>
                )}
              </FormSection>
              </div>

              <div
                className={`mt-5 flex shrink-0 flex-col gap-3 border-t border-[var(--color-manager-border)] pt-5 sm:flex-row sm:items-center ${
                  isFormValid ? 'sm:justify-end' : 'sm:justify-between'
                }`}
              >
                {!isFormValid && (
                  <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)] sm:max-w-md">
                    {submitAttempted
                      ? 'Fix the highlighted fields to submit.'
                      : 'Fill all required fields with valid details to submit.'}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={!isFormValid || submitting}
                  aria-busy={submitting}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 self-end rounded-lg bg-[var(--color-brand-primary)] px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-[var(--color-surface-sidebar-hover)] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-primary)]/35 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--color-text-muted)] disabled:opacity-70 disabled:shadow-none sm:self-auto"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Submitting…
                    </>
                  ) : personForms.length === 1 ? (
                    'Submit request'
                  ) : (
                    `Submit ${personForms.length} requests`
                  )}
                </button>
              </div>
              </div>
                </div>

              {!submitted ? (
                <aside
                  ref={directorySectionRef}
                  aria-labelledby="directory-search-heading"
                  className={workspaceDirectoryColumnClass}
                >
                <section className={directorySectionClass}>
                  <div className="shrink-0 space-y-5 sm:space-y-6">
                  <div>
                    <p className={directorySectionTitleClass} id="directory-search-heading">
                      {isRemoveAction ? 'Check removed users' : 'Check directory'}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                      {directoryPanelDescription}
                    </p>
                    <p
                      className="mt-3 rounded-lg border border-[var(--color-manager-border-strong)] bg-white px-3 py-2.5 text-xs leading-relaxed text-[var(--color-text-secondary)]"
                      role="status"
                      aria-live="polite"
                    >
                      {directoryLiveStatus}
                    </p>
                  </div>

                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
                      aria-hidden="true"
                    />
                    <input
                      id={ids.search}
                      type="search"
                      placeholder={isGll ? "Search by name or email..." : (isHealthFitness ? "Search by name, email, or client..." : "Search by name, email, or location...")}
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      disabled={submitted}
                      aria-label={isGll ? "Search by name or email" : (isHealthFitness ? "Search by name, email, or client" : "Search by name, email, or location")}
                      className={directorySearchInputClass}
                    />
                  </div>

                  {searchQueryHint && !submitted && (
                  <p className="text-[11px] leading-relaxed text-[var(--color-text-secondary)]" role="status">
                  {searchQueryHint}
                  </p>
                  )}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  <div className={`${directoryResultsClass} sm:hidden`}>
                  {!showDirectoryResults && !showInitialDirectoryLoading && !isSearchTooBroad && (
                  <p className="px-3 py-8 text-center text-xs text-[var(--color-text-muted)]">
                  {directoryEmptyMessage}
                  </p>
                  )}
                  {showInitialDirectoryLoading && (
                  <p className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-[var(--color-text-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {directoryLoadingLabel}
                  </p>
                  )}
                  {!showInitialDirectoryLoading && directoryError && displayResults.length === 0 && (
                  <p className="px-3 py-8 text-center text-xs text-red-600">{directoryError}</p>
                  )}
                  {isSearchTooBroad && !showInitialDirectoryLoading && displayResults.length === 0 && (
                  <p className="px-3 py-8 text-center text-xs text-[var(--color-text-muted)]">
                  {directoryEmptyMessage}
                  </p>
                  )}
                  {!showInitialDirectoryLoading &&
                  !directoryError &&
                  showDirectoryResults &&
                  !isSearchTooBroad &&
                  displayResults.length === 0 && (
                  <p className="px-3 py-8 text-center text-xs text-[var(--color-text-muted)]">
                  {directoryEmptyMessage}
                  </p>
                  )}
                  {!submitted && !showInitialDirectoryLoading && displayResults.length > 0 && (
                  <ul className="divide-y divide-[var(--color-border-default)]">
                  {displayResults.map((row) => {
                  const isMatch = directoryRowMatchesForm(row);
                  const isAdded = row.status === 'Added';
                  const dateLabel = formatDirectoryDate(row.dateAdded);
                  const matchedUsers = formMatchUsersByRowId.get(row.id) || [];

                  return (
                  <li
                  key={row.id}
                  className={`px-3 py-3 ${isMatch ? (isAdded ? 'bg-[var(--color-tag-added-bg)]/70' : 'bg-[var(--color-tag-removed-bg)]/70') : 'hover:bg-[var(--color-manager-panel)]'}`}
                  >
                  <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                  <p className={`truncate text-sm font-medium ${isMatch ? 'font-semibold' : ''}`}>
                  {row.firstName} {row.lastName}
                  </p>
                  {multipleUsers && matchedUsers.length > 0 ? (
                  <p className="mt-1 text-[10px] font-semibold text-[var(--color-brand-secondary)]">
                  Matches User {matchedUsers.join(', User ')}
                  </p>
                  ) : null}
                  {row.email && (
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">{row.email}</p>
                  )}
                  {!isGll && row.location && (
                  <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">{row.location}</p>
                  )}
                  </div>
                  <span
                  className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isAdded
                  ? 'bg-[var(--color-tag-added-bg)] text-[var(--color-tag-added-text)]'
                  : 'bg-[var(--color-tag-removed-bg)] text-[var(--color-tag-removed-text)]'
                  }`}
                  >
                  {row.status}
                  </span>
                  </div>
                  {dateLabel && (
                  <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                  {directoryDateColumnLabel}: {dateLabel}
                  </p>
                  )}
                  </li>
                  );
                  })}
                  </ul>
                  )}
                  </div>

                  <div className={`${directoryResultsClass} hidden sm:block`}>
                  <div className="overflow-x-auto">
                  <table className="w-full table-fixed border-collapse text-left text-xs">
                  <caption className="sr-only">
                  {isRemoveAction ? 'Removed users search results' : 'Directory search results'}
                  </caption>
                  <colgroup>
                  {isGll ? (
                  <>
                  <col className="w-[25%]" />
                  <col className="w-[45%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  </>
                  ) : (
                  <>
                  <col className="w-[18%]" />
                  <col className="w-[36%]" />
                  <col className="w-[18%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  </>
                  )}
                  </colgroup>
                  <thead>
                  <tr className={directoryTableHeadClass}>
                  <th
                  scope="col"
                  className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-secondary)]"
                  >
                  Name
                  </th>
                  <th
                  scope="col"
                  className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-secondary)]"
                  >
                  Email
                  </th>
                  {!isGll && (
                  <th
                  scope="col"
                  className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-secondary)]"
                  >
                  {isHealthFitness ? 'Client' : 'Location'}
                  </th>
                  )}
                  <th
                  scope="col"
                  className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-secondary)]"
                  >
                  {directoryDateColumnLabel}
                  </th>
                  <th
                  scope="col"
                  className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-brand-secondary)]"
                  >
                  Status
                  </th>
                  </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-manager-border)]">
                  {!showDirectoryResults && !showInitialDirectoryLoading && !isSearchTooBroad && (
                  <tr>
                  <td colSpan={isGll ? 4 : 5} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                  {directoryEmptyMessage}
                  </td>
                  </tr>
                  )}
                  {showInitialDirectoryLoading && (
                  <tr>
                  <td colSpan={isGll ? 4 : 5} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                  <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {directoryLoadingLabel}
                  </span>
                  </td>
                  </tr>
                  )}
                  {!showInitialDirectoryLoading && directoryError && displayResults.length === 0 && (
                  <tr>
                  <td colSpan={isGll ? 4 : 5} className="px-3 py-8 text-center text-red-600">
                  {directoryError}
                  </td>
                  </tr>
                  )}
                  {isSearchTooBroad && !showInitialDirectoryLoading && displayResults.length === 0 && (
                  <tr>
                  <td colSpan={isGll ? 4 : 5} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                  {directoryEmptyMessage}
                  </td>
                  </tr>
                  )}
                  {!showInitialDirectoryLoading &&
                  !directoryError &&
                  showDirectoryResults &&
                  !isSearchTooBroad &&
                  displayResults.length === 0 && (
                  <tr>
                  <td colSpan={isGll ? 4 : 5} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                  {directoryEmptyMessage}
                  </td>
                  </tr>
                  )}
                  {!submitted &&
                  !showInitialDirectoryLoading &&
                  displayResults.map((row) => {
                  const isMatch = directoryRowMatchesForm(row);
                  const isAdded = row.status === 'Added';
                  const dateLabel = formatDirectoryDate(row.dateAdded);
                  const matchedUsers = formMatchUsersByRowId.get(row.id) || [];

                  return (
                  <tr
                  key={row.id}
                  className={
                  isMatch
                  ? isAdded
                  ? 'bg-[var(--color-tag-added-bg)]/70'
                  : 'bg-[var(--color-tag-removed-bg)]/70'
                  : 'hover:bg-[var(--color-manager-panel)]'
                  }
                  >
                  <td className="px-3.5 py-3 align-top text-left">
                  <span
                  className={`break-words font-medium leading-snug ${isMatch ? 'font-semibold' : ''}`}
                  >
                  {row.firstName} {row.lastName}
                  </span>
                  {multipleUsers && matchedUsers.length > 0 ? (
                  <span className="mt-1 block text-[10px] font-semibold text-[var(--color-brand-secondary)]">
                  User {matchedUsers.join(', User ')}
                  </span>
                  ) : null}
                  </td>
                  <td className="px-3.5 py-3 align-top text-left font-normal text-[var(--color-text-secondary)] break-all">
                  {row.email || '-'}
                  </td>
                  {!isGll && (
                  <td className="px-3.5 py-3 align-top text-center font-normal text-[var(--color-text-secondary)]">
                  <span className="block break-words font-normal leading-snug">
                  {row.location || '-'}
                  </span>
                  </td>
                  )}
                  <td className="px-3.5 py-3 align-top text-center whitespace-nowrap font-normal text-[var(--color-text-secondary)]">
                  {dateLabel || '-'}
                  </td>
                  <td className="px-3.5 py-3 align-top text-center whitespace-nowrap">
                  <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isAdded
                  ? 'bg-[var(--color-tag-added-bg)] text-[var(--color-tag-added-text)]'
                  : 'bg-[var(--color-tag-removed-bg)] text-[var(--color-tag-removed-text)]'
                  }`}
                  >
                  {row.status}
                  </span>
                  </td>
                  </tr>
                  );
                  })}
                  </tbody>
                  </table>
                  </div>
                  </div>
                  </div>

                  {showDirectoryResults && !directoryError && (
                  <p className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
                  {displayResults.length === 0
                  ? 'No results to show yet.'
                  : `${displayResults.length} result${displayResults.length === 1 ? '' : 's'}`}
                  {hasSearchQuery && formMatchResults.length > 0
                  ? ` (${searchResults.length} from search, ${formMatchResults.length} from form)`
                  : ''}
                  {formMatchResults.length > 0 && !hasSearchQuery ? ' from your form details' : ''}
                  {hasSearchQuery && formMatchResults.length === 0 && displayResults.length > 0
                  ? ' from search'
                  : ''}
                  </p>
                  )}

                  {directoryError && displayResults.length > 0 && (
                  <p className="shrink-0 text-[11px] text-red-600">{directoryError}</p>
                  )}

                  <p className="shrink-0 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  {directoryFooterText}
                  </p>
                </section>
                </aside>
              ) : null}
              </div>
              </div>
            </form>
          )}
        </div>
        )}
      </main>
      </div>
    </div>
  );
}
