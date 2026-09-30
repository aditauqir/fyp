const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const install = fs.readFileSync(path.join(root, 'INSTALL-ORION.md'), 'utf8');

assert.match(readme, /## What is this\?/);
assert.match(readme, /### Basically free YouTube Premium for iPhone/);
assert.match(readme, /## iPhone only — Orion Browser/);
assert.match(readme, /fed up with App Store apps and partial solutions/);
assert.match(readme, /screen-off audio/);
assert.match(readme, /apps\.apple\.com\/us\/app\/orion-browser-by-kagi\/id1484498200/);
assert.match(readme, /skillicons\.dev\/icons\?i=apple/);
assert.match(readme, /skillicons\.dev\/icons\?i=github/);
assert.match(readme, /logo=safari/);
assert.doesNotMatch(readme, /logo=ublockorigin/);
assert.match(readme, /discord\.gg\/sd5Y8f7ukh/);
assert.match(readme, /logo=discord/);
assert.match(readme, /Join%20the%20server%20for%20support%20or%20help/);
assert.match(readme, /github\.com\/aditauqir\/fyp\/releases\/latest/);
assert.doesNotMatch(readme, /mandatory for ad blocking/i);
assert.match(readme, /You do not need uBlock Origin/);
assert.match(readme, /Fyoutube treats YouTube's masthead search control as a trigger only/);
assert.match(readme, /search_query=blue\+balls/);
assert.match(readme, /current\s+YouTube search field may be a `textarea`/);
assert.match(readme, /## Credits/);
assert.match(
  readme,
  /greasyfork\.org\/en\/scripts\/561518-universal-ad-blocker-pro/
);
assert.match(readme, /Gorstak/);
assert.match(readme, /## Final extension result/);
assert.match(readme, /docs\/images\/final-extension-result\.png/);
assert.match(readme, /docs\/images\/youtube-mobile-feed\.png/);
assert.match(readme, /docs\/images\/player-inline-controls\.png/);
assert.match(readme, /docs\/images\/background-playback-lock-screen\.png/);
assert.match(readme, /docs\/images\/orion-install-from-file\.png/);
assert.match(readme, /checks GitHub on a schedule/);
assert.match(readme, /Uninstall the old \*\*Fyoutube\*\* extension/);
assert.match(install, /Tap \*\*\+\*\*\.[\s\S]*Tap \*\*Install from File\*\*\./);
assert.match(readme, /send a pull request/);
assert.match(readme, /github\.com\/aditauqir\/fyp\/compare/);
assert.match(readme, /Orion says the extension could not be installed/);
assert.match(readme, /Close the YouTube tab in Orion/);
assert.match(readme, /repeat steps 7–9 until Orion confirms the install/);
assert.match(readme, /3\.2\.3_release\.zip/);
assert.match(readme, /### Do not enable Request Desktop Website/);
assert.match(readme, /Set \*\*Request Desktop Website\*\* to off/);
assert.match(install, /Do not set Orion \*\*Request Desktop Website\*\*/);
assert.match(readme, /The extension selects the YouTube backend/);
assert.match(readme, /On My iPhone → Downloads/);
assert.match(readme, /uninstall/);
assert.ok(
  fs.existsSync(path.join(root, '3.2.3_release.zip')),
  'preferred Orion release ZIP'
);
assert.match(readme, /Tapping the extension icon shows no buttons/);
assert.match(readme, /three changelog lines, \*\*Go to YouTube\*\*/);
assert.match(readme, /orion-multiple-subtitle-tracks\.png/);
assert.match(readme, /Prefer an authored English track/);
assert.match(readme, /docs\/images\/player-inline-controls\.png/);

for (const image of [
  'final-extension-result.png',
  'youtube-watch-page.png',
  'youtube-mobile-feed.png',
  'player-inline-controls.png',
  'background-playback-lock-screen.png',
  'orion-install-from-file.png',
]) {
  assert.ok(fs.existsSync(path.join(root, 'docs', 'images', image)), image);
}

console.log('illustrated iOS, Orion, ads, and update guide: ok');
