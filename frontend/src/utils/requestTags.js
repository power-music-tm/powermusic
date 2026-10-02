export const TAG_ALREADY_EXISTS = 'already exists';
export const TAG_ALREADY_REMOVED = 'already removed';
export const TAG_PARTNER_REQUEST = 'partner req';
export const TAG_AUTO_MAIL = 'auto mail';
export const TAG_VERIFIED = 'verified';
export const TAG_UNVERIFIED = 'unverified';
/** Stored when admin overlays an existing manager request; also display alias for pure admin entries. */
export const TAG_SENT_BY_ADMIN = 'sent by admin';
export const TAG_CONFIRMED_DUPLICATE = 'confirmed duplicate';
export const TAG_POTENTIAL_DUPLICATE = 'potential duplicate';
export const ADMIN_FORM_LABEL = 'Admin form';

/** @deprecated use TAG_AUTO_MAIL */
export const TAG_AUTO_EMAIL = TAG_AUTO_MAIL;
export const TAG_AUTOMATED_EMAIL = TAG_AUTO_MAIL;

export function isAutomatedIntakeRequest(tags = []) {
  return tags.includes(TAG_AUTO_MAIL);
}

export function isAwaitingManagerSubmission(tags = []) {
  return (
    tags.includes(TAG_UNVERIFIED)
    && tags.includes(TAG_AUTO_MAIL)
    && !tags.includes(TAG_PARTNER_REQUEST)
  );
}

export function isVisibleInNewRequests(tags = []) {
  return tags.includes(TAG_VERIFIED) || isAwaitingManagerSubmission(tags);
}

export function requestTagVariant(tag) {
  if (tag === TAG_ALREADY_EXISTS) return 'already-exists';
  if (tag === TAG_VERIFIED) return 'add-action';
  if (tag === TAG_UNVERIFIED) return 'archived';
  if (tag === TAG_PARTNER_REQUEST) return 'neutral';
  if (tag === TAG_SENT_BY_ADMIN) return 'neutral';
  if (tag === TAG_CONFIRMED_DUPLICATE) return 'review-removed';
  if (tag === TAG_POTENTIAL_DUPLICATE) return 'review-exists';
  if (tag === TAG_AUTO_MAIL) return 'neutral';
  return 'neutral';
}

export function sortRequestTags(tags = []) {
  const order = [
    TAG_VERIFIED,
    TAG_UNVERIFIED,
    TAG_PARTNER_REQUEST,
    TAG_SENT_BY_ADMIN,
    TAG_CONFIRMED_DUPLICATE,
    TAG_POTENTIAL_DUPLICATE,
    TAG_AUTO_MAIL,
    TAG_ALREADY_EXISTS,
  ];
  return [...tags].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

/** Tags hidden in admin tables — still used for filtering logic. */
export function visibleTableRequestTags(tags = []) {
  return sortRequestTags(tags).filter(
    (tag) => tag !== TAG_VERIFIED && tag !== TAG_UNVERIFIED && tag !== TAG_CONFIRMED_DUPLICATE && tag !== TAG_POTENTIAL_DUPLICATE,
  );
}

/** Display tags for UI — pure admin entries show Admin form instead of Manager Form.
 *  When admin overlays an existing manager request, both tags are stored and shown.
 */
export function displayRequestTags(tags = [], { isAdminEntry = false } = {}) {
  const hasStoredAdmin = tags.includes(TAG_SENT_BY_ADMIN);
  return visibleTableRequestTags(tags).map((tag) => (
    isAdminEntry && !hasStoredAdmin && tag === TAG_PARTNER_REQUEST
      ? TAG_SENT_BY_ADMIN
      : tag
  ));
}

/** Intake source tags for the Sent via column (excludes review-only tags). */
export function sentViaTableRequestTags(
  tags = [],
  { isAdminEntry = false, includeAdminForm = true } = {},
) {
  return displayRequestTags(tags, { isAdminEntry })
    .filter((tag) => tag !== TAG_ALREADY_EXISTS && tag !== TAG_ALREADY_REMOVED)
    .filter((tag) => includeAdminForm || tag !== TAG_SENT_BY_ADMIN);
}

export const SENT_VIA_BOTH = 'both';

/** Filter New Requests by intake source (exclusive Manager Form / Auto Email, or both). */
export function matchesSentViaFilter(tags = [], filterValue) {
  if (filterValue === 'All') return true;
  const hasPartner = tags.includes(TAG_PARTNER_REQUEST);
  const hasAuto = tags.includes(TAG_AUTO_MAIL);
  if (filterValue === TAG_PARTNER_REQUEST) return hasPartner && !hasAuto;
  if (filterValue === TAG_AUTO_MAIL) return hasAuto && !hasPartner;
  if (filterValue === SENT_VIA_BOTH) return hasPartner && hasAuto;
  return true;
}

export function requestTagLabel(tag) {
  if (tag === TAG_ALREADY_EXISTS) return 'Exists in Directory';
  if (tag === TAG_PARTNER_REQUEST) return 'Manager Form';
  if (tag === TAG_SENT_BY_ADMIN) return ADMIN_FORM_LABEL;
  if (tag === TAG_CONFIRMED_DUPLICATE) return 'Duplicate';
  if (tag === TAG_POTENTIAL_DUPLICATE) return 'Potential Duplicate';
  if (tag === TAG_AUTO_MAIL) return 'Automated email';
  return tag;
}

const STATUS_TAGS = [
  {
    tag: TAG_ALREADY_EXISTS,
    label: 'Exists in Directory',
    variant: 'already-exists',
  },
  {
    tag: TAG_ALREADY_REMOVED,
    label: 'Already Removed',
    variant: 'already-removed',
  },
  {
    tag: TAG_CONFIRMED_DUPLICATE,
    label: 'Duplicate',
    variant: 'duplicate-confirmed',
  },
  {
    tag: TAG_POTENTIAL_DUPLICATE,
    label: 'Potential Duplicate',
    variant: 'duplicate-potential',
  },
];

export function requestStatusTags(request) {
  const tags = request?.tags || [];
  return STATUS_TAGS
    .filter((item) => tags.includes(item.tag))
    .map(({ label, variant }) => ({
      variant,
      label,
      prefix: '',
      plain: false,
    }));
}

export function requestStatusTag(request) {
  const statusTags = requestStatusTags(request);
  if (statusTags.length > 0) {
    return statusTags[0];
  }
  return directoryStatusTag(request);
}

/** Directory presence for New requests Status column. */
export function directoryStatusTag(request) {
  const isExists = (request?.tags || []).includes(TAG_ALREADY_EXISTS);
  const isRemoved = (request?.tags || []).includes(TAG_ALREADY_REMOVED);
  const inDirectory = Boolean(
    request?.directoryMatch
    || isExists
    || isRemoved,
  );
  if (inDirectory) {
    if (isRemoved) {
      return {
        variant: 'already-removed',
        label: 'Already Removed',
        prefix: '⚠ ',
        plain: false,
      };
    }
    return {
      variant: 'already-exists',
      label: 'Exists in Directory',
      prefix: '⚠ ',
      plain: false,
    };
  }
  return {
    variant: 'new-person',
    label: request?.action === 'Remove' ? 'Not removed' : 'Not added',
    prefix: '',
    plain: true,
  };
}

/**
 * Convert a groupClassificationSummary object into an ordered array of pill
 * descriptors for display.
 *
 * Rules:
 * - Exists in Directory is rendered once (no count badge) when alreadyExists=true
 * - Duplicate × N is rendered when duplicateCount > 0
 * - Potential Duplicate × N is rendered when potentialCount > 0
 * - Uses existing variant names so no new CSS is needed
 *
 * @param {{ alreadyExists: boolean, duplicateCount: number, potentialCount: number } | null | undefined} summary
 * @returns {Array<{ variant: string, label: string, count: number|null, prefix: string }>}
 */
export function groupClassificationPills(summary) {
  if (!summary) return [];
  const pills = [];
  if (summary.alreadyExists) {
    pills.push({
      variant: 'already-exists',
      label: 'Exists in Directory',
      count: null,
      prefix: '',
    });
  }
  if (summary.alreadyRemoved) {
    pills.push({
      variant: 'already-removed',
      label: 'Already Removed',
      count: null,
      prefix: '',
    });
  }
  if (summary.duplicateCount > 0) {
    pills.push({
      variant: 'duplicate-confirmed',
      label: 'Duplicate',
      count: summary.duplicateCount,
      prefix: '',
    });
  }
  if (summary.potentialCount > 0) {
    pills.push({
      variant: 'duplicate-potential',
      label: 'Potential Duplicate',
      count: summary.potentialCount,
      prefix: '',
    });
  }
  return pills;
}

/** Directory-only pills for New Requests Status column. */
export function groupDirectoryStatusPills(summary) {
  if (!summary) return [];
  const pills = [];
  if (summary.alreadyExists) {
    pills.push({
      variant: 'already-exists',
      label: 'Exists in Directory',
      count: null,
      prefix: '',
    });
  }
  if (summary.alreadyRemoved) {
    pills.push({
      variant: 'already-removed',
      label: 'Already Removed',
      count: null,
      prefix: '',
    });
  }
  return pills;
}

/**
 * One user-facing hint when related requests may be the same person.
 * Umbrella label — not "Duplicate" or "Potential Duplicate" (those are detail-page terms).
 */
export function duplicateStatusIndicator({
  duplicateCount = 0,
  potentialCount = 0,
} = {}) {
  if (duplicateCount <= 0 && potentialCount <= 0) return null;

  return {
    label: 'Similar requests found',
    title: 'Other requests that may be the same person — open to review',
  };
}

export function groupDuplicateStatusIndicator(summary) {
  if (!summary) return null;
  return duplicateStatusIndicator({
    duplicateCount: summary.duplicateCount || 0,
    potentialCount: summary.potentialCount || 0,
  });
}

/** Directory status tags only — duplicate tags are shown separately. */
export function requestDirectoryStatusTags(request) {
  return requestStatusTags(request).filter(
    (tag) => tag.label === 'Exists in Directory' || tag.label === 'Already Removed',
  );
}

export function requestDuplicateStatusIndicator(request) {
  const tags = request?.tags || [];
  return duplicateStatusIndicator({
    duplicateCount: tags.includes(TAG_CONFIRMED_DUPLICATE) ? 1 : 0,
    potentialCount: tags.includes(TAG_POTENTIAL_DUPLICATE) ? 1 : 0,
  });
}

