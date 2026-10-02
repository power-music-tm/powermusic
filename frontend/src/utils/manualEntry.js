import { getPartnerTerminology } from './managerAuthBranding';
import {
  isAwaitingManagerSubmission,
  TAG_PARTNER_REQUEST,
  TAG_VERIFIED,
} from './requestTags';

export const AWAITING_MANAGER_LABEL = 'Auto Email Request';
export const AWAITING_MANAGER_HINT = '';
export const MANUAL_ENTRY_CLUB = 'Manual entry';
export const SENT_BY_ADMIN_LABEL = 'Admin form';
export const NO_MANAGER_NAME = 'No name';
export const NO_MANAGER_EMAIL = 'No email';
export const NO_MANAGER_LOCATION = 'No location';

export const isManualEntry = (submittedBy) => submittedBy?.club === MANUAL_ENTRY_CLUB;

export const isAutomatedSubmittedBy = (submittedBy) => submittedBy?.club === 'Auto email';

function submittedByName(submittedBy) {
  const first = (submittedBy?.firstName || '').trim();
  const last = (submittedBy?.lastName || '').trim();
  if (!first || first.toLowerCase() === 'null') {
    return [last].filter((p) => p && p.toLowerCase() !== 'null').join(' ');
  }
  if (!last || last.toLowerCase() === 'null') return first;
  return `${first} ${last}`.trim();
}

function submittedByClub(submittedBy) {
  const club = (submittedBy?.club || '').trim();
  if (!club || club === MANUAL_ENTRY_CLUB) return '';
  return club;
}

/** Name / email / club with empty placeholders when admin filled any manager field. */
export function formatAttributedManagerFields(submittedBy, options = {}) {
  const pName = options.partnerName || submittedBy?.partnerName || submittedBy?.partner_name;
  const pSlug = options.partnerSlug || submittedBy?.partnerSlug || submittedBy?.partner_slug;
  const terms = getPartnerTerminology(pName, pSlug);
  const name = submittedByName(submittedBy);
  const email = (submittedBy?.email || '').trim();
  const club = terms.isGll ? '' : submittedByClub(submittedBy);
  return {
    name: name || NO_MANAGER_NAME,
    email: email || NO_MANAGER_EMAIL,
    club: terms.isGll ? '' : (club || `No ${terms.locationTermLower}`),
    hasAny: Boolean(name || email || club),
    rawName: name,
    rawEmail: email,
    rawClub: club,
  };
}

/** True when admin entered any manager name / email / club on Add Manually. */
export function hasAttributedManager(submittedBy, options = {}) {
  return formatAttributedManagerFields(submittedBy, options).hasAny;
}

/** Admin Add Manually (no linked manager user) — may still include attributed manager details. */
export function isAdminEntry(request) {
  if (isAwaitingManagerSubmission(request?.tags)) return false;
  if (request?.managerId) return false;
  if (isManualEntry(request?.submittedBy)) return true;
  const tags = request?.tags || [];
  return tags.includes(TAG_PARTNER_REQUEST)
    || (tags.includes(TAG_VERIFIED) && !tags.includes('auto mail'));
}

export const getManagerDisplayName = (submittedBy, tags = [], request = null) => {
  if (isAwaitingManagerSubmission(tags)) return AWAITING_MANAGER_LABEL;
  if (isAutomatedSubmittedBy(submittedBy)) return AWAITING_MANAGER_LABEL;
  const name = submittedByName(submittedBy);
  if (name) return name;
  if (isAdminEntry(request || { submittedBy, tags }) || isManualEntry(submittedBy)) {
    return SENT_BY_ADMIN_LABEL;
  }
  return '';
};

export function getManagerColumnContent(request, options = {}) {
  const pName = options.partnerName || request?.partnerName || request?.partner_name;
  const pSlug = options.partnerSlug || request?.partnerSlug || request?.partner_slug;
  const terms = getPartnerTerminology(pName, pSlug);
  const tags = request?.tags || [];
  if (isAwaitingManagerSubmission(tags)) {
    return {
      primary: AWAITING_MANAGER_LABEL,
      secondary: AWAITING_MANAGER_HINT,
      tertiary: '',
      muted: true,
    };
  }
  const submittedBy = request?.submittedBy;
  if (isAutomatedSubmittedBy(submittedBy)) {
    return {
      primary: getManagerDisplayName(submittedBy, tags, request),
      secondary: AWAITING_MANAGER_HINT,
      tertiary: terms.isGll
        ? ((submittedBy?.club || '').trim() || 'No location')
        : (submittedBy?.club || ''),
      muted: true,
    };
  }
  if (isAdminEntry(request) || isManualEntry(submittedBy)) {
    const fields = formatAttributedManagerFields(submittedBy, { partnerName: pName, partnerSlug: pSlug });
    if (!fields.hasAny) {
      return {
        primary: `No ${terms.managerTermLower} details`,
        secondary: '',
        tertiary: '',
        lines: null,
        muted: true,
        placeholder: true,
      };
    }
    return {
      primary: fields.name,
      secondary: fields.email,
      tertiary: terms.isGll
        ? ((fields.club || '').trim() || 'No location')
        : fields.club,
      lines: null,
      muted: false,
    };
  }
  const name = getManagerDisplayName(submittedBy, tags, request);
  if (!name) {
    return {
      primary: AWAITING_MANAGER_LABEL,
      secondary: AWAITING_MANAGER_HINT,
      tertiary: '',
      muted: true,
    };
  }
  return {
    primary: name,
    secondary: (submittedBy?.email || '').trim() || 'No email',
    tertiary: terms.isGll
      ? ((submittedBy?.club || '').trim() || 'No location')
      : ((submittedBy?.club || '').trim() || `No ${terms.locationTermLower}`),
    muted: false,
  };
}

/** Directory ledger rows — empty manager is not an auto-email request. */
export function getDirectoryManagerColumnContent(row, options = {}) {
  const pName = options.partnerName || row?.partnerName || row?.partner_name;
  const pSlug = options.partnerSlug || row?.partnerSlug || row?.partner_slug;
  const terms = getPartnerTerminology(pName, pSlug);
  const name = (row?.managerName || row?.addedBy || '').trim();
  const email = (row?.managerEmail || '').trim();
  const club = (row?.club || '').trim();
  if (!name && !email) {
    return {
      primary: `No ${terms.managerTermLower} details`,
      secondary: '',
      tertiary: '',
      muted: true,
      placeholder: true,
    };
  }
  return {
    primary: name || NO_MANAGER_NAME,
    secondary: email || NO_MANAGER_EMAIL,
    tertiary: terms.isGll ? '' : (club || `No ${terms.locationTermLower}`),
    muted: !name,
  };
}
