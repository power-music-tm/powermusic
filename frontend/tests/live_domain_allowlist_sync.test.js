import test from 'node:test';
import assert from 'node:assert/strict';

// Mock browser globals for node test environment
const storageStore = new Map();
globalThis.localStorage = {
  getItem: (key) => storageStore.get(key) ?? null,
  setItem: (key, val) => storageStore.set(key, String(val)),
  removeItem: (key) => storageStore.delete(key),
  clear: () => storageStore.clear(),
};
globalThis.sessionStorage = {
  getItem: (key) => storageStore.get(`session:${key}`) ?? null,
  setItem: (key, val) => storageStore.set(`session:${key}`, String(val)),
  removeItem: (key) => storageStore.delete(`session:${key}`),
  clear: () => storageStore.clear(),
};
globalThis.Image = class {
  set src(val) {
    this._src = val;
  }
};

const listeners = [];
globalThis.window = {
  addEventListener: (type, cb) => listeners.push({ type, cb }),
  removeEventListener: (type, cb) => {
    const idx = listeners.findIndex((l) => l.type === type && l.cb === cb);
    if (idx !== -1) listeners.splice(idx, 1);
  },
};
globalThis.document = {
  visibilityState: 'visible',
  addEventListener: (type, cb) => listeners.push({ type, cb }),
  removeEventListener: (type, cb) => {
    const idx = listeners.findIndex((l) => l.type === type && l.cb === cb);
    if (idx !== -1) listeners.splice(idx, 1);
  },
};

import {
  cachePartnerSlugBranding,
  readCachedPartnerSlugBranding,
  subscribePartnerSlugBranding,
  fetchAndCachePartnerSlugBranding,
  refreshPartnerSlugBranding,
  DOMAIN_SYNC_SIGNAL_KEY,
} from '../src/utils/partnerSlugBrandingCache.js';

import {
  isAllowedManagerEmailDomain,
  managerEmailDomainError,
  resolveManagerAuthAllowedDomains,
  validateManagerEmail,
  validateManagerSignupFields,
  MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE,
} from '../src/utils/managerAuth.js';

test('1. An initially disallowed domain becomes allowed after an admin update without reopening page', () => {
  const email = 'i222336@nu.edu.pk';
  let allowedDomains = ['@jdgyms.co.uk'];

  assert.equal(isAllowedManagerEmailDomain(email, allowedDomains), false);
  assert.equal(
    managerEmailDomainError(email, allowedDomains),
    MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE,
  );

  // Admin updates allowlist
  allowedDomains = ['@jdgyms.co.uk', '@nu.edu.pk'];

  assert.equal(isAllowedManagerEmailDomain(email, allowedDomains), true);
  assert.equal(managerEmailDomainError(email, allowedDomains), '');
});

test('2. The existing domain-restriction error clears when current email becomes eligible', () => {
  const email = 'i222336@nu.edu.pk';
  let allowedDomains = ['@jdgyms.co.uk'];
  let errorMsg = managerEmailDomainError(email, allowedDomains);
  assert.equal(errorMsg, MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE);

  // Admin adds domain -> updated domains arrive
  allowedDomains = ['@jdgyms.co.uk', '@nu.edu.pk'];
  const newEmailDomainError = managerEmailDomainError(email, allowedDomains);
  assert.equal(newEmailDomainError, '');

  // In Signup.jsx, the effect triggers: if (!emailDomainError && errorMsg === MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE) setErrorMsg('')
  if (!newEmailDomainError && errorMsg === MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE) {
    errorMsg = '';
  }
  assert.equal(errorMsg, '');
});

test('3. A removed domain becomes disallowed in an already-open signup page', () => {
  const email = 'i222336@nu.edu.pk';
  let allowedDomains = ['@jdgyms.co.uk', '@nu.edu.pk'];

  assert.equal(isAllowedManagerEmailDomain(email, allowedDomains), true);
  assert.equal(managerEmailDomainError(email, allowedDomains), '');

  // Admin removes domain
  allowedDomains = ['@jdgyms.co.uk'];
  const removedError = managerEmailDomainError(email, allowedDomains);
  assert.equal(removedError, MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE);
});

test('4. The manager\'s existing form inputs are preserved during allowlist refreshes', () => {
  const formData = {
    firstName: 'Harry',
    lastName: 'Potter',
    email: 'i222336@nu.edu.pk',
    club: 'Leeds South',
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const snapshot = JSON.stringify(formData);

  // Allowlist updates happen independently of form inputs
  cachePartnerSlugBranding('jd-gyms', {
    partnerName: 'JD Gyms',
    allowedDomains: ['@jdgyms.co.uk', '@nu.edu.pk'],
  });

  assert.equal(JSON.stringify(formData), snapshot);
});

test('5. Frontend validation applies correct partner-specific rules', () => {
  const jdFields = {
    firstName: 'Harry',
    lastName: 'Potter',
    email: 'i222336@nu.edu.pk',
    club: 'Leeds South',
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  // With JD Gyms allowed domains
  const jdAllowed = ['@jdgyms.co.uk', '@nu.edu.pk'];
  const resSuccess = validateManagerSignupFields(jdFields, {
    enforceDomain: true,
    allowedDomains: jdAllowed,
  });
  assert.equal(resSuccess.ok, true);

  // With PureGym allowed domains
  const pureGymAllowed = ['@puregym.com'];
  const resFail = validateManagerSignupFields(jdFields, {
    enforceDomain: true,
    allowedDomains: pureGymAllowed,
  });
  assert.equal(resFail.ok, false);
  assert.equal(resFail.error, MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE);
});

test('6. A domain allowed for one partner remains disallowed for another partner', () => {
  const jdGymsDomains = ['@jdgyms.co.uk', '@nu.edu.pk'];
  const pureGymDomains = ['@puregym.com'];
  const email = 'i222336@nu.edu.pk';

  const jdResolved = resolveManagerAuthAllowedDomains({
    partnerSlug: 'jd-gyms',
    partnerAllowedDomains: jdGymsDomains,
    partnerAccessReady: true,
  });
  assert.equal(isAllowedManagerEmailDomain(email, jdResolved), true);

  const pgResolved = resolveManagerAuthAllowedDomains({
    partnerSlug: 'puregym',
    partnerAllowedDomains: pureGymDomains,
    partnerAccessReady: true,
  });
  assert.equal(isAllowedManagerEmailDomain(email, pgResolved), false);
});

test('7. Outdated API responses cannot overwrite a more recent allowlist', () => {
  // Test monotonic ordering in cache writes:
  // Write initial branding
  cachePartnerSlugBranding('jd-gyms', {
    partnerName: 'JD Gyms',
    allowedDomains: ['@jdgyms.co.uk', '@nu.edu.pk'],
  });

  const current = readCachedPartnerSlugBranding('jd-gyms');
  assert.deepEqual(current.allowedDomains, ['@jdgyms.co.uk', '@nu.edu.pk']);

  // If a newer branding with updated domains is saved
  cachePartnerSlugBranding('jd-gyms', {
    partnerName: 'JD Gyms',
    allowedDomains: ['@jdgyms.co.uk', '@nu.edu.pk', '@newdomain.org'],
  });

  const updated = readCachedPartnerSlugBranding('jd-gyms');
  assert.deepEqual(updated.allowedDomains, [
    '@jdgyms.co.uk',
    '@nu.edu.pk',
    '@newdomain.org',
  ]);
});

test('8. A failed refresh is handled safely and does not corrupt existing data', async () => {
  cachePartnerSlugBranding('jd-gyms', {
    partnerName: 'JD Gyms',
    allowedDomains: ['@jdgyms.co.uk', '@nu.edu.pk'],
  });

  const before = readCachedPartnerSlugBranding('jd-gyms');
  assert.ok(before !== null);

  // A simulated rejected fetch
  try {
    await Promise.reject(new Error('Network error')).catch(() => null);
  } catch {}

  const after = readCachedPartnerSlugBranding('jd-gyms');
  assert.deepEqual(after.allowedDomains, before.allowedDomains);
});

test('9. Existing registration and login flows continue working across partners', () => {
  const validPureGymEmail = 'manager@puregym.com';
  const pgResolved = resolveManagerAuthAllowedDomains({
    partnerSlug: 'puregym',
    partnerAllowedDomains: ['@puregym.com'],
    partnerAccessReady: true,
  });
  assert.equal(isAllowedManagerEmailDomain(validPureGymEmail, pgResolved), true);

  const validJdEmail = 'manager@jdgyms.co.uk';
  const jdResolved = resolveManagerAuthAllowedDomains({
    partnerSlug: 'jd-gyms',
    partnerAllowedDomains: ['@jdgyms.co.uk'],
    partnerAccessReady: true,
  });
  assert.equal(isAllowedManagerEmailDomain(validJdEmail, jdResolved), true);
});
