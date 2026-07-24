const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(source, /const PLAYER_CONTROLS_VISIBLE_MS = 10000;/);
assert.match(source, /function holdPlayerControlsVisible\(\)/);
assert.match(source, /player\.dataset\.fypControlsVisible = 'true';/);
assert.match(
  source,
  /delete player\.dataset\.fypControlsVisible;[\s\S]*PLAYER_CONTROLS_VISIBLE_MS/
);
assert.doesNotMatch(
  source,
  /function onVideoPlay\(\) \{[^}]*holdPlayerControlsVisible\(\);/
);
assert.match(
  source,
  /function recordPlayerControlIntent\(event\)[\s\S]*target\.closest\([\s\S]*#movie_player[\s\S]*holdPlayerControlsVisible\(\);/
);
assert.match(
  source,
  /\.html5-video-player\[data-fyp-controls-visible='true'\] \.ytp-chrome-bottom/
);
assert.match(source, /visibility: visible !important;/);
assert.match(source, /opacity: 1 !important;/);

console.log('player controls hide 10 seconds after user interaction: ok');
