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
assert.match(source, /function chooseBestCaptionTrack\(tracks\)/);
assert.match(source, /if \(english && !automatic\) score \+= 400/);
assert.match(source, /else if \(english && automatic\) score \+= 300/);
assert.match(
  source,
  /track\.mode = track === selectedTrack \? 'hidden' : 'disabled'/
);
assert.match(source, /selectedCaptionTrackByVideo\.set\(video, selectedTrack\)/);
assert.match(source, /const newlyActiveTracks = activeTracks\.filter/);
assert.match(
  source,
  /previousTrack &&[\s\S]*?!activeTracks\.length[\s\S]*?selectedCaptionTrackByVideo\.delete\(video\)/
);
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
