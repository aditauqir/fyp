const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(source, /const COMMENT_PREVIEW_COUNT = 3;/);
assert.match(source, /const COMMENT_LOAD_STEP = 5;/);
assert.match(
  source,
  /commentUiState\.visibleCount \+= COMMENT_LOAD_STEP;/
);
assert.match(
  source,
  /Math\.min\(COMMENT_LOAD_STEP, remaining\)/
);
assert.match(source, /<span>Show more<\/span>/);
assert.match(source, /<span>Show fewer<\/span>/);
assert.match(
  source,
  /!thread\.closest\('ytd-comment-replies-renderer'\)/
);
assert.match(
  source,
  /const shouldShowLoadMore = hasMoreLoaded \|\| hasContinuation;/
);

console.log('comments paginate 3 then 5: ok');
