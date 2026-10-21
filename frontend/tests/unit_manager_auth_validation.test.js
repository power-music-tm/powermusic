import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearManagerAllowedDomainsCache,
  getPasswordChecks,
  isPasswordStrongEnough,
  managerEmailDomainHint,
  normalizeAllowedDomainSuffixes,
  normalizeManagerEmail,
  resolveManagerAuthAllowedDomains,
  validateClub,
  validateManagerEmail,
  validatePassword,
  validatePersonName,
  validateManagerSignupFields,
} from '../src/utils/managerAuth.js';

test.beforeEach(() => {
  clearManagerAllowedDomainsCache();
});

test('normalizeAllowedDomainSuffixes adds @ and lowercases', () => {
  assert.deepEqual(
    normalizeAllowedDomainSuffixes([' PureGym.COM ', '@ActiveGym.com', '']),
    ['@puregym.com', '@activegym.com'],
  );
});

test('normalizeManagerEmail cleans and validates', () => {
  assert.deepEqual(normalizeManagerEmail('  Alex@Example.COM '), {
    ok: true,
    value: 'alex@example.com',
  });
  assert.equal(normalizeManagerEmail('').ok, false);
  assert.equal(normalizeManagerEmail('not-an-email').ok, false);
});

test('validateManagerEmail enforces domain and blocks admin path when configured', () => {
  const ok = validateManagerEmail('mgr@puregym.com', {
    enforceDomain: true,
    allowedDomains: ['@puregym.com'],
  });
  assert.equal(ok.ok, true);

  const bad = validateManagerEmail('mgr@evil.com', {
    enforceDomain: true,
    allowedDomains: ['@puregym.com'],
  });
  assert.equal(bad.ok, false);
});

test('password rules reject weak / common / email-related secrets', () => {
  assert.equal(validatePassword('').ok, false);
  assert.equal(validatePassword('short1!').ok, false);
  assert.equal(validatePassword('alllowercase1!').ok, false);
  assert.equal(validatePassword('ALLUPPERCASE1!').ok, false);
  assert.equal(validatePassword('NoNumber!!').ok, false);
  assert.equal(validatePassword('NoSpecial1').ok, false);
  assert.equal(validatePassword('Qwerty123!').ok, false); // keyboard / common pattern
  assert.equal(
    validatePassword('AlexSmith9!', { email: 'alex@puregym.com' }).ok,
    false,
  );

  const strong = validatePassword('TrickyHorse9!', { email: 'mgr@puregym.com' });
  assert.equal(strong.ok, true);
  assert.equal(isPasswordStrongEnough('TrickyHorse9!', { email: 'mgr@puregym.com' }), true);
  assert.ok(getPasswordChecks('TrickyHorse9!', { email: 'mgr@puregym.com' }).every((c) => c.met));
});

test('person name and club validation', () => {
  assert.equal(validatePersonName('Marie-Claire', 'First Name').ok, true);
  assert.equal(validatePersonName('<b>x</b>', 'First Name').ok, false);
  assert.equal(validatePersonName('John2', 'First Name').ok, true);
  assert.equal(validatePersonName('Rock & Roll', 'First Name').ok, true);
  assert.equal(validateClub('Pure Gym London').ok, true);
  assert.equal(validateClub('Gym 12').ok, true);
  assert.equal(validateClub('Studio #1').ok, true);
  assert.equal(validateClub('A').ok, false);
});

test('signup happy path and password mismatch', () => {
  const base = {
    firstName: 'Alex',
    lastName: 'Smith',
    email: 'alex@puregym.com',
    club: 'London',
    password: 'TrickyHorse9!',
    confirmPassword: 'TrickyHorse9!',
  };
  const ok = validateManagerSignupFields(base, {
    enforceDomain: true,
    allowedDomains: ['@puregym.com'],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.full_name, 'Alex Smith');

  const mismatch = validateManagerSignupFields(
    { ...base, confirmPassword: 'OtherPass9!' },
    { enforceDomain: true, allowedDomains: ['@puregym.com'] },
  );
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /do not match/i);
});

test('domain hint and partner domain resolution', () => {
  assert.equal(managerEmailDomainHint([]), 'allowed partner');
  assert.equal(managerEmailDomainHint(['@puregym.com']), 'puregym.com');
  assert.equal(
    managerEmailDomainHint(['@a.com', '@b.com', '@c.com']),
    'a.com, b.com or c.com',
  );

  assert.equal(
    resolveManagerAuthAllowedDomains({ partnerSlug: 'pure-gym', partnerAccessReady: false }),
    null,
  );
  assert.deepEqual(
    resolveManagerAuthAllowedDomains({
      partnerSlug: 'pure-gym',
      partnerAccessReady: true,
      partnerAllowedDomains: ['@puregym.com'],
    }),
    ['@puregym.com'],
  );
  assert.deepEqual(
    resolveManagerAuthAllowedDomains({
      partnerSlug: '',
      globalAllowedDomains: ['@x.com'],
    }),
    ['@x.com'],
  );
});
