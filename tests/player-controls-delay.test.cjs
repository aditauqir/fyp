const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-mobile-background.user.js'),
  'utf8'
);

assert.match(source, /const PLAYER_CONTROLS_VISIBLE_MS = 10000;/);
assert.match(source, /function holdPlayerControlsVisible\(\)/);
assert.match(source, /player\.dataset\.fypControlsVisible = 'true';/);
assert.match(
  source,
  /delete player\.dataset\.fypControlsVisible;[\s\S]*PLAYER_CONTROLS_VISIBLE_MS/
);
assert.doesNotMatch(
  source,
  /function onVideoPlay\(\) \{[^}]*holdPlayerControlsVisible\(\);/
);
assert.match(
  source,
  /function recordPlayerControlIntent\(event\)[\s\S]*target\.closest\([\s\S]*#movie_player[\s\S]*holdPlayerControlsVisible\(\);/
);
assert.match(
  source,
  /\.html5-video-player\[data-fyp-controls-visible='true'\] \.ytp-chrome-bottom/
);
assert.match(source, /visibility: visible !important;/);
assert.match(source, /opacity: 1 !important;/);
assert.match(
  source,
  /const PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v340-title-row'/
);
assert.match(source, /function ensurePlayerControlsToolbar\(\)/);
assert.match(source, /function isUsableWatchMount\(/);
assert.match(source, /function isVisibleWatchRoot\(/);
assert.match(source, /function findVisibleWatchRoot\(/);
assert.match(source, /function findWatchTitleRow\(/);
assert.match(source, /function watchIdFromLocation\(/);
assert.match(source, /getAttribute\('video-id'\)/);
assert.doesNotMatch(
  source,
  /const watch = findVisibleWatchRoot\(\);\s*if \(!watch\) \{\s*document\.getElementById\(PLAYER_CONTROLS_TOOLBAR_ID\)\?\.remove\(\);/
);
assert.match(source, /function findActivePlayerElement\(/);
assert.match(source, /function findWatchBelowHost\(/);
assert.match(source, /function findVisibleWatchPlayerHost\(/);
assert.match(source, /function schedulePlayerControlsToolbar\(/);
assert.match(source, /function toolbarIsParkedOnPlayer\(/);
assert.match(source, /toolbarIsCorrectlyPlaced\(/);
assert.match(source, /fypControlsAnchor = 'title-row'/);
assert.doesNotMatch(source, /settledOnTitle/);
assert.doesNotMatch(
  source,
  /title\.insertAdjacentElement\('afterend', toolbar\)/
);
assert.match(
  source,
  /titleRow\.insertAdjacentElement\('afterend', toolbar\)/
);
assert.doesNotMatch(
  source,
  /toolbarIsParkedOnPlayer\(toolbar\)\) \{\s*toolbar\.remove\(\);\s*\}\s*return;/
);
assert.match(source, /COLLAPSED_PLAYER_SHELL_SELECTOR/);
assert.match(
  source,
  /ytd-watch-flexy\[full-bleed-player\] #columns #player/
);
assert.doesNotMatch(
  source,
  /else if \(playerAnchor instanceof Element\) \{\s*playerAnchor\.insertAdjacentElement\('afterend', toolbar\)/
);
assert.doesNotMatch(source, /function ensurePlayerChromeExtras\(\)/);
assert.doesNotMatch(source, /PLAYER_CHROME_EXTRAS_ID/);
assert.match(source, /function runPlayerControlAction\(action, sourceButton\)/);
for (const action of [
  'rewind',
  'play-pause',
  'forward',
  'pip',
  'airplay',
  'fullscreen',
]) {
  assert.match(
    source,
    new RegExp(`playerControlButtonMarkup\\(\\s*'${action}'`)
  );
}
assert.doesNotMatch(
  source,
  /playerControlButtonMarkup\(\s*'captions'/
);
assert.doesNotMatch(
  source,
  /playerControlButtonMarkup\(\s*'more'/
);
assert.doesNotMatch(
  source,
  /playerControlButtonMarkup\(\s*'speed'/
);
assert.doesNotMatch(source, /lucide lucide-settings/);
assert.doesNotMatch(source, /playerControlButtonMarkup\(\s*'quality'/);
assert.match(source, /stroke-opacity=\"\.4\"/);
assert.match(source, /M0 0h512v512H0z/);
assert.match(source, /M3 2\.803a1 1 0 0 1 1\.5-\.865/);
assert.match(
  source,
  /M5 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z/
);
assert.match(source, /function setPlaybackGlyph\(/);
assert.match(source, /function enterSystemMiniPlayer\(/);
assert.match(source, /webkitSetPresentationMode\('picture-in-picture'\)/);
assert.match(source, /M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12/);
assert.match(source, /webkitShowPlaybackTargetPicker/);
assert.match(source, /x-webkit-airplay', 'allow'/);
assert.match(source, /video\.currentTime \+ offset/);
assert.match(source, /await video\.play\(\)/);
assert.match(source, /video\.pause\(\)/);
assert.match(source, /video\.requestPictureInPicture\(\)/);
assert.match(source, /player\.requestFullscreen/);
assert.match(source, /function toggleSpeedMenu\(/);
assert.match(source, /function toggleQualityMenu\(/);
assert.match(source, /function selectYouTubeCaptionTrack\(/);
assert.match(source, /player\.setOption\('captions', 'track', youtubeTrack\)/);
assert.match(source, /player\.setOption\('captions', 'reload', true\)/);
assert.match(source, /setTimeout\(applyPlaybackRate, 120\)/);
assert.match(source, /setTimeout\(applyQuality, 120\)/);
assert.match(source, /action: 'playback-speed'/);
assert.match(source, /action: 'playback-quality'/);
assert.match(source, /function applyYouTubeQuality\(/);
assert.match(source, /function youtubeQualityLevels\(/);
assert.match(source, /function youtubeQualityOptions\(/);
assert.match(source, /getAvailableQualityData/);
assert.match(source, /ignorePlayerControlActionsUntil = Date\.now\(\) \+ 500/);
assert.match(source, /appendPlayerMenuTitle\(menu, 'Video quality'\)/);
assert.match(
  source,
  /if \(action === 'playback-quality'\)[\s\S]*aria-checked[\s\S]*else \{\s*closePlayerControlMenu\(\);/
);
assert.match(source, /appendPlayerMenuTitle\(menu, 'Playback speed'\)/);
assert.match(source, /FALLBACK_QUALITY_LEVELS/);
assert.match(source, /appendPlayerMenuCollapse\(/);
assert.match(source, /dataset\.fypPlayerOption = 'menu-collapse'/);
assert.match(source, /action === 'menu-collapse'/);
assert.match(source, /-webkit-overflow-scrolling: touch/);
assert.match(source, /touch-action: pan-y/);
assert.match(source, /pendingMenuOptionGesture/);
assert.match(
  source,
  /'PointerEvent' in window \? 'pointerup' : 'touchend',\s*handlePlayerControlActionCapture/
);
assert.match(source, /function currentYouTubeCaptionTrack\(/);
assert.doesNotMatch(source, /nativeCaptions\.click\(\)/);
assert.match(source, /for \(const speed of \[0\.5, 0\.75, 1, 1\.25, 1\.5, 2\]\)/);
assert.match(
  source,
  /margin: clamp\(\.25rem, 1\.2vw, \.45rem\) 0 clamp\(\.5rem, 2\.4vw, \.8rem\)/
);
assert.match(source, /display: flex !important;/);
assert.match(source, /justify-content: center/);
assert.doesNotMatch(source, /grid-template-columns: repeat\(7,/);
assert.match(
  source,
  /'PointerEvent' in window \? 'pointerdown' : 'touchstart',\s*handlePlayerControlActionCapture/
);
assert.doesNotMatch(source, /fypPlayerHoverSimulated/);
assert.match(source, /playButton\.dataset\.fypPlaybackState !== playbackState/);
assert.match(source, /M3 2\.803a1 1 0 0 1 1\.5-\.865/);
assert.match(
  source,
  /M5 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z/
);
assert.match(source, /function setPlaybackGlyph\(/);
assert.match(source, /function enterSystemMiniPlayer\(/);
assert.match(source, /webkitSetPresentationMode\('picture-in-picture'\)/);
assert.match(source, /stroke="none"/);
assert.match(source, /z-index: 2147483646 !important/);
assert.match(source, /color: #fff !important/);
assert.match(source, /-webkit-text-fill-color: #fff !important/);
assert.match(source, /forced-color-adjust: none/);
assert.match(source, /background: #111 !important/);
assert.doesNotMatch(
  source,
  /\.fyp-player-control\[data-fyp-player-action='play-pause'\] svg \{[^}]*fill:/
);
assert.doesNotMatch(
  source,
  /#\$\{PLAYER_CONTROLS_TOOLBAR_ID\} \.fyp-player-control svg \{[^}]*fill: none/
);
assert.match(source, /function solidifyPlayerIcon\(/);
assert.match(source, /const SVG_NS = 'http:\/\/www\.w3\.org\/2000\/svg'/);
assert.match(source, /createElementNS\(SVG_NS, node\.localName\)/);
assert.match(source, /playerIcon: true/);
assert.match(
  source,
  /svg path\[fill='currentColor'\][\s\S]*fill: #fff !important/
);
assert.match(source, /gap: \.35rem/);
assert.match(source, /flex-wrap: nowrap !important/);
assert.match(source, /function paintPlayerControlIcon\(/);
assert.match(source, /function raisePlayerControlsStack\(/);
assert.match(source, /z-index: 2147483646 !important/);
assert.match(source, /width: 3\.25rem !important/);
assert.match(source, /min-width: 3\.25rem !important/);
assert.match(source, /height: 3\.25rem !important/);
assert.match(source, /background: transparent !important;/);
assert.match(source, /border: 0 !important;/);
assert.match(source, /border-radius: 0;/);
assert.match(source, /-webkit-tap-highlight-color: transparent/);
assert.match(source, /width: 2rem !important/);
assert.match(source, /height: 2rem !important/);
assert.match(source, /function isViewBoxRect\(/);
assert.match(source, /state\.video\.isConnected/);
assert.match(source, /function updateMediaSessionMetadata\(\)/);
assert.match(source, /navigator\.mediaSession\.metadata = new MediaMetadata/);
assert.match(source, /hqdefault\.jpg/);
assert.doesNotMatch(source, /maxresdefault\.jpg/);
assert.match(source, /function applyMediaArtworkPoster\(/);
assert.match(source, /video\.poster = preferred\.src/);
assert.match(source, /navigator\.mediaSession\.playbackState/);
assert.match(source, /function handleMediaSessionPlay\(\)/);
assert.match(source, /function handleMediaSessionPause\(\)/);
assert.match(source, /nativeMediaPause\.call\(video\)/);
assert.match(source, /function visibleVideoTitle\(\)/);
assert.match(source, /currentMetadata\?\.title\?\.trim\(\) === title/);
assert.match(source, /const preservePlayback = action !== 'play-pause'/);
assert.match(source, /if \(video\.paused && !video\.ended\) safePlay\(video\)/);
assert.match(source, /function channelVideosUrl\(input\)/);
assert.match(source, /function redirectChannelRootToVideos\(\)/);
assert.match(source, /function redirectChannelLinkToVideos\(event\)/);
assert.match(source, /page-subtype='channels'/);
assert.match(source, /const AD_RESPONSE_ARRAY_KEYS = new Set/);
assert.match(
  source,
  /function dismissAdBlockEnforcement\(root = document\)[\s\S]*AD_BLOCK_ENFORCEMENT_PATTERN/
);
assert.match(source, /ytd-enforcement-message-view-model/);
assert.match(source, /function isFypOwnedTarget\(/);
assert.match(source, /FYP_OWNED_SELECTOR/);
assert.doesNotMatch(source, /duration - 0\.05/);
assert.match(
  source,
  /#movie_player \.ytp-settings-button[\s\S]*display: inline-flex !important/
);
assert.doesNotMatch(
  source,
  /#movie_player \.ytp-settings-button,\s*\.html5-video-player \.ytp-settings-button,\s*#movie_player \.ytp-overflow-button/
);

console.log('10-second hold plus AirPlay strip without quality gear: ok');
