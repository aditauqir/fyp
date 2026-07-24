const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = '2.0.19';
const xpiPath = path.join(
  root,
  `fuck-youtube-premium-orion-${version}.xpi`
);
const firefoxZipPath = path.join(
  root,
  `fuck-youtube-premium-firefox-${version}.zip`
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
assert.ok(fs.existsSync(xpiPath), 'Orion XPI exists');
assert.ok(fs.existsSync(firefoxZipPath), 'Firefox zip exists');
assert.deepEqual(fs.readFileSync(xpiPath), fs.readFileSync(firefoxZipPath));
assert.match(buildScript, /ORION_XPI=/);
assert.match(buildScript, /cp "\$FF_ZIP" "\$ORION_XPI"/);

console.log('Orion-first XPI package mirrors the validated Firefox build: ok');
