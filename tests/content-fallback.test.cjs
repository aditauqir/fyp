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

assert.match(content, /EXPECTED_PAGE_VERSION = '2\.1\.0'/);
assert.match(content, /function pageRuntimeReady\(\)/);
assert.match(content, /script\.addEventListener\(\s*'error'/);
assert.match(content, /document\.querySelector\('script\[nonce\]'\)/);
assert.match(content, /if \(!pageRuntimeReady\(\)\) injectWithText\(\)/);
assert.match(page, /setAttribute\('data-fyp-page-ready', '2\.1\.0'\)/);
assert.match(
  content,
  /PLAYER_CONTROLS_TOOLBAR_ID =\s*'yt-mobile-orion-ext-controls-toolbar'/
);

assert.match(content, /function markVideoInline\(video\)/);
assert.match(content, /video\.setAttribute\('playsinline', ''\)/);
assert.match(content, /video\.setAttribute\('webkit-playsinline', ''\)/);
assert.match(content, /new MutationObserver/);
assert.match(content, /document\.addEventListener\('touchstart'/);
assert.match(content, /a\[href\^="\/shorts"\]/);
assert.match(content, /max-width: 100vw !important/);
assert.match(content, /function ensureFallbackPlayerControlsToolbar\(\)/);
assert.match(content, /PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v215'/);
for (const action of [
  'rewind',
  'play-pause',
  'forward',
  'captions',
  'pip',
  'fullscreen',
  'more',
]) {
  assert.match(
    content,
    new RegExp(`playerControlButtonMarkup\\(\\s*'${action}'`)
  );
}
assert.match(content, /video\.currentTime \+ offset/);
assert.match(content, /video\.requestPictureInPicture\(\)/);
assert.match(content, /requestFullscreen/);
assert.match(content, /\.ytp-subtitles-button/);
assert.match(content, /\.ytp-settings-button/);
assert.match(content, /function toggleFallbackCaptionsMenu\(/);
assert.match(content, /function toggleFallbackMorePlayerMenu\(/);
assert.match(content, /dataset\.fypPlayerOption = action/);
assert.match(content, /action: 'captions-off'/);
assert.match(content, /action: 'caption-track'/);
assert.match(content, /action: 'playback-speed'/);
assert.match(content, /for \(const speed of \[0\.5, 0\.75, 1, 1\.25, 1\.5, 2\]\)/);
assert.match(content, /action: 'native-settings'/);
assert.match(
  content,
  /function handleFallbackPlayerControlActionCapture\(event\) \{\s*if \(pageRuntimeReady\(\)\) return;/
);
assert.match(content, /setTimeout\(selectTrack, 350\)/);
assert.match(content, /function updateFallbackMediaSessionMetadata\(\)/);
assert.match(content, /navigator\.mediaSession\.metadata = new MediaMetadata/);
assert.match(content, /hqdefault\.jpg/);
assert.doesNotMatch(content, /maxresdefault\.jpg/);
assert.match(content, /video\.poster = preferred\.src/);
assert.match(content, /navigator\.mediaSession\.playbackState/);
assert.match(content, /function fallbackVisibleVideoTitle\(\)/);
assert.match(content, /currentMetadata\?\.title\?\.trim\(\) === title/);
assert.match(content, /const preservePlayback = action !== 'play-pause'/);
assert.match(content, /function channelVideosUrl\(input\)/);
assert.match(content, /function redirectChannelRootToVideos\(\)/);
assert.match(content, /function redirectChannelLinkToVideos\(event\)/);
assert.match(content, /target\.pathname = `\$\{target\.pathname\.replace/);
assert.match(content, /\/videos`/);
assert.match(
  content,
  /document\.addEventListener\('click', redirectChannelLinkToVideos, true\)/
);
assert.match(content, /page-subtype='channels'/);
assert.match(content, /page-subtype='channels'/);
assert.match(content, /ytd-channel-video-player-renderer/);
assert.match(
  content,
  /\[data-fyp-player-option\], \[data-fyp-player-action\]/
);
assert.match(content, /grid-column: 1 \/ -1 !important/);
assert.match(content, /max-height: min\(42svh, 18rem\) !important/);
assert.match(content, /function prepareFallbackBackgroundPlayback\(\)/);
assert.match(content, /function recoverFallbackPlayback\(\)/);
assert.match(content, /for \(const delay of \[80, 250, 750, 1500\]\)/);
assert.match(content, /window\.addEventListener\(\s*'pagehide'/);
assert.match(content, /grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
assert.match(content, /playButton\.dataset\.fypPlaybackState !== playbackState/);
assert.match(content, /function scheduleFallbackPlayerControlsToolbar\(\)/);
assert.doesNotMatch(
  content,
  /setInterval\(\(\) => \{[\s\S]*markVideoTree\(document\);[\s\S]*\}, 1200\)/
);
assert.match(
  content,
  /'PointerEvent' in window \? 'pointerdown' : 'touchstart',\s*handleFallbackPlayerControlActionCapture/
);
assert.match(content, /overflow-x: hidden !important/);
assert.match(content, /overflow-x: clip !important/);
assert.match(content, /overscroll-behavior-x: none !important/);
assert.match(content, /function enforceFallbackHorizontalViewportLock\(\)/);
assert.match(content, /scrollingElement\.scrollLeft = 0/);
assert.match(
  content,
  /'scroll',\s*enforceFallbackHorizontalViewportLock/
);
assert.match(content, /function skipFallbackPlayerAd\(\)/);
assert.match(content, /function dismissFallbackAdBlockEnforcement\(root = document\)/);
assert.match(content, /ytd-enforcement-message-view-model/);
assert.match(content, /ad blockers\? \(\?:are not allowed\|violate\)/);
assert.doesNotMatch(content, /duration - 0\.05/);

console.log('page handshake, icon controls, and background fallbacks: ok');
