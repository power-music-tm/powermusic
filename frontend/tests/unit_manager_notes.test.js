import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MANAGER_NOTES_EMPTY_LABEL,
  formatManagerNotes,
  managerNotesIsEmpty,
  readAutomatedNotes,
  readAutomatedSubject,
  readLeaveDate,
  readManagerNotes,
  readManagerNotesWithLeaveDate,
  stripAutomatedManagerNotes,
} from '../src/utils/managerNotes.js';

test('stripAutomatedManagerNotes drops auto/seed blocks and keeps manager text', () => {
  assert.equal(stripAutomatedManagerNotes(''), '');
  assert.equal(stripAutomatedManagerNotes('Automated roster email\nSubject: Hi'), '');
  assert.equal(stripAutomatedManagerNotes('Automated PureGym email from inbox'), '');
  assert.equal(stripAutomatedManagerNotes('Seed: demo person'), '');
  assert.equal(
    stripAutomatedManagerNotes('Please review\n\nAutomated roster email\nfoo'),
    'Please review',
  );
});

test('readAutomatedNotes prefers meta then auto blocks', () => {
  assert.equal(
    readAutomatedNotes({ automatedEmail: { details: 'Automated roster email\nx' } }),
    'Automated roster email\nx',
  );
  assert.equal(readAutomatedNotes({ notes: 'Seed: ignore' }), '');
  assert.equal(
    readAutomatedNotes({
      managerNotes: 'Manager says hi\n\nAutomated roster email\nBody',
    }),
    'Automated roster email\nBody',
  );
});

test('readAutomatedSubject and Leave date', () => {
  assert.equal(
    readAutomatedSubject({ automatedEmail: { subject: 'Add Sam' } }),
    'Add Sam',
  );
  assert.equal(
    readAutomatedSubject({
      automatedEmail: { details: 'Automated roster email\nSubject: From details\nBody' },
    }),
    'From details',
  );
  assert.equal(
    readLeaveDate({ details: 'Leave date: 2026-09-01\nMore' }),
    '2026-09-01',
  );
  assert.equal(readLeaveDate({ notes: 'no leave here' }), '');
});

test('format / empty helpers', () => {
  assert.equal(formatManagerNotes({ notes: '' }), MANAGER_NOTES_EMPTY_LABEL);
  assert.equal(formatManagerNotes({ notes: 'Hello team' }), 'Hello team');
  assert.equal(managerNotesIsEmpty({ notes: 'Automated roster email\nx' }), true);
  assert.equal(readManagerNotes({ notes: 'Hello\n\nSeed: x' }), 'Hello');
});

test('readManagerNotesWithLeaveDate surfaces Leave date in notes display', () => {
  assert.equal(
    readManagerNotesWithLeaveDate({
      managerNotes: 'Automated roster email. Remove\nSubject: Leaver\nLeave date: 2024-08-14',
    }),
    'Leave date: 2024-08-14',
  );
  assert.equal(
    readManagerNotesWithLeaveDate({
      notes: 'Please archive',
      automatedEmail: {
        details: 'Automated roster email. Remove\nSubject: X\nLeave date: 2026-01-02',
      },
    }),
    'Please archive\nLeave date: 2026-01-02',
  );
  assert.equal(
    readManagerNotesWithLeaveDate({
      notes: 'Leave date: 2026-01-02',
      automatedEmail: { details: 'Leave date: 2026-01-02' },
    }),
    'Leave date: 2026-01-02',
  );
  assert.equal(readManagerNotesWithLeaveDate({ notes: 'Only manager' }), 'Only manager');
});
