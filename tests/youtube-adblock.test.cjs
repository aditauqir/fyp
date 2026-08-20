const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);
const template = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'content.template.js'),
  'utf8'
);
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

assert.match(source, /__vmYtPlayerResponseFilterV3/);
assert.match(source, /function isBlockedAdRequest\(/);
assert.match(source, /doubleclick\.net/);
assert.match(source, /\/pagead\//);
assert.match(source, /\/api\/stats\/ads/);
assert.match(source, /navigator\.sendBeacon/);
assert.match(source, /bindPrunedWindowJson\('ytInitialData'\)/);
assert.match(source, /function playerIsSkippingAd\(/);
assert.match(source, /function restoreAdSkipTweaks\(/);
assert.match(source, /MAX_AD_SEEK_DURATION_S = 90/);
assert.match(source, /adVideo\.currentTime = duration/);
assert.match(source, /adVideo\.playbackRate = 16/);
assert.match(source, /greasyfork\.org\/en\/scripts\/561518-universal-ad-blocker-pro/);
assert.doesNotMatch(source, /removeFacebookAds/);
assert.doesNotMatch(source, /removeTwitterAds/);
assert.doesNotMatch(source, /removeInstagramAds/);
assert.doesNotMatch(source, /removeRedditAds/);
assert.doesNotMatch(source, /google-analytics\.com/);
assert.doesNotMatch(source, /BLOCKED_AD_PATH_SNIPPETS = \[[^\]]*\/analytics/);
assert.doesNotMatch(source, /duration - 0\.05/);

assert.match(template, /function skipFallbackPlayerAd\(/);
assert.match(template, /FALLBACK_MAX_AD_SEEK_DURATION_S = 90/);
assert.match(template, /restoreFallbackAdSkipTweaks/);

assert.match(readme, /## Credits/);
assert.match(readme, /Gorstak/);
assert.match(readme, /You do not need uBlock Origin/);

console.log('built-in YouTube ad blocking: ok');
