const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(source, /const MOBILE_SEARCH_OPEN_ATTR = 'data-fyp-mobile-search-open'/);
assert.match(source, /const SEARCH_OVERLAY_ID = `\$\{SCRIPT_ID\}-search-overlay`/);
assert.match(source, /const SEARCH_TRIGGER_ID = `\$\{SCRIPT_ID\}-search-trigger`/);
assert.match(source, /function handleMobileSearchClick\(event\)/);
assert.match(source, /function openMobileSearch\(\)/);
assert.match(source, /function submitMobileSearch\(\)/);
assert.match(source, /function ensureSearchTrigger\(\)/);
assert.match(source, /class="fyp-search-input"/);
assert.match(source, /data-fyp-search-action="close"/);
assert.match(source, /data-fyp-search-action="submit"/);
assert.match(source, /ytd-masthead #center,\s*[\s\S]*display: none !important/);
assert.match(source, /#\$\{SEARCH_OVERLAY_ID\}\.is-open/);
assert.match(source, /font-size: 16px/);
assert.match(source, /results\?search_query|searchParams\.set\('search_query'/);
assert.match(source, /input\.focus\(\{ preventScroll: true \}\)/);
assert.doesNotMatch(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #center[\s\S]*position: fixed !important/
);

console.log('mobile search overlay is close + input + submit: ok');
