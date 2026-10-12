import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveAdminDisplayName,
  resolveAdminFirstName,
} from '../src/utils/adminDisplayName.js';

test('prefers profile full_name', () => {
  assert.equal(
    resolveAdminDisplayName(
      { full_name: 'Andrea Petty', email: 'a@x.com' },
      { email: 'u@x.com', user_metadata: { full_name: 'Meta Name' } },
    ),
    'Andrea Petty',
  );
});

test('falls back to user_metadata then email local-part then Admin', () => {
  assert.equal(
    resolveAdminDisplayName(
      {},
      { user_metadata: { full_name: 'Meta Name' } },
    ),
    'Meta Name',
  );
  assert.equal(
    resolveAdminDisplayName({ email: 'boss@powermusic.com' }, {}),
    'boss',
  );
  assert.equal(resolveAdminDisplayName({}, {}), 'Admin');
});

test('never invents Andrea when profile empty', () => {
  assert.notEqual(resolveAdminDisplayName({}, { email: 'x@y.com' }), 'Andrea');
});

test('first name uses profile.first_name then first token of display', () => {
  assert.equal(
    resolveAdminFirstName({ first_name: 'Alex', full_name: 'Alex Manager' }, {}),
    'Alex',
  );
  assert.equal(
    resolveAdminFirstName({ full_name: 'Jordan Lee' }, {}),
    'Jordan',
  );
});
