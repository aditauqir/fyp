const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'youtube-mobile-background.user.js'),
  'utf8'
);
const fallback = fs.readFileSync(
  path.join(root, 'firefox-extension', 'content.template.js'),
  'utf8'
);
const diagnosticsPage = fs.readFileSync(
  path.join(root, 'workbench', 'youtube-diagnostics', 'page-hook.js'),
  'utf8'
);
const diagnosticsContent = fs.readFileSync(
  path.join(root, 'workbench', 'youtube-diagnostics', 'content.js'),
  'utf8'
);

assert.match(source, /data-fyp-video-attached/);
assert.match(source, /data-fyp-inline-playback/);
assert.match(source, /webkitpresentationmodechanged/);
assert.match(source, /video\.closest\('#movie_player, #player-container, ytd-player#ytd-player'\)/);
assert.match(fallback, /#movie_player video\.html5-main-video/);
assert.match(diagnosticsPage, /emit\('media-event'/);
assert.match(diagnosticsPage, /emit\('webkit-runtime'/);
assert.match(diagnosticsPage, /webkitPlaysInline/);
assert.match(diagnosticsPage, /webkitPresentationMode/);
assert.match(diagnosticsContent, /data-fyp-video-attached/);
assert.match(diagnosticsContent, /webkitVisibilityState/);

console.log('Safari/WebKit media lifecycle and Fyoutube attachment diagnostics: ok');
