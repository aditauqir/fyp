const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const folder of ['chrome-extension', 'firefox-extension']) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', folder, 'manifest.json'), 'utf8')
  );
  const action = manifest.action || manifest.browser_action;
  assert.ok(action, `${folder} action`);
  assert.equal('default_popup' in action, false, `${folder} default_popup`);
}

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);
assert.match(source, /__ytMobileOrionInlinePlaybackGuardV2/);
assert.match(source, /patchVideoCreation\(Document\.prototype, 'createElement'\)/);
assert.match(source, /function inlineBeforeVideoSource\(name\)/);
assert.match(source, /HTMLMediaElement\.prototype,\s*'src'/);
assert.match(source, /function explicitFullscreenOnly\(\)/);
assert.match(source, /function explicitPresentationModeOnly\(mode\)/);
assert.match(source, /state\.fullscreenIntentUntil = Date\.now\(\) \+ 2000/);
assert.doesNotMatch(
  source,
  /\.ytp-fullscreen-button,[\s\S]{0,180}display: none !important/
);

console.log('action card and explicit fullscreen manifest: ok');
