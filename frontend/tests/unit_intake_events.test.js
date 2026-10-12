import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTAKE_EVENT_ADMIN,
  INTAKE_EVENT_AUTO,
  INTAKE_EVENT_MANAGER,
  formatIntakeCountSummary,
  intakeEventCounts,
  intakeEventLabel,
  readIntakeEvents,
} from '../src/utils/intakeEvents.js';

test('readIntakeEvents sorts by at and drops invalid', () => {
  const sorted = readIntakeEvents({
    intakeEvents: [
      { type: INTAKE_EVENT_AUTO, at: '2026-02-01T00:00:00.000Z' },
      null,
      { type: INTAKE_EVENT_MANAGER, at: '2026-01-01T00:00:00.000Z' },
      { foo: 1 },
    ],
  });
  assert.deepEqual(
    sorted.map((e) => e.type),
    [INTAKE_EVENT_MANAGER, INTAKE_EVENT_AUTO],
  );
});

test('counts and summary', () => {
  const events = [
    { type: INTAKE_EVENT_MANAGER },
    { type: INTAKE_EVENT_MANAGER },
    { type: INTAKE_EVENT_ADMIN },
    { type: INTAKE_EVENT_AUTO },
  ];
  assert.deepEqual(intakeEventCounts(events), {
    total: 4,
    manager: 2,
    admin: 1,
    auto: 1,
    directory: 0,
  });
  assert.equal(formatIntakeCountSummary(events), '2 manager · 1 admin · 1 auto');
  assert.equal(formatIntakeCountSummary([]), '');
  assert.equal(intakeEventLabel(INTAKE_EVENT_AUTO), 'Auto mail');
  assert.equal(intakeEventLabel('weird'), 'Intake');
});
