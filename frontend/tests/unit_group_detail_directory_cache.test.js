import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('group detail Directory multi-match cache', () => {
  it('prefers the richest Directory match list over a single-person list seed', async () => {
    const src = await readFile(
      path.join(root, 'src/utils/groupDetailCache.js'),
      'utf8',
    );
    assert.match(
      src,
      /const candidates = \[fromCached, fromSeed, fromPreview\]\.filter\(Boolean\)/,
    );
    assert.match(
      src,
      /existingDirCount > 1 && listDirCount <= 1/,
    );
    assert.doesNotMatch(
      src,
      /if \(fromSeed\) return fromSeed;\s*if \(fromPreview\) return fromPreview;\s*if \(fromCached\) return fromCached;/,
    );
  });
});
