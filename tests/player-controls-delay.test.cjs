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
  /const PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v221-transport-larger'/
);
assert.match(source, /function ensurePlayerControlsToolbar\(\)/);
assert.doesNotMatch(source, /function ensurePlayerChromeExtras\(\)/);
assert.doesNotMatch(source, /PLAYER_CHROME_EXTRAS_ID/);
assert.match(source, /function runPlayerControlAction\(action, sourceButton\)/);
for (const action of [
  'rewind',
  'play-pause',
  'forward',
  'pip',
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
assert.doesNotMatch(
  source,
  /playerControlButtonMarkup\(\s*'quality'/
);
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
assert.match(source, /ignorePlayerControlActionsUntil = Date\.now\(\) \+ 500/);
assert.match(source, /appendPlayerMenuTitle\(menu, 'Video quality'\)/);
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
assert.match(source, /margin: clamp\(\.5rem, 2\.4vw, \.8rem\) auto/);
assert.match(source, /display: flex !important;/);
assert.match(source, /justify-content: center/);
assert.doesNotMatch(source, /grid-template-columns: repeat\(7,/);
assert.match(
  source,
  /'PointerEvent' in window \? 'pointerdown' : 'touchstart',\s*handlePlayerControlActionCapture/
);
assert.doesNotMatch(source, /fypPlayerHoverSimulated/);
assert.match(source, /playButton\.dataset\.fypPlaybackState !== playbackState/);
assert.match(source, /M8 5v14l11-7z/);
assert.match(source, /M6 4h4v16H6zm8 0h4v16h-4z/);
assert.match(source, /stroke: none/);
assert.match(source, /clamp\(2\.9rem, 13vw, 3\.45rem\)/);
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
assert.match(source, /const AD_RESPONSE_KEYS = new Set/);
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

console.log('10-second native hold and transport-only strip: ok');
