const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(source, /@version\s+2.2.13/);
assert.match(source, /@release-label\s+2.2.13/);
assert.match(source, /function installInlinePlaybackGuard\(\)/);
assert.match(source, /video\.disablePictureInPicture = false/);
assert.match(source, /video\.requestPictureInPicture\(\)/);
assert.match(source, /ytd-watch-flexy #primary[\s\S]*?min-width: 0 !important/);
assert.match(source, /--ytd-rich-grid-items-per-row: 1 !important/);
assert.match(source, /ytd-browse\[page-subtype='channels'\]/);
assert.match(source, /ytd-channel-video-player-renderer/);
assert.match(source, /max-width: 100% !important/);
assert.match(source, /HISTORY_FEED_ATTR = 'data-fyp-feed'/);
assert.match(source, /function markHistoryFeedBrowse\(\)/);
assert.match(source, /ytd-browse\[page-subtype='history'\]/);
assert.match(
  source,
  /ytd-browse\[page-subtype='history'\][\s\S]*flex-direction: column !important/
);
assert.match(
  source,
  /ytd-browse\[page-subtype='history'\][\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/
);
assert.match(
  source,
  /ytLockupViewModelContentImage/
);
assert.match(
  source,
  /ytd-browse\[page-subtype='history'\][\s\S]*ytd-browse-feed-actions-renderer[\s\S]*order: -1 !important/
);
assert.match(
  source,
  /ytd-browse\[page-subtype='history'\][\s\S]*#video-title[\s\S]*white-space: normal !important/
);
assert.match(
  source,
  /ytd-browse\[page-subtype='history'\][\s\S]*align-items: center !important/
);
assert.match(
  source,
  /ytd-two-column-browse-results-renderer[\s\S]*padding: 0 12px !important/
);
assert.match(
  source,
  /ytd-browse\[page-subtype='history'\][\s\S]*yt-chip-cloud-renderer[\s\S]*justify-content: center !important/
);
assert.match(
  source,
  /ytd-browse\[page-subtype='history'\][\s\S]*yt-img-shadow#avatar[\s\S]*visibility: visible !important/
);
const channelLayoutStart = source.indexOf(
  "ytd-browse[page-subtype='channels'],\n        ytd-browse[page-subtype='channels'] #primary"
);
assert.notEqual(channelLayoutStart, -1, 'channels layout block missing');
const historyLayoutStart = source.indexOf(
  "ytd-browse[page-subtype='history'],\n        ytd-browse[${HISTORY_FEED_ATTR}='history']",
  channelLayoutStart
);
assert.notEqual(historyLayoutStart, -1, 'history layout block missing');
const channelLayout = source.slice(channelLayoutStart, historyLayoutStart);
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
assert.match(source, /ytd-app,\s*ytm-app/);
assert.match(source, /'scroll',\s*enforceHorizontalViewportLock/);
assert.doesNotMatch(source, /resetHorizontalViewport/);
assert.match(source, /overflow-x: hidden !important/);
assert.match(
  source,
  /ytd-page-manager,\s*[\s\S]*?#content\.ytd-app[\s\S]*?overflow-x: hidden !important/
);

console.log('inline playback and mobile layout guards: ok');
