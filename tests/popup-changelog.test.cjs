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

assert.equal((popup.match(/<button\b/g) || []).length, 0);
assert.match(popupScript, /tabs\.query/);
assert.match(popupScript, /tabs\.sendMessage/);
assert.match(popupScript, /window\.close\(\)/);
assert.match(popupStyle, /width: 1px/);
assert.match(actionCard, /Toolbar tap now opens these controls\./);
assert.match(actionCard, /Inline fallback runs without page injection\./);
assert.match(actionCard, /Shorts stay removed across YouTube\./);
assert.equal((actionCard.match(/document\.createElement\('button'\)/g) || []).length, 2);
assert.match(actionCard, /width: min\(22rem, calc\(100vw - 24px\)\)/);
assert.match(actionCard, /min-height: 3\.5rem/);
assert.match(patchNotes, /## v2\.0\.13/);

console.log('popup relay and enlarged action card: ok');
