const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'youtube-mobile-background.user.js'),
  'utf8'
);
const template = fs.readFileSync(
  path.join(root, 'firefox-extension', 'content.template.js'),
  'utf8'
);

for (const [name, code] of [
  ['page runtime', source],
  ['content fallback', template],
]) {
  assert.match(code, /(?:FALLBACK_)?SHORTS_REMOVAL_SELECTOR/);
  assert.match(code, /a\[href\^="\/shorts"\]/);
  assert.match(code, /a\[href\^="\/playables"\]/);
  assert.match(code, /ytd-reel-shelf-renderer/);
  assert.match(code, /ytm-shorts-lockup-view-model/);
  assert.match(code, /function remove(?:Fallback)?Shorts(?:AndPlayables)?\(root = document\)/);
  assert.match(code, /new MutationObserver\(\(mutations\) =>/);
  assert.match(code, /pointerdown.*block(?:Fallback)?ShortsNavigation/s);
  assert.match(code, /touchstart.*block(?:Fallback)?ShortsNavigation/s);
  assert.match(code, /yt-navigate-(?:start|finish)/);
}

assert.match(source, /installShortsRemovalListener\(\)/);
assert.match(template, /installFallbackShortsObserver\(\)/);

console.log('shorts removal observers and WebKit navigation guards: ok');
