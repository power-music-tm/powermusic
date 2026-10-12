import test from 'node:test';
import assert from 'node:assert/strict';

import { messagePreviewText, stripQuotedReply } from '../src/utils/emailQuotes.js';

test('stripQuotedReply removes Gmail / Outlook / > quote chains', () => {
  assert.equal(stripQuotedReply(''), '');
  assert.equal(
    stripQuotedReply('Please cancel. On Thu, 9 Jul 2026 at 10:00 Sam wrote:\n> old'),
    'Please cancel.',
  );
  assert.equal(
    stripQuotedReply('Hello\n\n-----Original Message-----\nFrom: x'),
    'Hello',
  );
  assert.equal(stripQuotedReply('New note\n> quoted line'), 'New note');
});

test('messagePreviewText collapses whitespace and truncates', () => {
  assert.equal(messagePreviewText('  Hello   world  '), 'Hello world');
  const long = 'a'.repeat(100);
  assert.equal(messagePreviewText(long, { maxLength: 10 }), 'aaaaaaaaaa...');
});
