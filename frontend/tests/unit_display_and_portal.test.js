import test from 'node:test';
import assert from 'node:assert/strict';

import { isSessionExpired } from '../src/utils/authBootstrap.js';
import {
  formatPersonEmail,
  formatPersonFields,
  formatPersonName,
} from '../src/utils/personDisplay.js';
import { formatRequestDisplayId } from '../src/utils/requestDisplayId.js';
import {
  getPartnerTerminology,
  isGllPartner,
  isHealthFitnessPartner,
  partnerDisplayNameFromSlug,
} from '../src/utils/managerAuthBranding.js';
import {
  formatAttributedManagerFields,
  getManagerDisplayName,
  isAdminEntry,
  isManualEntry,
  SENT_BY_ADMIN_LABEL,
  AWAITING_MANAGER_LABEL,
} from '../src/utils/manualEntry.js';
import {
  isAdminOnManagerPortal,
  isLikelyAdminSession,
  isLikelyManagerSession,
  isManagerOnAdminPortal,
} from '../src/utils/rolePortalAccess.js';
import { resolveSelectedInbox } from '../src/utils/selectedInbox.js';
import {
  parsePartnerSlugFromPath,
  partnerSlugFromName,
} from '../src/utils/partnerSlugBrandingCache.js';
import {
  TAG_AUTO_MAIL,
  TAG_PARTNER_REQUEST,
  TAG_UNVERIFIED,
  TAG_VERIFIED,
} from '../src/utils/requestTags.js';

test('person display cleans null/undefined string parts', () => {
  assert.equal(formatPersonName({ firstName: 'Rubab', lastName: 'null' }), 'Rubab');
  assert.equal(formatPersonName({ firstName: 'undefined', lastName: '' }), 'No name');
  assert.equal(formatPersonEmail({ email: 'null' }), 'No email');
  assert.deepEqual(formatPersonFields({ firstName: 'Sam', lastName: 'Lee', email: 's@x.com', location: '' }), {
    name: 'Sam Lee',
    email: 's@x.com',
    location: 'No location',
  });
});

test('formatRequestDisplayId pads', () => {
  assert.equal(formatRequestDisplayId(null), '-');
  assert.equal(formatRequestDisplayId(1), 'R-01');
  assert.equal(formatRequestDisplayId(27), 'R-27');
});

test('isSessionExpired uses 30s margin', () => {
  assert.equal(isSessionExpired(null), false);
  assert.equal(isSessionExpired({}), false);
  const nowSec = Math.floor(Date.now() / 1000);
  assert.equal(isSessionExpired({ expires_at: nowSec + 10 }), true);
  assert.equal(isSessionExpired({ expires_at: nowSec + 120 }), false);
});

test('partner branding terminology', () => {
  assert.equal(isHealthFitnessPartner('Health Fitness', 'health-fitness'), true);
  assert.equal(isGllPartner('GLL', 'gll'), true);
  assert.equal(getPartnerTerminology('GLL', 'gll').requiresLocation, false);
  assert.equal(getPartnerTerminology('Health Fitness', 'health-fitness').locationTerm, 'Client');
  assert.equal(partnerDisplayNameFromSlug('jd-gyms'), 'Jd Gyms');
});

test('manual entry / admin attribution helpers', () => {
  assert.equal(isManualEntry({ club: 'Manual entry' }), true);
  assert.equal(
    isAdminEntry({ tags: [TAG_UNVERIFIED, TAG_AUTO_MAIL], managerId: null }),
    false,
  );
  assert.equal(
    isAdminEntry({ tags: [TAG_PARTNER_REQUEST, TAG_VERIFIED], managerId: null, submittedBy: { club: 'Manual entry' } }),
    true,
  );
  assert.equal(
    getManagerDisplayName({}, [TAG_UNVERIFIED, TAG_AUTO_MAIL]),
    AWAITING_MANAGER_LABEL,
  );
  assert.equal(
    getManagerDisplayName({ club: 'Manual entry' }, [TAG_PARTNER_REQUEST], {
      tags: [TAG_PARTNER_REQUEST],
      managerId: null,
      submittedBy: { club: 'Manual entry' },
    }),
    SENT_BY_ADMIN_LABEL,
  );
  const fields = formatAttributedManagerFields(
    { firstName: 'null', lastName: 'Lee', email: 'a@b.com', club: 'London' },
    { partnerSlug: 'gll' },
  );
  assert.equal(fields.name, 'Lee');
  assert.equal(fields.club, ''); // GLL hides club
});

test('portal role guards (role-only path, no allowlist)', () => {
  assert.equal(isLikelyAdminSession({ id: '1' }, 'admin'), true);
  assert.equal(isLikelyManagerSession({ id: '1' }, 'manager'), true);
  assert.equal(isAdminOnManagerPortal({ id: '1', email: 'a@x.com' }, 'admin'), true);
  assert.equal(isManagerOnAdminPortal({ id: '1' }, 'manager'), true);
  // Dual-role should not trip cross-portal blocks
  assert.equal(isAdminOnManagerPortal({ id: '1' }, 'admin'), true);
});

test('resolveSelectedInbox prefers connected / preferred', () => {
  const rows = [
    { email: 'a@x.com', status: 'Disconnected' },
    { email: 'b@x.com', status: 'Connected' },
  ];
  assert.equal(resolveSelectedInbox(rows, 'a@x.com'), 'a@x.com');
  assert.equal(resolveSelectedInbox(rows, 'missing@x.com'), 'b@x.com');
  assert.equal(resolveSelectedInbox([], ''), '');
});

test('partner slug parse helpers', () => {
  assert.equal(parsePartnerSlugFromPath('/pure-gym/submit/signup'), 'pure-gym');
  assert.equal(partnerSlugFromName('Pure Gym'), 'pure-gym');
  assert.equal(partnerSlugFromName(''), 'partner');
});
