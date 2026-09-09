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

assert.match(source, /\/\/ @version\s+3\.1\.[1-9](\.g)?/);
assert.match(source, /data-fyp-page-ready', '3\.1\.[1-9](\.g)?'/);
assert.match(source, /const MOBILE_SEARCH_OPEN_ATTR = 'data-fyp-mobile-search-open'/);
assert.match(source, /const MOBILE_SEARCH_TRIGGER_SELECTOR = \[/);
assert.match(source, /function closeMobileSearch\(\)/);
assert.match(source, /function handleMobileSearchClick\(event\)/);
assert.match(source, /const NAV_LAYOUT_VERSION = 'ext-v310-search-bar'/);
assert.match(source, /injectCriticalAskHideStyle/);

// Search cards stay under ytd-search. Screenshot stack. Home is untouched.
assert.match(
  source,
  /ytd-search ytd-video-renderer #dismissible\.ytd-video-renderer,[\s\S]*display: grid !important;[\s\S]*grid-template-areas:/
);
assert.match(
  source,
  /"channel channel"[\s\S]*"thumb thumb"[\s\S]*"snippet snippet"[\s\S]*"title menu"/
);
assert.match(source, /\.ytLockupViewModelHorizontal,/);
assert.match(source, /ytd-search ytd-video-renderer ytd-thumbnail[\s\S]*grid-area: thumb !important/);
assert.doesNotMatch(
  source,
  /ytd-search ytd-video-renderer ytd-thumbnail[\s\S]{0,400}order: -1 !important/
);
assert.match(source, /aspect-ratio: 16 \/ 9 !important/);
assert.match(source, /\[class\*='content-image' i\]/);
assert.match(
  source,
  /ytd-search ytd-video-renderer ytd-video-meta-block #byline-container \{\s*display: none !important;/
);
assert.match(source, /display: contents !important/);
assert.match(
  source,
  /ytd-search ytd-video-renderer #channel-info[\s\S]*grid-area: channel !important/
);
assert.match(
  source,
  /yt-lockup-metadata-view-model__title[\s\S]*grid-area: title !important/
);
assert.match(
  source,
  /#description-text[\s\S]*grid-area: snippet !important/
);
assert.match(source, /dismissible\.insertBefore\(channel, thumb\)/);
assert.match(source, /-webkit-line-clamp: 1 !important/);
assert.match(source, /ytd-info-panel-container-renderer/);
assert.match(
  source,
  /ytd-expandable-metadata-renderer:has\(\[aria-label\*='Summary' i\]\)/
);
assert.match(source, /text\.includes\('chapter'\)/);
assert.match(
  source,
  /yt-decorated-avatar-view-model[\s\S]*aspect-ratio: 1 \/ 1 !important/
);
assert.match(source, /const onResults = location\.pathname\.startsWith\('\/results'\);/);
assert.doesNotMatch(
  source,
  /Boolean\(document\.querySelector\('ytd-search'\)\)/
);
assert.doesNotMatch(
  source,
  /html\[\$\{SIMPLE_SEARCH_ATTR\}='true'\] #details/
);
assert.doesNotMatch(
  source,
  /html\[\$\{SIMPLE_SEARCH_ATTR\}='true'\] #video-title/
);
assert.doesNotMatch(
  source,
  /html\[\$\{SIMPLE_SEARCH_ATTR\}='true'\] yt-decorated-avatar-view-model/
);
assert.doesNotMatch(
  source,
  /ytd-search[\s\S]{0,400}height: 100vh/
);
assert.match(
  source,
  /#description-text,[\s\S]*display: -webkit-box !important/
);
assert.doesNotMatch(
  source,
  /grid-template-columns: 132px minmax\(0, 1fr\)/
);

// Restored 2.1.2-style native masthead search overlay after icon tap.
assert.match(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #center[\s\S]*position: fixed !important/
);
assert.match(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #center[\s\S]*width: calc\(100vw - 24px\) !important/
);
assert.match(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #end #search-button/
);
assert.match(source, /\.ytSearchboxComponentInput/);
assert.match(source, /ytd-masthead yt-searchbox/);
assert.doesNotMatch(
  source,
  /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #center \{[\s\S]{0,400}width: auto !important/
);
assert.match(source, /SEARCH_BACKDROP_ID = 'fyp-search-backdrop'/);
assert.match(source, /function ensureMobileSearchElements\(\)/);
assert.doesNotMatch(source, /center\.prepend\(backBtn\)/);
assert.match(source, /#fyp-search-back-button[\s\S]*display: none !important/);
assert.match(source, /body\[data-fyp-search-active='true'\] #guide-button/);
assert.match(source, /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #guide-button/);
assert.match(source, /#fyp-search-backdrop/);
assert.match(source, /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] #center[\s\S]*overflow: visible !important/);
assert.match(source, /ytd-masthead\[\$\{MOBILE_SEARCH_OPEN_ATTR\}='true'\] \.ytSearchboxComponentSuggestionsContainer/);
assert.match(source, /input\.blur\(\)/);
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

assert.match(template, /EXPECTED_PAGE_VERSION = '3\.1\.[1-9](\.g)?'/);
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
