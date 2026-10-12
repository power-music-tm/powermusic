import test from 'node:test';
import assert from 'node:assert/strict';

import { csvCell } from '../src/utils/csvSafe.js';

test('wraps values in quotes and doubles internal quotes', () => {
  assert.equal(csvCell('hello'), '"hello"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
});

test('neutralizes formula injection prefixes', () => {
  for (const raw of ['=CMD()', '+1+1', '-SUM(A1)', '@SUM(A1)', '\tTAB', '\rCR']) {
    const out = csvCell(raw);
    assert.ok(out.startsWith('"\''), `expected leading quote+apostrophe for ${JSON.stringify(raw)}, got ${out}`);
    assert.ok(out.endsWith('"'));
  }
});
