const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

for (const removedPaginationFeature of [
  'COMMENT_PREVIEW_COUNT',
  'COMMENT_LOAD_STEP',
  'commentUiState',
  'limitVisibleComments',
  'ensureLoadMoreCommentsButton',
  'ensureLoadLessCommentsButton',
]) {
  assert.equal(
    source.includes(removedPaginationFeature),
    false,
    removedPaginationFeature
  );
}

assert.doesNotMatch(source, /dataset\.vmCommentHidden =/);
assert.doesNotMatch(source, /dataset\.vmContinuationHidden =/);
assert.match(source, /function positionCommentsBelowDescription\(\)/);
assert.match(source, /descriptionBlock\.insertAdjacentElement\('afterend', comments\)/);
assert.match(source, /function removeLegacyCommentPagination\(\)/);
assert.match(
  source,
  /document\.getElementById\(`\$\{SCRIPT_ID\}-load-more-comments`\)\?\.remove\(\)/
);
assert.match(
  source,
  /function arrangeWatchComments\(\) \{\s*positionCommentsBelowDescription\(\);\s*removeLegacyCommentPagination\(\);/
);

console.log('comments keep native list at bottom: ok');
