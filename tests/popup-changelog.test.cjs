const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popup = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'popup.html'),
  'utf8'
);
const patchNotes = fs.readFileSync(
  path.join(__dirname, '..', 'PATCH_NOTES.md'),
  'utf8'
);

assert.equal((popup.match(/<button\b/g) || []).length, 2);
assert.equal((popup.match(/<li>/g) || []).length, 3);
assert.match(popup, /Inline Play stays on the page\./);
assert.match(popup, /Phone layout no longer clips\./);
assert.match(popup, /Update notes now appear here\./);
assert.match(patchNotes, /## v2\.0\.11/);

console.log('compact popup changelog: ok');
