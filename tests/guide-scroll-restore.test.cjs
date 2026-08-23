const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);
const template = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'content.template.js'),
  'utf8'
);

assert.match(source, /function guideDrawerIsBusy\(/);
assert.match(source, /function overlayHostIsOpen\(/);
assert.match(source, /function removeOrphanAdBackdrops\(/);
assert.match(source, /function restoreScrollAfterGuideClose\(/);
assert.match(source, /hasAttribute\('opened'\)/);
assert.match(source, /hasAttribute\('opening'\)/);
assert.match(source, /hasAttribute\('peeking'\)/);
assert.match(
  source,
  /tp-yt-app-drawer#guide:not\(\[opened\]\):not\(\[opening\]\):not\(\[peeking\]\) #scrim/
);
assert.match(
  source,
  /if \(node\.style\.overflow === 'hidden' \|\| node\.style\.overflowY === 'hidden'\)/
);
assert.match(source, /nativeDocumentAddEventListener\('yt-guide-close'/);
assert.match(source, /nativeDocumentAddEventListener\(\s*'iron-overlay-closed'/);
assert.match(source, /backdrop\.closest\('tp-yt-app-drawer'\)/);
assert.doesNotMatch(
  source,
  /tp-yt-iron-overlay-backdrop\.opened,[\s\S]{0,120}forEach\(\(backdrop\) => backdrop\.remove\(\)\)/
);
assert.doesNotMatch(source, /drawer\.opened\s*=(?!=)/);
assert.doesNotMatch(template, /drawer\.opened\s*=(?!=)/);
assert.doesNotMatch(source, /removeAttribute\('opened'\)/);
assert.doesNotMatch(source, /removeAttribute\('peeking'\)/);
assert.doesNotMatch(source, /removeAttribute\('guide-persistent'\)/);
assert.doesNotMatch(source, /removeAttribute\('mini-guide-visible'\)/);

assert.match(template, /function fallbackGuideDrawerIsBusy\(/);
assert.match(template, /function restoreFallbackScrollAfterGuideClose\(/);
assert.match(template, /function removeFallbackOrphanAdBackdrops\(/);
assert.match(
  template,
  /tp-yt-app-drawer#guide:not\(\[opened\]\):not\(\[opening\]\):not\(\[peeking\]\) #scrim/
);
assert.match(template, /document\.addEventListener\(\s*'yt-guide-close'/);

console.log('guide close restores scroll without fighting drawer Polymer: ok');
