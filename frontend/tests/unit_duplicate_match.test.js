import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasPotentialDuplicatePeer,
  matchClassification,
} from '../src/utils/duplicateMatch.js';

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

test('Not the same person: any pairwise potential peer, not only vs current', () => {
  // Mirrors Tom Radcliffe group: chain of potentials; 2021/2022 are not
  // potential vs current (2024) but are potential with each other / 2023.
  const r2024 = {
    firstName: 'Tom',
    lastName: 'Radcliffe',
    email: 't2@gmail.com',
    location: 'Club 5',
  };
  const r2023 = {
    firstName: 'Thomas',
    lastName: 'Radcliffe',
    email: 't2@gmail.com',
    location: 'Club 2',
  };
  const r2022 = {
    firstName: 'Thomas',
    lastName: 'Radcliffe',
    email: 't@gmail.com',
    location: 'Club 2',
  };
  const r2021 = {
    firstName: 'Thomas',
    lastName: 'Radcliffe',
    email: 't@gmail.com',
    location: 'Club 1',
  };
  const opts = { isGll: false };

  assert.equal(matchClassification(r2024, r2023, opts), 'potential_duplicate');
  assert.equal(matchClassification(r2024, r2022, opts), null);
  assert.equal(matchClassification(r2024, r2021, opts), null);
  assert.equal(matchClassification(r2023, r2022, opts), 'potential_duplicate');
  assert.equal(matchClassification(r2022, r2021, opts), 'potential_duplicate');

  assert.equal(hasPotentialDuplicatePeer(r2024, [r2023, r2022, r2021], opts), true);
  assert.equal(hasPotentialDuplicatePeer(r2023, [r2024, r2022, r2021], opts), true);
  assert.equal(hasPotentialDuplicatePeer(r2022, [r2024, r2023, r2021], opts), true);
  assert.equal(hasPotentialDuplicatePeer(r2021, [r2024, r2023, r2022], opts), true);

  // Confirmed-only sibling does not unlock unlink.
  const twin = { ...r2024 };
  assert.equal(matchClassification(r2024, twin, opts), 'confirmed_duplicate');
  assert.equal(hasPotentialDuplicatePeer(r2024, [twin], opts), false);
});
