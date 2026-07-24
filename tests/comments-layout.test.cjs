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
assert.match(source, /function positionCommentsAfterRecommendations\(\)/);
assert.doesNotMatch(source, /function expandCommentsSection\(/);
assert.doesNotMatch(
  source,
  /ytd-comments#comments,\s*ytd-comments\s*\{\s*display: block !important;/
);
assert.match(
  source,
  /setImportantStyles\(recommendations, \{\s*order: '2'/
);
assert.match(source, /setImportantStyles\(comments, \{\s*order: '3'/);
assert.match(
  source,
  /insertionAnchor\.insertAdjacentElement\('afterend', comments\)/
);
assert.match(source, /function removeLegacyCommentPagination\(\)/);
assert.match(
  source,
  /document\.getElementById\(`\$\{SCRIPT_ID\}-load-more-comments`\)\?\.remove\(\)/
);
assert.match(
  source,
  /function arrangeWatchComments\(\) \{\s*positionCommentsAfterRecommendations\(\);\s*removeLegacyCommentPagination\(\);/
);
assert.match(
  source,
  /ytd-commentbox #contenteditable-root,[\s\S]*font-size: 16px !important;/
);

console.log('recommendations precede native comments without focus zoom: ok');
