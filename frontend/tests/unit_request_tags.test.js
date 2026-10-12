import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TAG_ALREADY_EXISTS,
  TAG_AUTO_MAIL,
  TAG_PARTNER_REQUEST,
  TAG_SENT_BY_ADMIN,
  TAG_UNVERIFIED,
  TAG_VERIFIED,
  SENT_VIA_BOTH,
  displayRequestTags,
  isAwaitingManagerSubmission,
  isVisibleInNewRequests,
  matchesSentViaFilter,
  requestTagLabel,
  sortRequestTags,
  visibleTableRequestTags,
  duplicateStatusIndicator,
  groupClassificationPills,
} from '../src/utils/requestTags.js';

test('awaiting manager submission requires unverified + auto mail without partner req', () => {
  assert.equal(
    isAwaitingManagerSubmission([TAG_UNVERIFIED, TAG_AUTO_MAIL]),
    true,
  );
  assert.equal(
    isAwaitingManagerSubmission([TAG_UNVERIFIED, TAG_AUTO_MAIL, TAG_PARTNER_REQUEST]),
    false,
  );
});

test('visible in new requests', () => {
  assert.equal(isVisibleInNewRequests([TAG_VERIFIED]), true);
  assert.equal(isVisibleInNewRequests([TAG_UNVERIFIED, TAG_AUTO_MAIL]), true);
  assert.equal(isVisibleInNewRequests([TAG_ALREADY_EXISTS]), false);
});

test('sortRequestTags follows display order', () => {
  assert.deepEqual(
    sortRequestTags([TAG_AUTO_MAIL, TAG_VERIFIED, TAG_PARTNER_REQUEST]),
    [TAG_VERIFIED, TAG_PARTNER_REQUEST, TAG_AUTO_MAIL],
  );
});

test('visibleTableRequestTags hides verification tags', () => {
  assert.deepEqual(
    visibleTableRequestTags([TAG_VERIFIED, TAG_PARTNER_REQUEST, TAG_AUTO_MAIL]),
    [TAG_PARTNER_REQUEST, TAG_AUTO_MAIL],
  );
});

test('displayRequestTags maps partner req to admin label for pure admin entries', () => {
  assert.deepEqual(
    displayRequestTags([TAG_PARTNER_REQUEST], { isAdminEntry: true }),
    [TAG_SENT_BY_ADMIN],
  );
  assert.deepEqual(
    displayRequestTags([TAG_PARTNER_REQUEST, TAG_SENT_BY_ADMIN], { isAdminEntry: true }),
    [TAG_PARTNER_REQUEST, TAG_SENT_BY_ADMIN],
  );
});

test('matchesSentViaFilter exclusive and both', () => {
  const both = [TAG_PARTNER_REQUEST, TAG_AUTO_MAIL];
  assert.equal(matchesSentViaFilter(both, 'All'), true);
  assert.equal(matchesSentViaFilter(both, SENT_VIA_BOTH), true);
  assert.equal(matchesSentViaFilter(both, TAG_PARTNER_REQUEST), false);
  assert.equal(matchesSentViaFilter([TAG_PARTNER_REQUEST], TAG_PARTNER_REQUEST), true);
  assert.equal(matchesSentViaFilter([TAG_AUTO_MAIL], TAG_AUTO_MAIL), true);
});

test('labels and pills', () => {
  assert.equal(requestTagLabel(TAG_AUTO_MAIL), 'Automated email');
  assert.equal(requestTagLabel(TAG_PARTNER_REQUEST), 'Manager Form');
  assert.deepEqual(
    groupClassificationPills({ alreadyExists: true, duplicateCount: 2, potentialCount: 1 }),
    [
      { variant: 'already-exists', label: 'Exists in Directory', count: null, prefix: '' },
      { variant: 'duplicate-confirmed', label: 'Duplicate', count: 2, prefix: '' },
      { variant: 'duplicate-potential', label: 'Potential Duplicate', count: 1, prefix: '' },
    ],
  );
  assert.equal(duplicateStatusIndicator({ duplicateCount: 0, potentialCount: 0 }), null);
  assert.equal(duplicateStatusIndicator({ duplicateCount: 1 }).label, 'Similar requests found');
});
