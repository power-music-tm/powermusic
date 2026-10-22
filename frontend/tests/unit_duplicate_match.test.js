import test from 'node:test';
import assert from 'node:assert/strict';

import { matchClassification } from '../src/utils/duplicateMatch.js';

const base = {
  firstName: 'Jonathan',
  lastName: 'Smith',
  email: 'jon@puregym.com',
  location: 'London',
};

test('confirmed when all identity fields match (location required unless GLL)', () => {
  assert.equal(matchClassification(base, { ...base }), 'confirmed_duplicate');
  assert.equal(
    matchClassification(base, { ...base, location: 'Manchester' }, { isGll: false }),
    'potential_duplicate',
  );
  assert.equal(
    matchClassification(
      { firstName: 'Jon', lastName: 'Smith', email: 'jon@puregym.com', location: 'A' },
      { firstName: 'Jon', lastName: 'Smith', email: 'jon@puregym.com', location: 'B' },
      { isGll: true },
    ),
    'confirmed_duplicate',
  );
});

test('potential when name entity + location (nickname first + same last)', () => {
  // Name = nickname first + same last; + same location → potential (non-GLL)
  const result = matchClassification(base, {
    firstName: 'Jon',
    lastName: 'Smith',
    email: 'other@puregym.com',
    location: 'London',
  });
  assert.equal(result, 'potential_duplicate');
});

test('null when name alone (same first+last, different email and location)', () => {
  assert.equal(
    matchClassification(base, {
      firstName: 'Jonathan',
      lastName: 'Smith',
      email: 'other@x.com',
      location: 'Manchester',
    }),
    null,
  );
});

test('null when first + email without same last (non-GLL name entity)', () => {
  assert.equal(
    matchClassification(base, {
      firstName: 'Jonathan',
      lastName: 'Other',
      email: 'jon@puregym.com',
      location: 'Manchester',
    }),
    null,
  );
});

test('potential when email + location without name (non-GLL)', () => {
  assert.equal(
    matchClassification(base, {
      firstName: 'Alice',
      lastName: 'Other',
      email: 'jon@puregym.com',
      location: 'London',
    }),
    'potential_duplicate',
  );
});

test('GLL still allows first + email without same last', () => {
  assert.equal(
    matchClassification(
      { firstName: 'Jon', lastName: 'Smith', email: 'shared@x.com', location: 'A' },
      { firstName: 'John', lastName: 'Taylor', email: 'shared@x.com', location: 'B' },
      { isGll: true },
    ),
    'potential_duplicate',
  );
});

test('case/whitespace normalized; empty inputs null', () => {
  assert.equal(
    matchClassification(base, {
      firstName: '  JONATHAN ',
      lastName: ' SMITH',
      email: 'Jon@PureGym.COM',
      location: ' london ',
    }),
    'confirmed_duplicate',
  );
  assert.equal(matchClassification({}, {}), null);
  assert.equal(matchClassification(null, base), null);
});
