const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popup = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'popup.html'),
  'utf8'
);
const popupScript = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'popup.js'),
  'utf8'
);
const popupStyle = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'popup.css'),
  'utf8'
);
const actionCard = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'content.template.js'),
  'utf8'
);
const patchNotes = fs.readFileSync(
  path.join(__dirname, '..', 'PATCH_NOTES.md'),
  'utf8'
);

assert.equal((popup.match(/<button\b/g) || []).length, 2);
assert.equal((popup.match(/<li>/g) || []).length, 3);
assert.match(popup, /Only one subtitle track stays active\./);
assert.match(popup, /Authored English is preferred automatically\./);
assert.match(popup, /Player controls remain for 10 seconds\./);
assert.match(popupScript, /Go to YouTube|open-youtube/);
assert.match(popupScript, /checkForUpdates/);
assert.match(
  popupScript,
  /fuck-youtube-premium-orion-\$\{latestVersion\}\.xpi/
);
assert.doesNotMatch(popupScript, /toggleActionCard/);
assert.match(popupStyle, /left: 50%/);
assert.match(
  popupStyle,
  /bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ clamp\(1rem, 4svh, 2rem\)\)/
);
assert.match(popupStyle, /width: min\(92vw, 24rem\)/);
assert.match(popupStyle, /max-height: min\(38svh, 21rem\)/);
assert.doesNotMatch(actionCard, /toggleActionCard|attachShadow/);
assert.match(patchNotes, /## v2\.0\.19/);

console.log('bottom-center extension popup: ok');
