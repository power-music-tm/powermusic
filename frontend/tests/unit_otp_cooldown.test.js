import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});
globalThis.window = dom.window;
globalThis.sessionStorage = dom.window.sessionStorage;

const {
  formatCooldown,
  getOtpCooldownRemaining,
  setOtpCooldown,
} = await import('../src/utils/otpCooldown.js');

test('formatCooldown rounds up seconds', () => {
  assert.equal(formatCooldown(1), '1 second');
  assert.equal(formatCooldown(1000), '1 second');
  assert.equal(formatCooldown(1001), '2 seconds');
  assert.equal(formatCooldown(59_000), '59 seconds');
});

test('set/get cooldown is email-keyed and case-insensitive', () => {
  sessionStorage.clear();
  assert.equal(getOtpCooldownRemaining('Boss@Gym.COM'), 0);
  setOtpCooldown(' Boss@Gym.COM ');
  const remaining = getOtpCooldownRemaining('boss@gym.com');
  assert.ok(remaining > 50_000 && remaining <= 60_000);
  assert.equal(getOtpCooldownRemaining('other@gym.com'), 0);
});

test('empty email does not set cooldown', () => {
  sessionStorage.clear();
  setOtpCooldown('   ');
  assert.equal(sessionStorage.length, 0);
});
