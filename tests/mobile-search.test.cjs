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

assert.match(source, /\/\/ @version\s+2\.2\.1/);
assert.match(source, /data-fyp-page-ready', '2\.2\.1'/);
assert.match(source, /const MOBILE_SEARCH_OPEN_ATTR = 'data-fyp-mobile-search-open'/);
assert.match(source, /const MOBILE_SEARCH_TRIGGER_SELECTOR = \[/);
assert.match(source, /function closeMobileSearch\(\)/);
assert.match(source, /function handleMobileSearchClick\(event\)/);
assert.match(source, /const NAV_LAYOUT_VERSION = 'ext-v221-native-search-recovery'/);
assert.match(source, /injectCriticalAskHideStyle/);

// Restored 2.1.2-style native masthead search overlay after icon tap.
assert.match(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #center[\s\S]*position: fixed !important/
);
assert.match(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] input#search[\s\S]*font-size: 16px !important/
);
assert.match(source, /input\.focus\(\{ preventScroll: true \}\)/);
assert.match(source, /Ask YouTube/);
assert.match(source, /#voice-search-button/);

// Broken 2.1.5–2.2.0 custom search must stay gone.
assert.doesNotMatch(source, /SEARCH_OVERLAY_ID/);
assert.doesNotMatch(source, /SEARCH_TRIGGER_ID/);
assert.doesNotMatch(source, /UI_SKELETON_ID/);
assert.doesNotMatch(source, /UI_READY_ATTR/);
assert.doesNotMatch(source, /ensureSearchTrigger/);
assert.doesNotMatch(source, /ensureUiSkeleton/);
assert.doesNotMatch(source, /Searching for something\?/);
assert.doesNotMatch(source, /fyp-search-trigger--home/);
assert.doesNotMatch(source, /fyp-search-trigger--watch/);
assert.doesNotMatch(source, /home-feed-watch-pill/);
assert.doesNotMatch(source, /fyp-skel-shimmer/);
assert.doesNotMatch(source, /SEARCH_RECENTS_KEY/);
assert.doesNotMatch(source, /suggestqueries\.google\.com\/complete\/search/);
assert.doesNotMatch(source, /lucide lucide-search/);
assert.doesNotMatch(
  source,
  /bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 14px\)/
);

// Do not hide the native search icon / center form in critical or layout CSS.
assert.doesNotMatch(
  source,
  /ytd-masthead #center,\s*[\s\S]*ytd-masthead #search-button[\s\S]*display: none !important/
);

assert.match(template, /EXPECTED_PAGE_VERSION = '2\.2\.1'/);
assert.match(template, /Ask YouTube/);
assert.match(template, /#voice-search-button/);
assert.doesNotMatch(
  template,
  /Mirror page\.js: hide native masthead search/
);
assert.doesNotMatch(
  template,
  /ytd-masthead #center,\s*[\s\S]*ytd-masthead #search-button/
);

console.log('mobile search native 2.1.2 recovery: ok');
