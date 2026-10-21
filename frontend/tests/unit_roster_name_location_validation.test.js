import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizePersonFieldInput,
  validatePersonLocation,
  validateRosterPersonName,
} from '../src/utils/managerFormValidation.js';

test('roster names accept letters, spaces, hyphens, apostrophes, digits, and symbols', () => {
  assert.equal(validateRosterPersonName('Anna Lisa', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName('Van Der Berg', 'User Last Name', 'lastName').ok, true);
  assert.equal(validateRosterPersonName('Anna-Lisa', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName("O'Neil", 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName("Smith'Ogon", 'User Last Name', 'lastName').ok, true);
  assert.equal(validateRosterPersonName("Mary-Jane O'Neil", 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName('John2', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName('Rock & Roll', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName('AC/DC', 'User Last Name', 'lastName').ok, true);
  assert.equal(validateRosterPersonName('Producer #1', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName('Artist $100', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName('Name (Remix) + Version 2', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName('Smith@Jones', 'User Last Name', 'lastName').ok, true);
  assert.equal(validateRosterPersonName('J', 'User First Name', 'firstName').ok, false);
  assert.equal(validateRosterPersonName('<b>x</b>', 'User First Name', 'firstName').ok, false);
});

test('roster locations accept spaces, digits, and symbols; reject short values', () => {
  assert.equal(
    validatePersonLocation('Waltham Forest Feel Good Centre').ok,
    true,
  );
  assert.equal(validatePersonLocation('Centre 2').ok, true);
  assert.equal(validatePersonLocation('North-West Centre').ok, true);
  assert.equal(validatePersonLocation('R&B / Hip-Hop').ok, true);
  assert.equal(validatePersonLocation('Studio #1').ok, true);
  assert.equal(validatePersonLocation('A').ok, false);
});

test('sanitize keeps punctuation and symbols in names and locations', () => {
  assert.equal(sanitizePersonFieldInput('firstName', 'Mary Ann'), 'Mary Ann');
  assert.equal(sanitizePersonFieldInput('firstName', "O'Neil"), "O'Neil");
  assert.equal(sanitizePersonFieldInput('lastName', 'Smith-Ogon'), 'Smith-Ogon');
  assert.equal(sanitizePersonFieldInput('firstName', 'Jo3hn!'), 'Jo3hn!');
  assert.equal(sanitizePersonFieldInput('firstName', 'Rock & Roll'), 'Rock & Roll');
  assert.equal(sanitizePersonFieldInput('location', 'London 12 #'), 'London 12 #');
  assert.equal(sanitizePersonFieldInput('location', 'R&B / Hip-Hop'), 'R&B / Hip-Hop');
});
