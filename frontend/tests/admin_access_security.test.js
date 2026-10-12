import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Admin magic-link allowlist must never fall back to a hardcoded production email.
 * import.meta.env is not available under node:test — exercise the same parsing rules.
 */

function getAdminAllowlistFromEnv(raw) {
  return String(raw || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminEmail(email, allowlist) {
  return allowlist.includes((email || '').trim().toLowerCase());
}

test('unset allowlist is empty (fail closed — no andrea@ hardcoded default)', () => {
  assert.deepEqual(getAdminAllowlistFromEnv(undefined), []);
  assert.deepEqual(getAdminAllowlistFromEnv(''), []);
  assert.equal(isAdminEmail('andrea@powermusic.com', getAdminAllowlistFromEnv('')), false);
  assert.equal(isAdminEmail('onboarding@powermusic.com', getAdminAllowlistFromEnv('')), false);
});

test('comma-separated allowlist is case-insensitive and trimmed', () => {
  const list = getAdminAllowlistFromEnv('  Admin@Example.com , other@powermusic.com ');
  assert.deepEqual(list, ['admin@example.com', 'other@powermusic.com']);
  assert.equal(isAdminEmail('ADMIN@example.com', list), true);
  assert.equal(isAdminEmail('other@powermusic.com', list), true);
  assert.equal(isAdminEmail('stranger@powermusic.com', list), false);
});

test('allowlist does not treat substring / domain spoof as admin', () => {
  const list = getAdminAllowlistFromEnv('admin@powermusic.com');
  assert.equal(isAdminEmail('not-admin@powermusic.com', list), false);
  assert.equal(isAdminEmail('admin@powermusic.com.evil.com', list), false);
  assert.equal(isAdminEmail('admin@evil.com', list), false);
  assert.equal(isAdminEmail('', list), false);
  assert.equal(isAdminEmail(null, list), false);
});

test('source file must not embed andrea@powermusic.com default', async () => {
  const fs = await import('node:fs/promises');
  const path = new URL('../src/utils/adminAccess.js', import.meta.url);
  const src = await fs.readFile(path, 'utf8');
  assert.equal(src.includes('andrea@powermusic.com'), false);
  assert.match(src, /VITE_ADMIN_ALLOWED_EMAILS/);
});
