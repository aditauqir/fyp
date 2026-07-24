const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(
  source,
  /\.html5-video-player:has\(\s*\.ytp-caption-window-container \.ytp-caption-segment\s*\) video::cue/
);
assert.match(source, /video::cue \{[\s\S]*visibility: hidden !important;/);
assert.match(source, /video::cue \{[\s\S]*color: transparent !important;/);
assert.doesNotMatch(
  source,
  /\.ytp-caption-window-container[\s\S]{0,180}display: none !important/
);

console.log('native WebVTT duplicate hidden only beside YouTube captions: ok');
