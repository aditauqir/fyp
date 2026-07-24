const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popup = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'popup.html'),
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
assert.match(popup, /Inline Play; fullscreen only on request\./);
assert.match(popup, /Extension menu stays compact on-page\./);
assert.match(popup, /Shorts are removed across YouTube\./);
assert.match(actionCard, /Inline Play; fullscreen only on request\./);
assert.match(actionCard, /Extension menu stays compact on-page\./);
assert.match(actionCard, /Shorts are removed across YouTube\./);
assert.equal((actionCard.match(/document\.createElement\('button'\)/g) || []).length, 2);
assert.match(patchNotes, /## v2\.0\.12/);

console.log('compact popup changelog: ok');
