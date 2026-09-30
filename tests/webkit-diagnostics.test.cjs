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
const safariProjectRoot = path.join(
  root,
  'workbench',
  'youtube-diagnostics-safari',
  'YouTube Diagnostics Safari'
);
const safariBackground = fs.readFileSync(
  path.join(
    safariProjectRoot,
    'YouTube Diagnostics Safari Extension',
    'Resources',
    'background.js'
  ),
  'utf8'
);
const safariViewController = fs.readFileSync(
  path.join(safariProjectRoot, 'YouTube Diagnostics Safari', 'ViewController.swift'),
  'utf8'
);
const safariProject = fs.readFileSync(
  path.join(safariProjectRoot, 'YouTube Diagnostics Safari.xcodeproj', 'project.pbxproj'),
  'utf8'
);
const safariPopup = fs.readFileSync(
  path.join(
    safariProjectRoot,
    'YouTube Diagnostics Safari Extension',
    'Resources',
    'popup.js'
  ),
  'utf8'
);
const safariManifest = JSON.parse(
  fs.readFileSync(
    path.join(
      safariProjectRoot,
      'YouTube Diagnostics Safari Extension',
      'Resources',
      'manifest.json'
    ),
    'utf8'
  )
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
assert.ok(
  fs.existsSync(
    path.join(
      safariProjectRoot,
      'YouTube Diagnostics Safari.xcodeproj',
      'project.pbxproj'
    )
  ),
  'Safari Xcode project exists'
);
assert.match(safariBackground, /globalThis\.browser \|\| globalThis\.chrome/);
assert.match(
  safariViewController,
  /com\.aditauqir\.fyp\.YouTube-Diagnostics-Safari\.Extension/
);
assert.match(
  safariProject,
  /PRODUCT_BUNDLE_IDENTIFIER = "com\.aditauqir\.fyp\.YouTube-Diagnostics-Safari\.Extension"/
);
assert.match(safariProject, /MACOSX_DEPLOYMENT_TARGET = 12\.0/);
assert.match(safariPopup, /chrome\.downloads\.download/);
assert.match(safariPopup, /data:\$\{mimeType\};charset=utf-8/);
assert.ok(safariManifest.permissions.includes('downloads'), 'Safari downloads permission exists');

console.log('Safari/WebKit media lifecycle and Fyoutube attachment diagnostics: ok');
