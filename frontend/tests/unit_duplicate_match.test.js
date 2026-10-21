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

test('potential when JW first-name soft-match + last name anchor', () => {
  // "Jonathan" vs "Johnathan" is typically JW >= 0.65
  const result = matchClassification(base, {
    firstName: 'Johnathan',
    lastName: 'Smith',
    email: 'other@puregym.com',
    location: 'London',
  });
  assert.equal(result, 'potential_duplicate');
});

test('null without anchor (no same last and no same email)', () => {
  assert.equal(
    matchClassification(base, {
      firstName: 'Jonathan',
      lastName: 'Other',
      email: 'other@x.com',
      location: 'London',
    }),
    null,
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
