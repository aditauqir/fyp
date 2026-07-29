const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  /const desired = track === selectedTrack \? 'hidden' : 'disabled'/
);
assert.match(source, /if \(track\.mode === desired\) continue/);
assert.match(source, /track\.mode = desired/);
assert.match(
  source,
  /if \(!customCaptionsVisible\) \{[\s\S]*?delete video\.dataset\.fypNativeCaptionsHidden;[\s\S]*?return;/
);
assert.doesNotMatch(
  source,
  /!customCaptionsVisible && activeTracks\.length <= 1/
);
assert.match(
  source,
  /video\.dataset\.fypNativeCaptionsHidden = 'true'/
);
assert.match(
  source,
  /Caption contract: YouTube's custom caption DOM is the sole visible owner/
);
assert.match(
  source,
  /Keep exactly one TextTrack active \(mode "hidden"\)/
);
assert.doesNotMatch(source, /nativeCaptions\.click\(\)/);
assert.match(
  source,
  /Drive YouTube's caption module exclusively; do not click the native/
);
assert.match(source, /video::?-webkit-media-text-track-container|video::-webkit-media-text-track-container/);
assert.doesNotMatch(
  source,
  /\.ytp-caption-window-container\s*\{[^}]*display: none !important/
);
assert.match(
  source,
  /const key = `\$\{label\}\|\$\{language\}`[\s\S]*?if \(seen\.has\(key\)\) return false/
);

const helperStart = source.indexOf('  function captionTrackLabel(track)');
const helperEnd = source.indexOf(
  '  function suppressDuplicateNativeCaptions(',
  helperStart
);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'caption helpers');
const helpers = source.slice(helperStart, helperEnd);

function choose(tracks) {
  const context = { tracks, selected: null };
  vm.runInNewContext(
    `${helpers}\nselected = chooseBestCaptionTrack(tracks);`,
    context
  );
  return context.selected;
}

const authoredA = {
  label: 'English (United States)',
  language: 'en-US',
  mode: 'showing',
};
const authoredB = {
  label: 'English (United States)',
  language: 'en-US',
  mode: 'showing',
};
const automaticEnglish = {
  label: 'English (auto-generated)',
  language: 'en',
  mode: 'showing',
};

assert.equal(choose([authoredB, authoredA, automaticEnglish]), authoredB);
assert.equal(choose([automaticEnglish, authoredA]), authoredA);

console.log('native WebVTT renderer suppressed beside YouTube captions: ok');
