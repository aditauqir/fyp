const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = '2.2.12';
const releasePath = path.join(root, `${version}_release.zip`);
const orionZipPath = path.join(
  root,
  `fuck-youtube-premium-orion-${version}.zip`
);
const xpiPath = path.join(
  root,
  `fuck-youtube-premium-orion-${version}.xpi`
);
const firefoxZipPath = path.join(
  root,
  `fuck-youtube-premium-firefox-${version}.zip`
);
const chromeZipPath = path.join(
  root,
  `fuck-youtube-premium-chrome-${version}.zip`
);
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(root, 'firefox-extension', 'manifest.json'),
    'utf8'
  )
);
const buildScript = fs.readFileSync(
  path.join(root, 'rebuild-extension.sh'),
  'utf8'
);

assert.equal(manifest.manifest_version, 2);
assert.equal(manifest.version, version);
assert.ok(fs.existsSync(releasePath), 'release ZIP exists');
assert.ok(fs.existsSync(orionZipPath), 'minimal Orion ZIP exists');
assert.ok(fs.existsSync(xpiPath), 'Orion XPI exists');
assert.ok(fs.existsSync(firefoxZipPath), 'Firefox zip exists');
assert.ok(fs.existsSync(chromeZipPath), 'preferred Chrome zip exists');
assert.deepEqual(fs.readFileSync(xpiPath), fs.readFileSync(firefoxZipPath));
assert.deepEqual(
  fs.readFileSync(releasePath),
  fs.readFileSync(chromeZipPath)
);
assert.match(buildScript, /ORION_XPI=/);
assert.match(buildScript, /ORION_ZIP=/);
assert.match(buildScript, /RELEASE_ZIP=/);
assert.match(buildScript, /cp "\$FF_ZIP" "\$ORION_XPI"/);
assert.match(buildScript, /cp "\$CH_ZIP" "\$RELEASE_ZIP"/);
assert.match(buildScript, /Chrome-format ZIP matching v2\.0\.20/);

console.log('new-version v2.0.20-style Chrome ZIP plus fallbacks: ok');
