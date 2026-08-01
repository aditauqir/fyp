const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(
  path.join(root, 'youtube-mobile-background.user.js'),
  'utf8'
);
const content = fs.readFileSync(
  path.join(root, 'firefox-extension', 'content.template.js'),
  'utf8'
);

const pageVersion = page.match(
  /setAttribute\('data-fyp-page-ready', '([^']+)'\)/
)?.[1];
const expectedVersion = content.match(
  /EXPECTED_PAGE_VERSION = '([^']+)'/
)?.[1];
assert.equal(expectedVersion, pageVersion, 'page/fallback handshake versions match');

assert.match(page, /MEDIA_SESSION_OWNER_KEY = 'fyp:media-session-owner:v1'/);
assert.match(page, /function claimMediaSessionOwnership\(/);
assert.match(page, /function ownsMediaSession\(/);
assert.match(page, /function deactivateMediaSessionForThisTab\(/);
assert.match(page, /if \(!ownsMediaSession\(\)\) return;/);
assert.match(
  page,
  /currentOwner\.tabId !== mediaSessionTabId[\s\S]*isReallyHidden\(\)/
);
assert.match(
  page,
  /event\.key !== MEDIA_SESSION_OWNER_KEY[\s\S]*deactivateMediaSessionForThisTab\(\)/
);
assert.match(page, /navigator\.mediaSession\.playbackState = 'none'/);
assert.match(page, /navigator\.mediaSession\.metadata = null/);
assert.match(page, /PAGE_SCAN_MIN_INTERVAL_MS = 1200/);
assert.match(
  page,
  /PAGE_SCAN_MIN_INTERVAL_MS - \(Date\.now\(\) - lastPageScanAt\)/
);

assert.match(content, /function claimFallbackMediaSessionOwnership\(/);
assert.match(content, /function fallbackOwnsMediaSession\(/);
assert.match(content, /function deactivateFallbackMediaSession\(/);
assert.match(
  content,
  /const videoObserver = new MutationObserver\(\(mutations\) => \{\s*if \(pageRuntimeReady\(\)\)/
);
assert.match(
  content,
  /setInterval\(\(\) => \{\s*if \(pageRuntimeReady\(\)\) return;\s*markFallbackHistoryFeedBrowse\(\)/
);
assert.match(
  content,
  /setInterval\(\(\) => \{\s*if \(pageRuntimeReady\(\)\) return;\s*skipFallbackPlayerAd\(\)/
);

console.log('single-owner Media Session and page/fallback handshake: ok');
