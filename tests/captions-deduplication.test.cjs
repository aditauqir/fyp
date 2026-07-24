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
assert.match(
  source,
  /video\[data-fyp-native-captions-hidden='true'\]::cue \{\s*visibility: hidden !important;/
);
assert.match(
  source,
  /video\[data-fyp-native-captions-hidden='true'\]::cue \{[\s\S]*?color: transparent !important;/
);
assert.match(source, /function suppressDuplicateNativeCaptions\(video/);
assert.match(source, /track\.mode = 'hidden'/);
assert.match(source, /video\.dataset\.fypNativeCaptionsHidden = 'true'/);
assert.match(
  source,
  /video::?-webkit-media-text-track-container|video::-webkit-media-text-track-container/
);
assert.doesNotMatch(
  source,
  /\.ytp-caption-window-container\s*\{[^}]*display: none !important/
);

console.log('native WebVTT renderer suppressed beside YouTube captions: ok');
