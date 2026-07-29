const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(source, /function installYoutubeCpuTamer\(win/);
assert.match(source, /function shouldInstallYoutubeCpuTamer\(win/);
assert.match(source, /const CPU_TAMER_ENABLED_BY_DEFAULT = false/);
assert.match(source, /win\.__fypEnableCpuTamer === true/);
assert.match(source, /localStorage\?\.getItem\('fypEnableCpuTamer'\)/);
assert.match(
  source,
  /if \(shouldInstallYoutubeCpuTamer\(window\)\) \{\s*installYoutubeCpuTamer\(window\);/
);
assert.match(
  source,
  /setAttribute\('data-fyp-cpu-tamer', '0'\)/
);

console.log('CPU tamer gated off by default: ok');
