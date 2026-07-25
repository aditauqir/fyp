const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(source, /@version\s+2\.1\.8/);
assert.match(source, /@release-label\s+2\.1\.8/);
assert.match(source, /function installInlinePlaybackGuard\(\)/);
assert.match(source, /video\.disablePictureInPicture = false/);
assert.match(source, /video\.requestPictureInPicture\(\)/);
assert.match(source, /ytd-watch-flexy #primary[\s\S]*?min-width: 0 !important/);
assert.match(source, /--ytd-rich-grid-items-per-row: 1 !important/);
assert.match(source, /ytd-browse\[page-subtype='channels'\]/);
assert.match(source, /ytd-channel-video-player-renderer/);
assert.match(source, /max-width: 100vw !important/);
const channelLayoutStart = source.indexOf(
  "ytd-browse[page-subtype='channels']"
);
const channelLayoutEnd = source.indexOf(
  "Keep YouTube's native desktop search form",
  channelLayoutStart
);
const channelLayout = source.slice(channelLayoutStart, channelLayoutEnd);
assert.doesNotMatch(channelLayout, /flex-direction:\s*column/);
assert.doesNotMatch(channelLayout, /display:\s*block/);

for (const forbidden of [
  'installFullscreenGuard',
  'exitAccidentalFullscreen',
  'forceInlineSoon',
  "removeAttribute('guide-persistent')",
  "removeAttribute('mini-guide-visible')",
]) {
  assert.equal(source.includes(forbidden), false, forbidden);
}

assert.match(
  source,
  /function ensurePlayerControlsToolbar\(\)[\s\S]*location\.pathname !== '\/watch'/
);
assert.doesNotMatch(source, /ytd-page-manager\.ytd-app/);
assert.match(source, /overscroll-behavior-x: none !important/);
assert.match(source, /overflow-x: clip !important/);
assert.match(source, /function enforceHorizontalViewportLock\(\)/);
assert.match(source, /scrollingElement\.scrollLeft = 0/);
assert.match(source, /'scroll',\s*enforceHorizontalViewportLock/);
assert.doesNotMatch(source, /resetHorizontalViewport/);
assert.match(source, /overflow-x: hidden !important/);

console.log('inline playback and mobile layout guards: ok');
