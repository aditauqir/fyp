const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const content = fs.readFileSync(
  path.join(__dirname, '..', 'firefox-extension', 'content.template.js'),
  'utf8'
);
const page = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(content, /EXPECTED_PAGE_VERSION = '2\.0\.13'/);
assert.match(content, /function pageRuntimeReady\(\)/);
assert.match(content, /script\.addEventListener\(\s*'error'/);
assert.match(content, /document\.querySelector\('script\[nonce\]'\)/);
assert.match(content, /if \(!pageRuntimeReady\(\)\) injectWithText\(\)/);
assert.match(page, /setAttribute\('data-fyp-page-ready', '2\.0\.13'\)/);

assert.match(content, /function markVideoInline\(video\)/);
assert.match(content, /video\.setAttribute\('playsinline', ''\)/);
assert.match(content, /video\.setAttribute\('webkit-playsinline', ''\)/);
assert.match(content, /new MutationObserver/);
assert.match(content, /document\.addEventListener\('touchstart'/);
assert.match(content, /a\[href\^="\/shorts"\]/);
assert.match(content, /max-width: 100vw !important/);

console.log('page handshake and DOM fallbacks: ok');
