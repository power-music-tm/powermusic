import test from 'node:test';
import assert from 'node:assert/strict';

import {
  firstInvalidPersonField,
  sanitizePersonFieldInput,
  validatePersonFormFields,
  validatePersonForms,
  validatePersonLocation,
  validateRosterPersonName,
} from '../src/utils/managerFormValidation.js';

test('sanitize strips digits/symbols from names and location', () => {
  assert.equal(sanitizePersonFieldInput('firstName', 'Jo3hn!'), 'John');
  assert.equal(sanitizePersonFieldInput('location', 'London 12 #'), 'London  ');
  assert.equal(sanitizePersonFieldInput('email', 'a@b.com<script>').includes('<'), true);
  assert.ok(sanitizePersonFieldInput('firstName', 'x'.repeat(200)).length <= 100);
});

test('roster name and location rules', () => {
  assert.equal(validateRosterPersonName('Jo', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName('J', 'User First Name', 'firstName').ok, false);
  assert.equal(sanitizePersonFieldInput('firstName', 'Mary Ann'), 'Mary Ann');
  assert.equal(validateRosterPersonName('Mary Ann', 'User First Name', 'firstName').ok, true);
  assert.equal(validateRosterPersonName("Smith'Ogon", 'User Last Name', 'lastName').ok, true);
  assert.equal(validatePersonLocation('Pure Gym London').ok, true);
  assert.equal(validatePersonLocation('Gym 12').ok, false);
  assert.equal(validatePersonLocation('').ok, false);
  assert.equal(validatePersonLocation('A').ok, false);
});

test('GLL can omit location; PureGym requires it', () => {
  const person = {
    firstName: 'Sam',
    lastName: 'Lee',
    email: 'sam@example.com',
    location: '',
    role: '',
    notes: '',
  };
  assert.equal(validatePersonFormFields(person, { requiresLocation: true }).ok, false);
  assert.equal(validatePersonFormFields(person, { requiresLocation: false }).ok, true);
});

test('batch rejects duplicate emails and reports first invalid field', () => {
  const forms = [
    {
      firstName: 'Sam',
      lastName: 'Lee',
      email: 'same@example.com',
      location: 'London',
      role: '',
      notes: '',
    },
    {
      firstName: 'Pat',
      lastName: 'Wu',
      email: 'same@example.com',
      location: 'Leeds',
      role: '',
      notes: '',
    },
  ];
  const result = validatePersonForms(forms);
  assert.equal(result.ok, false);
  assert.match(result.errorsByRow[0].email, /different email/i);
  assert.deepEqual(firstInvalidPersonField(result.errorsByRow), {
    rowIndex: 0,
    field: 'email',
    message: result.errorsByRow[0].email,
  });
});
