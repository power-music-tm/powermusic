import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TAG_AUTO_MAIL,
  TAG_PARTNER_REQUEST,
  TAG_SENT_BY_ADMIN,
} from '../src/utils/requestTags.js';
import {
  formatFieldList,
  hasAdminPersonDiffs,
  hasAnyDataDiffs,
  hasComparisonContext,
  hasDiffs,
  hasMultipleComparisonSources,
} from '../src/utils/requestComparison.js';

test('hasDiffs / formatFieldList', () => {
  assert.equal(hasDiffs({ fields: [{ status: 'same' }] }), false);
  assert.equal(hasDiffs({ fields: [{ status: 'differs' }] }), true);
  assert.equal(formatFieldList([]), '');
  assert.equal(formatFieldList(['Email']), 'Email');
  assert.equal(formatFieldList(['Email', 'Name']), 'Email and Name');
  assert.equal(formatFieldList(['A', 'B', 'C']), 'A, B and C');
});

test('hasAdminPersonDiffs ignores null name parts and empty admin', () => {
  assert.equal(hasAdminPersonDiffs(null, null), false);
  assert.equal(
    hasAdminPersonDiffs(
      { firstName: 'null', lastName: '', email: '', location: '' },
      { fields: [{ field: 'name', leftValue: 'Sam Lee' }] },
    ),
    false,
  );
  assert.equal(
    hasAdminPersonDiffs(
      { firstName: 'Alex', lastName: 'Admin', email: 'a@x.com', location: 'London' },
      {
        fields: [
          { field: 'name', leftValue: 'Sam Lee', rightValue: '' },
          { field: 'email', leftValue: 's@x.com', rightValue: '' },
          { field: 'location', leftValue: 'London', rightValue: '' },
        ],
      },
    ),
    true,
  );
});

test('comparison context and multiple sources', () => {
  assert.equal(hasComparisonContext(null, null, []), false);
  assert.equal(hasComparisonContext(null, null, [TAG_AUTO_MAIL]), true);
  assert.equal(
    hasMultipleComparisonSources({ tags: [TAG_PARTNER_REQUEST] }),
    false,
  );
  assert.equal(
    hasMultipleComparisonSources({
      tags: [TAG_PARTNER_REQUEST, TAG_AUTO_MAIL],
    }),
    true,
  );
  assert.equal(
    hasMultipleComparisonSources({
      tags: [TAG_PARTNER_REQUEST, TAG_SENT_BY_ADMIN],
      adminPerson: { firstName: 'A', lastName: 'B' },
    }),
    true,
  );
  assert.equal(
    hasAnyDataDiffs({ fields: [{ status: 'differs' }] }, null),
    true,
  );
});
