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

assert.match(source, /\/\/ @version\s+2\.2\.0/);
assert.match(source, /data-fyp-page-ready', '2\.2\.0'/);
assert.match(source, /const MOBILE_SEARCH_OPEN_ATTR = 'data-fyp-mobile-search-open'/);
assert.match(source, /const SEARCH_OVERLAY_ID = `\$\{SCRIPT_ID\}-search-overlay`/);
assert.match(source, /const SEARCH_TRIGGER_ID = `\$\{SCRIPT_ID\}-search-trigger`/);
assert.match(source, /const UI_SKELETON_ID = `\$\{SCRIPT_ID\}-ui-skeleton`/);
assert.match(source, /const UI_READY_ATTR = 'data-fyp-ui-ready'/);
assert.match(source, /const SEARCH_TRIGGER_LAYOUT_VERSION = 'home-feed-watch-pill-v220'/);
assert.match(source, /const NAV_LAYOUT_VERSION = 'ext-v220-home-watch-search'/);
assert.match(source, /const SEARCH_OVERLAY_LAYOUT_VERSION = 'prompt-recents-v220'/);
assert.match(source, /function injectCriticalSearchStyle\(\)/);
assert.match(source, /function ensureUiSkeleton\(\)/);
assert.match(source, /function dismissUiSkeletonIfReady\(\)/);
assert.match(source, /function handleMobileSearchClick\(event\)/);
assert.match(source, /function openMobileSearch\(\)/);
assert.match(source, /function submitMobileSearch\(/);
assert.match(source, /function ensureSearchTrigger\(\)/);
assert.match(source, /function findHomeFirstVideoHost\(\)/);
assert.match(source, /Searching for something\?/);
assert.match(source, /class="fyp-search-prompt"/);
assert.match(source, /class="fyp-search-input"/);
assert.match(source, /data-fyp-search-action="close"/);
assert.match(source, /data-fyp-search-action="submit"/);
assert.match(source, /fyp-search-trigger--home/);
assert.match(source, /fyp-search-trigger--watch/);
assert.match(source, /ytd-masthead #center,\s*[\s\S]*display: none !important/);
assert.match(source, /Ask YouTube/);
assert.match(source, /#voice-search-button/);
assert.match(source, /#\$\{SEARCH_OVERLAY_ID\}\.is-open/);
assert.match(source, /font-size: 16px/);
assert.match(source, /ease-in-out/);
assert.match(source, /fyp-skel-home-search/);
assert.match(source, /fyp-skel-watch-search/);
assert.match(source, /fyp-skel-shimmer/);
assert.match(source, /width: min\(50%, 15\.5rem\)/);
assert.match(source, /translateZ\(0\)/);
assert.doesNotMatch(
  source,
  /bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 14px\)/
);
assert.doesNotMatch(
  source,
  /right: calc\(max\(env\(safe-area-inset-right, 0px\), 0px\) \+ 52px\)/
);
assert.doesNotMatch(source, /masthead-slot-v219/);
assert.match(source, /lucide lucide-search/);
assert.match(source, /lucide lucide-x/);
assert.match(source, /m21 21-4\.34-4\.34/);
assert.match(source, /results\?search_query|searchParams\.set\('search_query'/);
assert.match(source, /input\.focus\(\{ preventScroll: true \}\)/);
assert.doesNotMatch(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #center[\s\S]*position: fixed !important/
);
assert.doesNotMatch(source, /fyp-search-trigger-chevron|lucide-chevron-down/);
assert.match(source, /const SEARCH_RECENTS_KEY/);
assert.match(source, /function rememberRecentSearch\(/);
assert.match(source, /function fetchYouTubeSuggestions\(/);
assert.match(source, /function refreshSearchSuggestions\(/);
assert.match(source, /class="fyp-search-suggestions"/);
assert.match(source, /data-fyp-search-action="suggest"/);
assert.match(source, /suggestqueries\.google\.com\/complete\/search/);
assert.match(source, /localStorage\.getItem\(SEARCH_RECENTS_KEY\)/);
assert.match(source, /PHONE_WIDTH_MAX_PX = 700/);

assert.match(template, /EXPECTED_PAGE_VERSION = '2\.2\.0'/);
assert.match(template, /lucide lucide-search/);
assert.match(template, /lucide lucide-x/);
assert.match(template, /ytd-masthead #search-button/);
assert.match(template, /Ask YouTube/);
assert.match(template, /#voice-search-button/);

console.log('mobile search home/watch placement + skeleton: ok');
