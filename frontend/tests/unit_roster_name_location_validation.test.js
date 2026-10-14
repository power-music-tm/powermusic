import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizePersonFieldInput,
  validatePersonLocation,
  validateRosterPersonName,
} from '../src/utils/managerFormValidation.js';

test('roster names accept spaces, hyphens, apostrophes; reject digits or other symbols', () => {
  assert.equal(validateRosterPersonName('Anna Lisa', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName('Van Der Berg', 'User Last Name', 'lastName').ok, true);
  assert.equal(validateRosterPersonName('Anna-Lisa', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName("O'Neil", 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName("Smith'Ogon", 'User Last Name', 'lastName').ok, true);
  assert.equal(validateRosterPersonName("Mary-Jane O'Neil", 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName('John2', 'User First Name', 'firstName').ok, false);
  assert.equal(validateRosterPersonName('Smith@Jones', 'User Last Name', 'lastName').ok, false);
  assert.equal(validateRosterPersonName('J', 'User First Name', 'firstName').ok, false);
});

test('roster locations accept spaces and reject digits or hyphens', () => {
  assert.equal(
    validatePersonLocation('Waltham Forest Feel Good Centre').ok,
    true,
  );
  assert.equal(validatePersonLocation('Centre 2').ok, false);
  assert.equal(validatePersonLocation('North-West Centre').ok, false);
});

test('sanitize keeps spaces, hyphens, and apostrophes in names while stripping invalid characters', () => {
  assert.equal(sanitizePersonFieldInput('firstName', 'Mary Ann'), 'Mary Ann');
  assert.equal(sanitizePersonFieldInput('firstName', "O'Neil"), "O'Neil");
  assert.equal(sanitizePersonFieldInput('lastName', 'Smith-Ogon'), 'Smith-Ogon');
  assert.equal(sanitizePersonFieldInput('firstName', 'Jo3hn!'), 'John');
});
