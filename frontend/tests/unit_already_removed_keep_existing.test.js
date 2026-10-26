import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Already Removed: Keep Existing actions', () => {
  it('keeps Delete New Request for archived matches; hides Add New / Archive', async () => {
    const src = await readFile(
      path.join(root, 'src/components/GroupResolutionView.jsx'),
      'utf8',
    );
    assert.match(src, /const showKeepExistingDelete = hasDirectoryLink/);
    assert.match(src, /const showKeepExistingAddOrArchive = hasDirectory/);
    assert.match(
      src,
      /showKeepExistingDelete && incomingMemberCount\(\) === 1/,
    );
    assert.match(
      src,
      /showKeepExistingAddOrArchive && incomingMemberCount\(\) === 1 && currentRep\?\.action !== 'Remove'/,
    );
    assert.match(
      src,
      /showKeepExistingAddOrArchive && incomingMemberCount\(\) === 1 && currentRep\?\.action === 'Remove'/,
    );
  });

  it('labels Remove without active Directory as Remove User', async () => {
    const src = await readFile(
      path.join(root, 'src/components/GroupResolutionView.jsx'),
      'utf8',
    );
    assert.match(
      src,
      /return isRemove \? 'Remove User' : 'Add to Directory'/,
    );
    assert.doesNotMatch(
      src,
      /return isRemove \? 'Remove from Directory' : 'Add to Directory'/,
    );
  });
});
