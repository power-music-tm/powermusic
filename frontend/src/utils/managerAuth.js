import { isAdminEmail } from './adminAccess';
import { fetchJson } from './api';

const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const HTML_TAG = /<[^>]+>/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s'.-]{0,99}$/u;
const CLUB_LOCATION_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
const MIN_CLUB_LOCATION_LENGTH = 2;

/** @type {string[] | null} */
let cachedManagerDomains = null;
/** @type {Promise<string[]> | null} */
let managerDomainsLoadPromise = null;

/** Normalize API domain list to `@example.com` suffixes. */
export function normalizeAllowedDomainSuffixes(domains) {
  return (domains || [])
    .map((d) => String(d || '').trim().toLowerCase())
    .filter(Boolean)
    .map((d) => (d.startsWith('@') ? d : `@${d}`));
}

export function getCachedManagerAllowedDomains() {
  return cachedManagerDomains;
}

export function clearManagerAllowedDomainsCache() {
  cachedManagerDomains = null;
  managerDomainsLoadPromise = null;
}

export function setManagerAllowedDomainsCache(domains) {
  cachedManagerDomains = normalizeAllowedDomainSuffixes(domains);
  return cachedManagerDomains;
}

/** Fetch allowed manager domains from the API (cached). */
export async function ensureManagerAllowedDomains({ force = false } = {}) {
  if (!force && cachedManagerDomains) {
    return cachedManagerDomains;
  }
  if (!force && managerDomainsLoadPromise) {
    return managerDomainsLoadPromise;
  }

  managerDomainsLoadPromise = fetchJson('/api/manager/allowed-domains')
    .then((data) => {
      cachedManagerDomains = normalizeAllowedDomainSuffixes(data?.domains);
      return cachedManagerDomains;
    })
    .catch((err) => {
      managerDomainsLoadPromise = null;
      throw err;
    });

  return managerDomainsLoadPromise;
}

/** @deprecated Prefer ensureManagerAllowedDomains(); kept for display fallbacks. */
export const MANAGER_ALLOWED_EMAIL_DOMAINS = ['@puregym.com'];

export const MANAGER_ACCOUNT_EXISTS_MESSAGE =
  'An account with this email already exists. Please Sign In instead.';

export const MANAGER_ACCOUNT_NOT_FOUND_MESSAGE =
  "We couldn't find an account for this email. Please Create an Account first.";

export const MANAGER_DOMAINS_UNAVAILABLE_MESSAGE =
  'Could not verify allowed email domains. Check that the server is running and try again.';

export const MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE =
  'This email or domain is not allowed to Sign In or Sign Up.';

export function isManagerAccountExistsMessage(message) {
  const msg = (message || '').toLowerCase();
  return (
    msg.includes('already exists') ||
    msg.includes('already registered') ||
    msg.includes('sign in instead')
  );
}

export function isManagerAccountNotFoundMessage(message) {
  const msg = (message || '').toLowerCase();
  return (
    msg.includes("couldn't find an account") ||
    msg.includes('no account found') ||
    msg.includes('create an account first')
  );
}

export function isAllowedManagerEmailDomain(email, allowedDomains = cachedManagerDomains) {
  if (!allowedDomains || allowedDomains.length === 0) return false;
  const lower = (email || '').trim().toLowerCase();
  return allowedDomains.some((domain) => lower.endsWith(domain));
}

export function managerEmailDomainHint(allowedDomains = cachedManagerDomains) {
  const domains = allowedDomains || [];
  const labels = domains.map((d) => (d.startsWith('@') ? d.slice(1) : d));
  if (labels.length === 0) return 'allowed partner';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

/** Partner links use that partner's domains once loaded; generic signup uses the global list. */
export function resolveManagerAuthAllowedDomains({
  partnerSlug = '',
  partnerAllowedDomains = null,
  globalAllowedDomains = null,
  partnerAccessReady = false,
} = {}) {
  if (partnerSlug) {
    if (!partnerAccessReady) return null;
    if (partnerAllowedDomains === null) return null;
    return partnerAllowedDomains;
  }
  return globalAllowedDomains;
}

function stripControlChars(value) {
  return value.replace(CONTROL_CHARS, '').trim();
}

function rejectHtml(value, fieldName) {
  if (HTML_TAG.test(value)) {
    return `${fieldName} must not contain HTML.`;
  }
  return null;
}

export function normalizeManagerEmail(raw) {
  const cleaned = stripControlChars(String(raw || '')).toLowerCase();
  if (!cleaned) {
    return { ok: false, error: 'Email address is required.' };
  }
  if (cleaned.length > 254) {
    return { ok: false, error: 'Email address is too long.' };
  }
  if (!EMAIL_RE.test(cleaned)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  return { ok: true, value: cleaned };
}

export function validateManagerEmail(raw, { enforceDomain = true, allowedDomains = cachedManagerDomains } = {}) {
  const normalized = normalizeManagerEmail(raw);
  if (!normalized.ok) return normalized;

  const email = normalized.value;

  if (enforceDomain) {
    if (!allowedDomains) {
      return { ok: false, error: MANAGER_DOMAINS_UNAVAILABLE_MESSAGE };
    }
    if (allowedDomains.length === 0) {
      return {
        ok: false,
        error: 'Manager portal access is not configured. Contact your administrator.',
      };
    }
    if (!isAllowedManagerEmailDomain(email, allowedDomains)) {
      return {
        ok: false,
        error: MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE,
      };
    }
  }

  if (isAdminEmail(email)) {
    return {
      ok: false,
      error: 'Administrator accounts use the admin sign-in page, not the manager portal.',
    };
  }

  return { ok: true, value: email };
}

export function managerEmailDomainError(email, allowedDomains) {
  const normalized = normalizeManagerEmail(email);
  if (!normalized.ok) return '';
  if (!allowedDomains?.length) return '';
  if (isAllowedManagerEmailDomain(normalized.value, allowedDomains)) return '';
  return MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE;
}

/** @deprecated Use managerEmailDomainError */
export function partnerLinkEmailDomainError(email, allowedDomains) {
  return managerEmailDomainError(email, allowedDomains);
}

/** Very common passwords — blocked like most major sites (without forcing symbols). */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyui',
  'admin123',
  'letmein',
  'welcome',
  'welcome1',
  'iloveyou',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'monkey',
  'dragon',
  'login',
  'abc123',
  '11111111',
  '00000000',
  'trustno1',
  'changeme',
  'puregym',
  'puregym1',
]);

function isPasswordSameAsEmail(password, email) {
  const normalizedPassword = String(password || '').trim().toLowerCase();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedPassword || !normalizedEmail) return false;

  const localPart = normalizedEmail.split('@')[0] || '';
  return (
    normalizedPassword === normalizedEmail ||
    normalizedPassword === localPart ||
    (localPart.length >= 3 && normalizedPassword.includes(localPart)) ||
    (normalizedPassword.length >= 3 && localPart.includes(normalizedPassword))
  );
}

const KEYBOARD_WALKS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];

function hasSequentialRun(value, minLen = 4) {
  const chars = value.toLowerCase();
  let asc = 1;
  let desc = 1;

  for (let i = 1; i < chars.length; i += 1) {
    const diff = chars.charCodeAt(i) - chars.charCodeAt(i - 1);
    asc = diff === 1 ? asc + 1 : 1;
    desc = diff === -1 ? desc + 1 : 1;
    if (asc >= minLen || desc >= minLen) return true;
  }

  return false;
}

function isCommonOrWeakPassword(password) {
  const value = String(password || '');
  const lowered = value.toLowerCase();

  if (COMMON_PASSWORDS.has(lowered)) return true;
  if (/^(.)\1+$/.test(value)) return true;
  if (/^\d+$/.test(value)) return true;
  if (hasSequentialRun(value, 4)) return true;
  if (KEYBOARD_WALKS.some((walk) => lowered.includes(walk.slice(0, 4)))) return true;

  return false;
}

const HAS_UPPERCASE = /[A-Z]/;
const HAS_LOWERCASE = /[a-z]/;
const HAS_NUMBER = /\d/;
const HAS_SPECIAL = /[^A-Za-z0-9]/;

function getPasswordRuleChecks(value, { email } = {}) {
  const emailResult = normalizeManagerEmail(email);
  const hasEmail = emailResult.ok;

  return {
    length: value.length >= 8,
    uppercase: HAS_UPPERCASE.test(value),
    lowercase: HAS_LOWERCASE.test(value),
    number: HAS_NUMBER.test(value),
    special: HAS_SPECIAL.test(value),
    notCommon: value.length >= 8 && !isCommonOrWeakPassword(value),
    notEmail:
      !hasEmail ||
      (value.length >= 8 && !isPasswordSameAsEmail(value, emailResult.value)),
  };
}

export function getPasswordChecks(password, { email } = {}) {
  const value = String(password || '');
  const rules = getPasswordRuleChecks(value, { email });

  return [
    {
      id: 'length',
      label: 'At least 8 characters',
      met: rules.length,
    },
    {
      id: 'uppercase',
      label: 'At least one uppercase letter',
      met: rules.uppercase,
    },
    {
      id: 'lowercase',
      label: 'At least one lowercase letter',
      met: rules.lowercase,
    },
    {
      id: 'number',
      label: 'At least one number',
      met: rules.number,
    },
    {
      id: 'special',
      label: 'At least one symbol',
      met: rules.special,
    },
    {
      id: 'not-common',
      label: 'Not a common password',
      met: rules.notCommon,
    },
    {
      id: 'not-email',
      label: 'Not the same as your email',
      met: rules.notEmail,
    },
  ];
}

export function isPasswordStrongEnough(password, { email } = {}) {
  return getPasswordChecks(password, { email }).every((check) => check.met);
}

export function validatePassword(raw, { email } = {}) {
  const value = String(raw || '');
  if (!value) {
    return { ok: false, error: 'Password is required.' };
  }
  if (value.length > 128) {
    return { ok: false, error: 'Password must be at most 128 characters.' };
  }

  const rules = getPasswordRuleChecks(value, { email });
  if (!rules.length) {
    return { ok: false, error: 'Use at least 8 characters.' };
  }
  if (!rules.uppercase) {
    return { ok: false, error: 'Include at least one uppercase letter.' };
  }
  if (!rules.lowercase) {
    return { ok: false, error: 'Include at least one lowercase letter.' };
  }
  if (!rules.number) {
    return { ok: false, error: 'Include at least one number.' };
  }
  if (!rules.special) {
    return { ok: false, error: 'Include at least one symbol.' };
  }
  if (!rules.notCommon) {
    return {
      ok: false,
      error: 'That password is too common or easy to guess. Choose something harder.',
    };
  }
  if (!rules.notEmail) {
    return { ok: false, error: 'Password cannot match or contain your email.' };
  }
  return { ok: true, value };
}

export function validatePersonName(raw, fieldName) {
  const cleaned = stripControlChars(String(raw || ''));
  if (!cleaned) {
    return { ok: false, error: `${fieldName} is required.` };
  }
  if (cleaned.length > 100) {
    return { ok: false, error: `${fieldName} must be at most 100 characters.` };
  }
  const htmlError = rejectHtml(cleaned, fieldName);
  if (htmlError) return { ok: false, error: htmlError };
  if (!NAME_RE.test(cleaned)) {
    return {
      ok: false,
      error: `${fieldName} may only contain letters, spaces, hyphens, and apostrophes.`,
    };
  }
  return { ok: true, value: cleaned };
}

export function validateClub(raw, fieldName = 'Club Location') {
  const cleaned = stripControlChars(String(raw || ''));
  if (!cleaned) {
    return { ok: false, error: `${fieldName} is required.` };
  }
  if (cleaned.length < MIN_CLUB_LOCATION_LENGTH) {
    return { ok: false, error: `${fieldName} must be at least ${MIN_CLUB_LOCATION_LENGTH} characters.` };
  }
  if (cleaned.length > 200) {
    return { ok: false, error: `${fieldName} must be at most 200 characters.` };
  }
  const htmlError = rejectHtml(cleaned, fieldName);
  if (htmlError) return { ok: false, error: htmlError };
  if (!CLUB_LOCATION_RE.test(cleaned)) {
    return {
      ok: false,
      error: `${fieldName} must contain letters and spaces only (no numbers or symbols).`,
    };
  }
  return { ok: true, value: cleaned };
}

export function validateManagerSignupFields(
  { firstName, lastName, email, club, password, confirmPassword },
  { enforceDomain = true, allowedDomains, isHealthFitness = false, isGll = false } = {}
) {
  const first = validatePersonName(firstName, 'First Name');
  if (!first.ok) return first;

  const last = validatePersonName(lastName, 'Last Name');
  if (!last.ok) return last;

  const emailResult = validateManagerEmail(email, { enforceDomain, allowedDomains });
  if (!emailResult.ok) return emailResult;

  let clubValue = '';
  if (!isHealthFitness) {
    if (isGll) {
      clubValue = (club || '').trim();
    } else {
      const clubResult = validateClub(club);
      if (!clubResult.ok) return clubResult;
      clubValue = clubResult.value;
    }
  }

  const passwordResult = validatePassword(password, { email: emailResult.value });
  if (!passwordResult.ok) return passwordResult;

  if (password !== confirmPassword) {
    return { ok: false, error: 'Passwords do not match.' };
  }

  return {
    ok: true,
    value: {
      firstName: first.value,
      lastName: last.value,
      email: emailResult.value,
      club: clubValue,
      password: passwordResult.value,
      full_name: `${first.value} ${last.value}`.trim(),
    },
  };
}
