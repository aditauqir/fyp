const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(source, /const MOBILE_SEARCH_OPEN_ATTR = 'data-fyp-mobile-search-open'/);
assert.match(source, /function handleMobileSearchClick\(event\)/);
assert.match(source, /input#search, input\[name="search_query"\], \.yt-searchbox-input/);
assert.match(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #center[\s\S]*position: fixed !important/
);
assert.match(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] input#search[\s\S]*font-size: 16px !important/
);
assert.match(source, /event\.stopImmediatePropagation\(\)/);
assert.match(source, /input\.focus\(\{ preventScroll: true \}\)/);

console.log('mobile search opens the native form at phone width: ok');
