import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Transfer detach keeps remaining group shell + person sync', () => {
  it('rebuilds remaining peers when the transferred request is the list row id', async () => {
    const src = await readFile(path.join(root, 'src/utils/pilot2Api.js'), 'utf8');
    assert.match(
      src,
      /List rows are keyed by the representative request id/,
    );
    assert.match(
      src,
      /if \(isSourceGroup && remaining\)/,
    );
  });

  it('syncs member person fields even when ids are unchanged', async () => {
    const src = await readFile(
      path.join(root, 'src/components/GroupResolutionView.jsx'),
      'utf8',
    );
    assert.match(src, /memberFingerprint/);
    assert.match(src, /m\?\.person\?\.firstName/);
    assert.doesNotMatch(
      src,
      /const nextIds = nextMembers\.map\(\(m\) => m\.id\)\.join\('\|'\);\s*const prevIds = members\.map\(\(m\) => m\.id\)\.join\('\|'\);\s*if \(nextIds === prevIds\) return;/,
    );
  });

  it('prefers richer cached person stubs over thin list seeds', async () => {
    const src = await readFile(
      path.join(root, 'src/utils/groupDetailCache.js'),
      'utf8',
    );
    assert.match(src, /function personRichness/);
    assert.match(src, /preferCached \? \{ \.\.\.cachedMember/);
  });
});
