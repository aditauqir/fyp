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
assert.match(source, /function findWatchPlaylistHost\(/);
assert.match(
  source,
  /if \(!descriptionBlock \|\| \(!playlist && !recommendations && !comments\)\) \{\s*return;/
);
assert.doesNotMatch(source, /if \(!descriptionBlock \|\| !comments\) return;/);
assert.doesNotMatch(source, /function expandCommentsSection\(/);
assert.doesNotMatch(
  source,
  /ytd-comments#comments,\s*ytd-comments\s*\{\s*display: block !important;/
);
assert.doesNotMatch(
  source,
  /ytd-watch-next-secondary-results-renderer'\) \|\|\s*watch\.querySelector\('#secondary'\)/
);
assert.match(
  source,
  /setImportantStyles\(playlist, \{\s*order: '2'/
);
assert.match(
  source,
  /setImportantStyles\(recommendations, \{\s*order: '3'/
);
assert.match(source, /if \(comments\) \{\s*setImportantStyles\(comments, \{\s*order: '4'/);
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
  /function arrangeWatchComments\(\) \{\s*restoreNativeCommentControls\(\);\s*positionCommentsAfterRecommendations\(\);\s*removeLegacyCommentPagination\(\);/
);
assert.match(
  source,
  /ytd-commentbox #contenteditable-root,[\s\S]*font-size: 16px !important;/
);
assert.match(source, /function restoreNativeCommentControls\(root = document\)/);
assert.match(
  source,
  /function arrangeWatchComments\(\) \{\s*restoreNativeCommentControls\(\);\s*positionCommentsAfterRecommendations\(\);/
);
assert.match(source, /order: 4 !important/);
assert.doesNotMatch(
  source,
  /comment\.dataset\.vmCommentEnhanced = 'true'/
);
assert.doesNotMatch(
  source,
  /actions\.className = 'vm-yt-comment-actions'|button\.className = 'vm-yt-comment-action'/
);
assert.doesNotMatch(source, /function enhanceComments\(/);
assert.doesNotMatch(source, /#toolbar\.ytd-comment-view-model[\s\S]*display: none/);

console.log('native comments preserve YouTube actions without focus zoom: ok');
