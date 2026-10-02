import { readCachedPartnerSlugBranding } from './partnerSlugBrandingCache';

export function isHealthFitnessPartner(partnerName, partnerSlug = '') {
  const name = (partnerName || '').toLowerCase();
  const slug = (partnerSlug || '').toLowerCase();
  return (
    slug === 'health-fitness' ||
    slug === 'health-tech' ||
    slug.includes('health') ||
    name.includes('health fitness') ||
    name.includes('healthtech') ||
    name.includes('health tech') ||
    name.includes('health')
  );
}

export function isGllPartner(partnerName, partnerSlug = '') {
  const name = (partnerName || '').toLowerCase();
  const slug = (partnerSlug || '').toLowerCase();
  return (
    slug === 'gll' ||
    slug.includes('gll') ||
    name === 'gll' ||
    name.includes('gll')
  );
}

export function isJdGymsPartner(partnerName, partnerSlug = '') {
  const name = (partnerName || '').toLowerCase();
  const slug = (partnerSlug || '').toLowerCase();
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
}

export function getPartnerTerminology(partnerName, partnerSlug = '') {
  const isHF = isHealthFitnessPartner(partnerName, partnerSlug);
  const isGLL = isGllPartner(partnerName, partnerSlug);
  const isJD = isJdGymsPartner(partnerName, partnerSlug);
  return {
    isHealthFitness: isHF,
    isGll: isGLL,
    isJdGyms: isJD,
    requiresLocation: !isGLL,
    managerTerm: 'Manager',
    managerTermLower: 'manager',
    managerTermPlural: 'Managers',
    locationTerm: isHF ? 'Client' : (isGLL ? 'Gym Location' : 'Location'),
    locationTermLower: isHF ? 'client' : (isGLL ? 'gym location' : 'location'),
    clubOrClientLabel: isHF ? 'Client' : (isGLL ? 'Gym Location' : 'Club Location'),
    clubOrClientPlaceholder: isHF ? 'e.g. Health Fitness HQ' : 'e.g. London Central',
    managerDetailsTitle: 'Manager Details',
    managerFirstLabel: 'Manager First Name',
    managerLastLabel: 'Manager Last Name',
    managerEmailLabel: 'Manager Email',
    managerClubLabel: isHF ? 'Client' : 'Manager Club Location',
    directorDetailsTitle: 'Director Details',
    directorFirstLabel: 'Director First Name',
    directorLastLabel: 'Director Last Name',
    roleBadge: (name) => {
      const p = name?.trim();
      return p ? `${p} Manager` : 'Manager';
    },
  };
}

export function partnerDisplayNameFromSlug(slug) {
  if (!slug) return '';
  return String(slug)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function instantPartnerBrandingFromSlug(slug) {
  if (!slug) return null;
  const cached = readCachedPartnerSlugBranding(slug);
  if (cached?.partnerName) return cached;
  const partnerName = partnerDisplayNameFromSlug(slug);
  if (!partnerName) return null;
  return { partnerName, logoDataUrl: null };
}

function resolvedSlugBranding(slugBranding, partnerSlug) {
  if (slugBranding?.partnerName) {
    return {
      partnerName: slugBranding.partnerName,
      logoDataUrl: slugBranding.logoDataUrl ?? null,
    };
  }

  return instantPartnerBrandingFromSlug(partnerSlug);
}

/** Prefer URL slug on partner links; otherwise typed email, then slug branding. */
export function resolveManagerAuthPartnerBranding({
  emailBranding = null,
  slugBranding = null,
  partnerSlug = '',
}) {
  const fromSlug = resolvedSlugBranding(slugBranding, partnerSlug);

  if (partnerSlug && fromSlug?.partnerName) return fromSlug;
  if (emailBranding?.partnerName) return emailBranding;
  if (fromSlug?.partnerName) return fromSlug;

  return null;
}

export function managerAuthSignupPath(partnerSlug = '') {
  const slug = String(partnerSlug || '').trim();
  if (!slug) return '/submit/signup';
  return `/${encodeURIComponent(slug)}/submit/signup`;
}

export function managerAuthHeading(partnerName, mode, partnerSlug = '') {
  const label = partnerName?.trim();
  const terms = getPartnerTerminology(partnerName, partnerSlug);
  if (!label) {
    if (mode === 'signup') return `${terms.managerTerm} Sign Up`;
    if (mode === 'signin') return `${terms.managerTerm} Sign In`;
    return 'Account';
  }
  if (mode === 'signup') {
    return `${label} Sign Up`;
  }
  return `${label} Sign In`;
}

export function managerAuthSubmitLabel(partnerName, mode, { loading = false, partnerSlug = '' } = {}) {
  const label = partnerName?.trim();
  const terms = getPartnerTerminology(partnerName, partnerSlug);
  if (loading) {
    if (mode === 'signup') return label ? `${label} Sign Up…` : `${terms.managerTerm} Sign Up…`;
    return label ? `${label} Sign In…` : `${terms.managerTerm} Sign In…`;
  }
  if (!label) {
    return mode === 'signup' ? `${terms.managerTerm} Sign Up` : `${terms.managerTerm} Sign In`;
  }
  if (mode === 'signup') return `${label} Sign Up`;
  return `${label} Sign In`;
}

export function managerAuthCreateAccountLink(partnerName, partnerSlug = '') {
  const label = partnerName?.trim();
  return label ? `Create a ${label} Account` : 'Create an Account';
}
