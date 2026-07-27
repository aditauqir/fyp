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
  /customCaptionsVisible[\s\S]*?fypNativeCaptionsHidden = 'true'/
);
assert.match(
  source,
  /track\.mode === 'showing'[\s\S]*?track\.mode = 'hidden'/
);
assert.match(
  source,
  /Caption contract: YouTube's custom caption DOM is the sole visible owner/
);
assert.doesNotMatch(
  source,
  /nativeCaptions\.click\(\)/
);
assert.match(
  source,
  /Drive YouTube's caption module exclusively; do not click the native/
);
assert.match(source, /video::?-webkit-media-text-track-container|video::-webkit-media-text-track-container/);
assert.doesNotMatch(
  source,
  /\.ytp-caption-window-container\s*\{[^}]*display: none !important/
);

console.log('native WebVTT renderer suppressed beside YouTube captions: ok');
