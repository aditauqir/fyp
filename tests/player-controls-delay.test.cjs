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
assert.match(source, /const PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v215'/);
assert.match(source, /function ensurePlayerControlsToolbar\(\)/);
assert.match(source, /function runPlayerControlAction\(action, sourceButton\)/);
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
    source,
    new RegExp(`playerControlButtonMarkup\\(\\s*'${action}'`)
  );
}
assert.match(source, /video\.currentTime \+ offset/);
assert.match(source, /await video\.play\(\)/);
assert.match(source, /video\.pause\(\)/);
assert.match(source, /video\.requestPictureInPicture\(\)/);
assert.match(source, /player\.requestFullscreen/);
assert.match(source, /\.ytp-subtitles-button/);
assert.match(source, /\.ytp-settings-button/);
assert.match(source, /function toggleCaptionsMenu\(/);
assert.match(source, /function selectYouTubeCaptionTrack\(/);
assert.match(source, /player\.setOption\('captions', 'track', youtubeTrack\)/);
assert.match(source, /player\.setOption\('captions', 'reload', true\)/);
assert.match(source, /setTimeout\(applyCaptionSelection, 350\)/);
assert.match(source, /function toggleMorePlayerMenu\(/);
assert.match(source, /selectedCaptionTrackByVideo\.set\(video, selectedTrack\)/);
assert.match(source, /action: 'captions-off'/);
assert.match(source, /action: 'caption-track'/);
assert.match(source, /action: 'playback-speed'/);
assert.match(source, /for \(const speed of \[0\.5, 0\.75, 1, 1\.25, 1\.5, 2\]\)/);
assert.match(source, /action: 'native-settings'/);
assert.match(
  source,
  /\[data-fyp-player-option\], \[data-fyp-player-action\]/
);
assert.match(source, /grid-column: 1 \/ -1;/);
assert.match(source, /max-height: min\(42svh, 18rem\);/);
assert.match(source, /grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
assert.match(
  source,
  /'PointerEvent' in window \? 'pointerdown' : 'touchstart',\s*handlePlayerControlActionCapture/
);
assert.doesNotMatch(source, /fypPlayerHoverSimulated/);
assert.match(source, /playButton\.dataset\.fypPlaybackState !== playbackState/);
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
assert.doesNotMatch(source, /duration - 0\.05/);

console.log('10-second native hold and seven-button player strip: ok');
