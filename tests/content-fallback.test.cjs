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

assert.match(content, /EXPECTED_PAGE_VERSION = '2\.2\.9'/);
assert.match(content, /function pageRuntimeReady\(\)/);
assert.match(content, /script\.addEventListener\(\s*'error'/);
assert.match(content, /document\.querySelector\('script\[nonce\]'\)/);
assert.match(content, /if \(!pageRuntimeReady\(\)\) injectWithText\(\)/);
assert.match(page, /setAttribute\('data-fyp-page-ready', '2\.2\.9'\)/);
assert.match(content, /HISTORY_FEED_ATTR = 'data-fyp-feed'/);
assert.match(content, /function markFallbackHistoryFeedBrowse\(\)/);
assert.match(content, /ytd-browse\[page-subtype='history'\]/);
assert.match(
  content,
  /function prepareFallbackBackgroundPlayback\(\) \{[\s\S]*?if \(pageRuntimeReady\(\)\) return;/
);
assert.match(
  content,
  /function recoverFallbackPlayback\(\) \{[\s\S]*?if \(pageRuntimeReady\(\)\) return;/
);
assert.match(page, /function handleMediaSessionPlay\(\)/);
assert.match(page, /function handleMediaSessionPause\(\)/);
assert.match(page, /nativeMediaPause\.call\(video\)/);
assert.match(page, /Date\.now\(\) > state\.userPauseUntil/);
assert.match(page, /installMediaSessionHandlers\(\);\s*updateMediaSessionMetadata\(\);/);
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
assert.match(content, /max-width: 100% !important/);
assert.match(content, /function ensureFallbackPlayerControlsToolbar\(\)/);
assert.match(
  content,
  /PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v228-tight-stack'/
);
for (const action of [
  'rewind',
  'play-pause',
  'forward',
  'pip',
  'fullscreen',
]) {
  assert.match(
    content,
    new RegExp(`playerControlButtonMarkup\\(\\s*'${action}'`)
  );
}
assert.doesNotMatch(content, /playerControlButtonMarkup\(\s*'speed'/);
assert.doesNotMatch(content, /playerControlButtonMarkup\(\s*'quality'/);
assert.doesNotMatch(content, /playerControlButtonMarkup\(\s*'captions'/);
assert.doesNotMatch(content, /playerControlButtonMarkup\(\s*'more'/);
assert.match(content, /video\.currentTime \+ offset/);
assert.match(content, /video\.requestPictureInPicture\(\)/);
assert.match(content, /requestFullscreen/);
assert.match(content, /\.ytp-settings-button/);
assert.match(content, /FYP_OWNED_SELECTOR/);
assert.match(
  content,
  /#movie_player \.ytp-settings-button[\s\S]*display: inline-flex !important/
);
assert.match(content, /function toggleFallbackSpeedMenu\(/);
assert.match(content, /function toggleFallbackQualityMenu\(/);
assert.doesNotMatch(content, /function ensureFallbackPlayerChromeExtras\(/);
assert.doesNotMatch(content, /PLAYER_CHROME_EXTRAS_ID/);
assert.match(content, /dataset\.fypPlayerOption = action/);
assert.match(content, /action: 'playback-speed'/);
assert.match(content, /action: 'playback-quality'/);
assert.match(content, /function applyFallbackYouTubeQuality\(/);
assert.match(content, /ignoreFallbackPlayerControlActionsUntil = Date\.now\(\) \+ 500/);
assert.match(content, /appendFallbackPlayerMenuTitle\(menu, 'Video quality'\)/);
assert.match(content, /appendFallbackPlayerMenuTitle\(menu, 'Playback speed'\)/);
assert.match(content, /FALLBACK_QUALITY_LEVELS/);
assert.match(content, /appendFallbackPlayerMenuCollapse\(/);
assert.match(content, /dataset\.fypPlayerOption = 'menu-collapse'/);
assert.match(content, /action === 'menu-collapse'/);
assert.match(content, /-webkit-overflow-scrolling: touch/);
assert.match(content, /touch-action: pan-y/);
assert.match(content, /pendingFallbackMenuOptionGesture/);
assert.match(
  content,
  /'PointerEvent' in window \? 'pointerup' : 'touchend',\s*handleFallbackPlayerControlActionCapture/
);
assert.doesNotMatch(content, /nativeCaptions\.click\(\)/);
assert.match(content, /for \(const speed of \[0\.5, 0\.75, 1, 1\.25, 1\.5, 2\]\)/);
assert.match(
  content,
  /function handleFallbackPlayerControlActionCapture\(event\) \{\s*if \(pageRuntimeReady\(\)\) return;/
);
assert.match(
  content,
  /if \(!\('PointerEvent' in window\)\) \{\s*document\.addEventListener\(\s*'click',\s*handleFallbackPlayerControlActionCapture/
);
assert.doesNotMatch(content, /setTimeout\(selectTrack, 350\)/);
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
  /target\.closest\(\s*'\[data-fyp-player-option\]'\s*\)/
);
assert.match(
  content,
  /target\.closest\(\s*'\[data-fyp-player-action\]'\s*\)/
);
assert.match(content, /flex: 1 0 100% !important/);
assert.match(content, /max-height: min\(42svh, 18rem\) !important/);
assert.match(content, /function prepareFallbackBackgroundPlayback\(\)/);
assert.match(content, /function recoverFallbackPlayback\(\)/);
assert.match(content, /for \(const delay of \[80, 250, 750, 1500\]\)/);
assert.match(content, /window\.addEventListener\(\s*'pagehide'/);
assert.match(content, /justify-content: center !important/);
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
