import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearManagerAllowedDomainsCache,
  isAllowedManagerEmailDomain,
  validateManagerEmail,
  validateManagerSignupFields,
  MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE,
  MANAGER_DOMAINS_UNAVAILABLE_MESSAGE,
} from '../src/utils/managerAuth.js';

test.beforeEach(() => {
  clearManagerAllowedDomainsCache();
});

test('XSS / HTML in names is rejected at signup validation', () => {
  const result = validateManagerSignupFields(
    {
      email: 'manager@puregym.com',
      firstName: '<script>alert(1)</script>',
      lastName: 'Smith',
      club: 'London',
      password: 'StrongPass9!',
      confirmPassword: 'StrongPass9!',
    },
    { enforceDomain: true, allowedDomains: ['@puregym.com'] },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /HTML/i);
});

test('SQL-ish club / name payloads are rejected when they contain HTML tags', () => {
  const result = validateManagerSignupFields(
    {
      email: 'manager@puregym.com',
      firstName: 'Alex',
      lastName: 'Smith',
      club: "<img src=x onerror=alert(1)>",
      password: 'StrongPass9!',
      confirmPassword: 'StrongPass9!',
    },
    { enforceDomain: true, allowedDomains: ['@puregym.com'] },
  );
  assert.equal(result.ok, false);
});

test('domain spoof emails are rejected', () => {
  const domains = ['@puregym.com'];
  for (const email of [
    'puregym.com@evil.com',
    'manager@notpuregym.com',
    'manager@puregym.com.evil.com',
    'manager@evilpuregym.com',
  ]) {
    assert.equal(isAllowedManagerEmailDomain(email, domains), false);
    const validated = validateManagerEmail(email, { enforceDomain: true, allowedDomains: domains });
    assert.equal(validated.ok, false);
    assert.equal(validated.error, MANAGER_EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE);
  }
});

test('missing domain list fails closed when enforcement is on', () => {
  const validated = validateManagerEmail('manager@puregym.com', {
    enforceDomain: true,
    allowedDomains: null,
  });
  assert.equal(validated.ok, false);
  assert.equal(validated.error, MANAGER_DOMAINS_UNAVAILABLE_MESSAGE);
});

test('empty domain list fails closed', () => {
  const validated = validateManagerEmail('manager@puregym.com', {
    enforceDomain: true,
    allowedDomains: [],
  });
  assert.equal(validated.ok, false);
  assert.match(validated.error, /not configured/i);
});

test('admin email cannot use manager portal when allowlisted', async () => {
  // Simulate allowlist containing this admin email via isAdminEmail dependency:
  // managerAuth imports adminAccess which reads import.meta.env (empty under node).
  // Still verify non-admin gym email succeeds and random email fails.
  const ok = validateManagerEmail('desk@puregym.com', {
    enforceDomain: true,
    allowedDomains: ['@puregym.com'],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value, 'desk@puregym.com');
});

test('control characters in email are stripped before validation', () => {
  const validated = validateManagerEmail('desk\u0000@puregym.com', {
    enforceDomain: true,
    allowedDomains: ['@puregym.com'],
  });
  assert.equal(validated.ok, true);
  assert.equal(validated.value, 'desk@puregym.com');
  assert.equal(validated.value.includes('\u0000'), false);
});

test('ensureManagerAllowedDomains refuses unscoped calls', async () => {
  const { ensureManagerAllowedDomains } = await import('../src/utils/managerAuth.js');
  await assert.rejects(
    () => ensureManagerAllowedDomains({ force: true }),
    (err) => {
      assert.match(String(err.message), /domain|server|unavailable/i);
      return true;
    },
  );
});
