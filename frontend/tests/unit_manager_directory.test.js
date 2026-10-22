import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterDirectorySearch,
  findFormMatchCandidates,
  formHasMatchCriteria,
  isUsableSearchQuery,
  mergeFormMatchRows,
  normalizeDirectoryPerson,
  personMatchesQuery,
} from '../src/utils/managerDirectory.js';

test('isUsableSearchQuery rejects broad domain-only queries', () => {
  assert.equal(isUsableSearchQuery('a'), false);
  assert.equal(isUsableSearchQuery('@'), false);
  assert.equal(isUsableSearchQuery('.com'), false);
  assert.equal(isUsableSearchQuery('gmail'), false);
  assert.equal(isUsableSearchQuery('puregym.com'), false);
  assert.equal(isUsableSearchQuery('sa'), true);
  assert.equal(isUsableSearchQuery('sam@'), false); // local part too short after strip rules / domain fragment
});

test('personMatchesQuery matches name/location and email local-part only', () => {
  const person = {
    firstName: 'Sam',
    lastName: 'Lee',
    email: 'sam.lee@gmail.com',
    location: 'London Central',
  };
  assert.equal(personMatchesQuery(person, 'sam'), true);
  assert.equal(personMatchesQuery(person, 'central'), true);
  assert.equal(personMatchesQuery(person, 'gmail'), false); // domain-only rejected
  assert.equal(personMatchesQuery(person, 'lee'), true);
  // "sam.lee" is treated as a domain-shaped query (label.tld) and rejected
  assert.equal(isUsableSearchQuery('sam.lee'), false);
});

test('filterDirectorySearch respects limit and unusable query', () => {
  const people = [
    { firstName: 'Sam', lastName: 'A', email: 'a@x.com', location: 'London' },
    { firstName: 'Sam', lastName: 'B', email: 'b@x.com', location: 'London' },
    { firstName: 'Pat', lastName: 'C', email: 'c@x.com', location: 'Leeds' },
  ];
  assert.deepEqual(filterDirectorySearch(people, 'gmail'), []);
  assert.equal(filterDirectorySearch(people, 'sam', 1).length, 1);
});

test('normalizeDirectoryPerson maps snake_case and drops id-less rows', () => {
  assert.equal(normalizeDirectoryPerson(null), null);
  assert.equal(normalizeDirectoryPerson({ first_name: 'A' }), null);
  const n = normalizeDirectoryPerson({
    id: 'p1',
    first_name: 'Sam',
    last_name: 'Lee',
    date_added: '2026-01-01',
  });
  assert.equal(n.firstName, 'Sam');
  assert.equal(n.lastName, 'Lee');
  assert.equal(n.dateAdded, '2026-01-01');
});

test('form match criteria and ranking', () => {
  assert.equal(
    formHasMatchCriteria({ email: '', firstName: '', lastName: '', location: '' }),
    false,
  );
  assert.equal(
    formHasMatchCriteria({ email: 'a@b.com', firstName: '', lastName: '', location: '' }),
    true,
  );

  const people = [
    { id: '1', firstName: 'Sam', lastName: 'Lee', email: 'sam@x.com', location: 'London' },
    { id: '2', firstName: 'Sam', lastName: 'Other', email: 'other@x.com', location: 'London' },
  ];
  const matches = findFormMatchCandidates(people, {
    firstName: 'Sam',
    lastName: 'Lee',
    email: 'sam@x.com',
    location: 'London',
  });
  assert.equal(matches[0].id, '1');
  assert.ok(matches[0].matchReasons.includes('Name'));
  assert.ok(matches[0].matchReasons.includes('Email + location'));
});

test('non-GLL form match requires name entity or email+location', () => {
  const people = [
    { id: '1', firstName: 'Sam', lastName: 'Lee', email: 'sam@x.com', location: 'London' },
  ];

  // Name alone → no warning
  assert.equal(
    findFormMatchCandidates(people, {
      firstName: 'Sam',
      lastName: 'Lee',
      email: 'other@x.com',
      location: 'Manchester',
    }).length,
    0,
  );

  // First + email without last → no warning
  assert.equal(
    findFormMatchCandidates(people, {
      firstName: 'Sam',
      lastName: 'Other',
      email: 'sam@x.com',
      location: 'Manchester',
    }).length,
    0,
  );

  // Name + email → warn
  assert.equal(
    findFormMatchCandidates(people, {
      firstName: 'Sam',
      lastName: 'Lee',
      email: 'sam@x.com',
      location: 'Manchester',
    }).length,
    1,
  );

  // Email + location → warn
  assert.equal(
    findFormMatchCandidates(people, {
      firstName: 'Other',
      lastName: 'Person',
      email: 'sam@x.com',
      location: 'London',
    }).length,
    1,
  );
});

test('GLL form match still allows first+email or name alone', () => {
  const people = [
    { id: '1', firstName: 'Sam', lastName: 'Lee', email: 'sam@x.com', location: '' },
  ];
  assert.equal(
    findFormMatchCandidates(
      people,
      { firstName: 'Sam', lastName: 'Lee', email: 'other@x.com', location: '' },
      15,
      { isGll: true },
    ).length,
    1,
  );
  assert.equal(
    findFormMatchCandidates(
      people,
      { firstName: 'Sam', lastName: 'Other', email: 'sam@x.com', location: '' },
      15,
      { isGll: true },
    ).length,
    1,
  );
});

test('mergeFormMatchRows merges reasons and user row labels', () => {
  const merged = mergeFormMatchRows([
    { formIndex: 0, rows: [{ id: 'a', matchReasons: ['Email'] }] },
    { formIndex: 1, rows: [{ id: 'a', matchReasons: ['Name'] }] },
  ]);
  assert.equal(merged.formMatchResults.length, 1);
  assert.deepEqual(new Set(merged.formMatchResults[0].matchReasons), new Set(['Email', 'Name']));
  assert.deepEqual(merged.formMatchUsersByRowId.get('a'), [1, 2]);
});
