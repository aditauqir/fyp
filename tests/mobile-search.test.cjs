const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'youtube-mobile-background.user.js'),
  'utf8'
);
const template = fs.readFileSync(
  path.join(root, 'firefox-extension', 'content.template.js'),
  'utf8'
);

assert.match(source, /\/\/ @version\s+2\.1\.8/);
assert.match(source, /data-fyp-page-ready', '2\.1\.8'/);
assert.match(source, /const MOBILE_SEARCH_OPEN_ATTR = 'data-fyp-mobile-search-open'/);
assert.match(source, /const SEARCH_OVERLAY_ID = `\$\{SCRIPT_ID\}-search-overlay`/);
assert.match(source, /const SEARCH_TRIGGER_ID = `\$\{SCRIPT_ID\}-search-trigger`/);
assert.match(source, /const SEARCH_TRIGGER_LAYOUT_VERSION = 'capsule-v217'/);
assert.match(source, /const NAV_LAYOUT_VERSION = 'ext-v217-search-overlay-suggest'/);
assert.match(source, /function handleMobileSearchClick\(event\)/);
assert.match(source, /function openMobileSearch\(\)/);
assert.match(source, /function submitMobileSearch\(/);
assert.match(source, /function ensureSearchTrigger\(\)/);
assert.match(source, /class="fyp-search-input"/);
assert.match(source, /class="fyp-search-trigger-label">Search</);
assert.match(source, /data-fyp-search-action="close"/);
assert.match(source, /data-fyp-search-action="submit"/);
assert.match(source, /ytd-masthead #center,\s*[\s\S]*display: none !important/);
assert.match(source, /#\$\{SEARCH_OVERLAY_ID\}\.is-open/);
assert.match(source, /font-size: 16px/);
assert.match(source, /text-align: center/);
assert.match(source, /ease-in-out/);
assert.match(source, /background: #000 !important/);
assert.match(source, /position: fixed !important/);
assert.match(source, /bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 14px\)/);
assert.match(source, /lucide lucide-search/);
assert.match(source, /lucide lucide-x/);
assert.match(source, /m21 21-4\.34-4\.34/);
assert.match(source, /host\.appendChild\(trigger\)/);
assert.match(source, /results\?search_query|searchParams\.set\('search_query'/);
assert.match(source, /input\.focus\(\{ preventScroll: true \}\)/);
assert.doesNotMatch(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #center[\s\S]*position: fixed !important/
);
assert.doesNotMatch(source, /fyp-search-trigger-chevron|lucide-chevron-down/);
assert.match(source, /const SEARCH_RECENTS_KEY/);
assert.match(source, /const SEARCH_OVERLAY_LAYOUT_VERSION = 'suggest-recents-v217'/);
assert.match(source, /function rememberRecentSearch\(/);
assert.match(source, /function fetchYouTubeSuggestions\(/);
assert.match(source, /function refreshSearchSuggestions\(/);
assert.match(source, /class="fyp-search-suggestions"/);
assert.match(source, /data-fyp-search-action="suggest"/);
assert.match(source, /suggestqueries\.google\.com\/complete\/search/);
assert.match(source, /localStorage\.getItem\(SEARCH_RECENTS_KEY\)/);
assert.match(source, /NAV_LAYOUT_VERSION = 'ext-v217-search-overlay-suggest'/);


assert.match(template, /EXPECTED_PAGE_VERSION = '2\.1\.8'/);
assert.match(template, /lucide lucide-search/);
assert.match(template, /lucide lucide-x/);
assert.match(template, /ytd-masthead #search-button/);

console.log('mobile search capsule trigger + overlay: ok');
