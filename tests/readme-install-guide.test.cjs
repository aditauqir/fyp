const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const install = fs.readFileSync(path.join(root, 'INSTALL-ORION.md'), 'utf8');

assert.match(readme, /## For iOS and Orion Browser/);
assert.match(readme, /apps\.apple\.com\/us\/app\/orion-browser-by-kagi\/id1484498200/);
assert.match(readme, /logo=apple/);
assert.match(readme, /logo=safari/);
assert.match(readme, /logo=ublockorigin/);
assert.match(readme, /github\.com\/aditauqir\/fyp\/releases\/latest/);
assert.match(readme, /addons\.mozilla\.org\/en-US\/firefox\/addon\/ublock-origin/);
assert.match(readme, /## Final extension result/);
assert.match(readme, /docs\/images\/final-extension-result\.png/);
assert.match(readme, /docs\/images\/youtube-watch-page\.png/);
assert.match(readme, /docs\/images\/youtube-mobile-feed\.png/);
assert.match(readme, /docs\/images\/orion-install-from-file\.png/);
assert.match(readme, /“OTA” update detection and downloads/);
assert.match(readme, /Always install the downloaded update manually/);
assert.match(install, /always choose `\+` → `Install from File`/);

for (const image of [
  'final-extension-result.png',
  'youtube-watch-page.png',
  'youtube-mobile-feed.png',
  'orion-install-from-file.png',
]) {
  assert.ok(fs.existsSync(path.join(root, 'docs', 'images', image)), image);
}

console.log('illustrated iOS, Orion, uBlock, and update guide: ok');
