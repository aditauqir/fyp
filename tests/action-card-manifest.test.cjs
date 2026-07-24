const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const folder of ['chrome-extension', 'firefox-extension']) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', folder, 'manifest.json'), 'utf8')
  );
  const action = manifest.action || manifest.browser_action;
  assert.ok(action, `${folder} action`);
  assert.equal(action.default_popup, 'popup.html', `${folder} default_popup`);
  assert.ok(manifest.permissions.includes('activeTab'), `${folder} activeTab`);
}

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);
const content = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'content.template.js'),
  'utf8'
);
const background = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'background.js'),
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
assert.doesNotMatch(content, /toggleActionCard/);
assert.doesNotMatch(content, /attachShadow/);
assert.doesNotMatch(background, /toggleActionCard/);

console.log('direct popup and explicit fullscreen manifest: ok');
