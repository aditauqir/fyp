const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(source, /@version\s+2\.0\.20/);
assert.match(source, /function installInlinePlaybackGuard\(\)/);
assert.match(source, /video\.disablePictureInPicture = true/);
assert.match(source, /ytd-watch-flexy #primary[\s\S]*?min-width: 0 !important/);
assert.match(source, /--ytd-rich-grid-items-per-row: 1 !important/);

for (const forbidden of [
  'installFullscreenGuard',
  'exitAccidentalFullscreen',
  'forceInlineSoon',
  'requestPictureInPicture',
  "removeAttribute('guide-persistent')",
  "removeAttribute('mini-guide-visible')",
]) {
  assert.equal(source.includes(forbidden), false, forbidden);
}

console.log('inline playback and mobile layout guards: ok');
