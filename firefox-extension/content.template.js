/**
 * Orion content script (Chrome + Firefox namespaces).
 * Injects page.js into the PAGE world so YouTube sees our patches.
 */
(() => {
  'use strict';

  const FLAG = '__ytMobileOrionExtInjected';
  try {
    if (window[FLAG]) return;
    Object.defineProperty(window, FLAG, { value: true, configurable: false });
  } catch {
    if (window[FLAG]) return;
    window[FLAG] = true;
  }

  const api =
    typeof browser !== 'undefined'
      ? browser
      : typeof chrome !== 'undefined'
        ? chrome
        : null;

  if (!api || !api.runtime || typeof api.runtime.getURL !== 'function') {
    return;
  }

  const PAGE_SCRIPT_ID = 'yt-mobile-orion-page-script';
  const PAGE_READY_ATTR = 'data-fyp-page-ready';
  const EXPECTED_PAGE_VERSION = '2.2.3';
  const HISTORY_FEED_ATTR = 'data-fyp-feed';
  const DOM_FALLBACK_STYLE_ID = 'fyp-orion-dom-fallback-style';
  const PLAYER_CONTROLS_TOOLBAR_ID =
    'yt-mobile-orion-ext-controls-toolbar';
  const PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v221-transport-larger';
  const FYP_OWNED_SELECTOR = [
    `#${PLAYER_CONTROLS_TOOLBAR_ID}`,
    '[data-fyp-player-action]',
    '[data-fyp-player-option]',
  ].join(',');
  const MENU_OPTION_TAP_SLOP_PX = 12;
  const FALLBACK_QUALITY_LEVELS = Object.freeze([
    'auto',
    'hd1080',
    'hd720',
    'large',
    'medium',
    'small',
    'tiny',
  ]);
  let fallbackUiQueued = false;
  let lastFallbackMediaSessionMetadataKey = '';
  const CHANNEL_ROOT_PATH_PATTERN =
    /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/;
  const fallbackAttachedVideos = new WeakSet();
  const fallbackSelectedCaptionTrackByVideo = new WeakMap();
  const fallbackSelectedQualityByVideo = new WeakMap();
  let ignoreFallbackPlayerControlActionsUntil = 0;
  let pendingFallbackMenuOptionGesture = null;
  const fallbackPlaybackState = {
    video: null,
    wantsPlayback: false,
    userPauseUntil: 0,
    recoveryTimers: new Set(),
  };

  const PLAYER_CONTROL_ICONS = Object.freeze({
    rewind: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="11 19 2 12 11 5 11 19"></polygon><polygon points="22 19 13 12 22 5 22 19"></polygon></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"></path></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z"></path></svg>',
    forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13 19 22 12 13 5 13 19"></polygon><polygon points="2 19 11 12 2 5 2 19"></polygon></svg>',
    pip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><rect width="10" height="7" x="11" y="14" rx="1"></rect></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>',
    speed:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
    quality:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    collapse:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg>',
    search:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search" aria-hidden="true"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>',
    close:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  });

  function playerControlButtonMarkup(action, label, icon, extraClass = '') {
    const menuAttributes =
      action === 'speed' || action === 'quality'
        ? ' aria-haspopup="menu" aria-expanded="false"'
        : '';
    const className = extraClass
      ? `fyp-player-control ${extraClass}`
      : 'fyp-player-control';
    return (
      `<button type="button" class="${className}" ` +
      `data-fyp-player-action="${action}" aria-label="${label}" ` +
      `title="${label}" aria-pressed="false"${menuAttributes}>${icon}</button>`
    );
  }

  function playerControlsMarkup() {
    return [
      playerControlButtonMarkup(
        'rewind',
        'Back 10 seconds',
        PLAYER_CONTROL_ICONS.rewind
      ),
      playerControlButtonMarkup(
        'play-pause',
        'Play',
        PLAYER_CONTROL_ICONS.play
      ),
      playerControlButtonMarkup(
        'forward',
        'Forward 10 seconds',
        PLAYER_CONTROL_ICONS.forward
      ),
      playerControlButtonMarkup(
        'pip',
        'Picture in Picture',
        PLAYER_CONTROL_ICONS.pip
      ),
      playerControlButtonMarkup(
        'fullscreen',
        'Fullscreen',
        PLAYER_CONTROL_ICONS.fullscreen
      ),
    ].join('');
  }

  function fallbackIsHidden() {
    return (
      document.hidden === true ||
      document.webkitHidden === true ||
      document.visibilityState === 'hidden' ||
      document.webkitVisibilityState === 'hidden'
    );
  }

  function clearFallbackRecoveryTimers() {
    for (const timer of fallbackPlaybackState.recoveryTimers) {
      clearTimeout(timer);
    }
    fallbackPlaybackState.recoveryTimers.clear();
  }

  function configureFallbackAudioSession() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // AudioSession is optional in Orion WebKit.
    }
  }

  function fallbackMetadataContent(selector) {
    return document.querySelector(selector)?.getAttribute('content')?.trim() || '';
  }

  function fallbackVisibleVideoTitle() {
    return (
      document
        .querySelector(
          'ytd-watch-metadata h1 yt-formatted-string, ' +
            'ytd-watch-metadata #title yt-formatted-string, ' +
            'ytd-video-primary-info-renderer h1 yt-formatted-string'
        )
        ?.textContent?.replace(/\s+/g, ' ')?.trim() || ''
    );
  }

  function updateFallbackMediaSessionMetadata() {
    if (pageRuntimeReady()) return;
    if (
      !('mediaSession' in navigator) ||
      typeof MediaMetadata !== 'function' ||
      location.pathname !== '/watch'
    ) {
      return;
    }
    const videoId = new URL(location.href).searchParams.get('v') || '';
    const title =
      fallbackVisibleVideoTitle() ||
      fallbackMetadataContent('meta[property="og:title"]') ||
      fallbackMetadataContent('meta[name="title"]') ||
      document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
    const artist =
      document
        .querySelector(
          'ytd-video-owner-renderer #channel-name a, ' +
            'ytd-watch-metadata #owner #channel-name a'
        )
        ?.textContent?.trim() ||
      'YouTube';
    const artworkCandidates = [
      videoId
        ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        : '',
      fallbackMetadataContent('meta[property="og:image"]'),
    ];
    const artwork = [];
    for (const src of artworkCandidates) {
      if (!src) continue;
      try {
        artwork.push({ src: new URL(src, location.href).href });
        break;
      } catch {}
    }
    if (!title || !artwork.length) return;
    const video = fallbackVideo(false);
    const preferred =
      artwork.find((item) => item.src.includes('/hqdefault.jpg')) ||
      artwork[artwork.length - 1];
    if (
      video instanceof HTMLVideoElement &&
      preferred?.src &&
      video.poster !== preferred.src
    ) {
      video.poster = preferred.src;
    }
    try {
      navigator.mediaSession.playbackState =
        video && !video.paused && !video.ended ? 'playing' : 'paused';
    } catch {}
    const metadataKey = JSON.stringify([
      videoId,
      title,
      artist,
      artwork.map((item) => item.src),
    ]);
    const currentMetadata = navigator.mediaSession.metadata;
    const currentArtwork = Array.from(currentMetadata?.artwork || []);
    const artworkStillApplied = currentArtwork.some((item) =>
      artwork.some((candidate) => candidate.src === item.src)
    );
    const textStillApplied =
      currentMetadata?.title?.trim() === title &&
      currentMetadata?.artist?.trim() === artist;
    if (
      metadataKey === lastFallbackMediaSessionMetadataKey &&
      artworkStillApplied &&
      textStillApplied
    ) {
      return;
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album: 'YouTube',
        artwork,
      });
      lastFallbackMediaSessionMetadataKey = metadataKey;
    } catch {
      // Media artwork is optional in older Orion/WebKit releases.
    }
  }

  function fallbackSafePlay(video) {
    if (
      !(video instanceof HTMLVideoElement) ||
      video.ended ||
      !fallbackPlaybackState.wantsPlayback
    ) {
      return;
    }
    markVideoInline(video);
    configureFallbackAudioSession();
    const result = video.play();
    result?.catch?.(() => {});
  }

  function recoverFallbackPlayback() {
    // Page runtime owns Media Session and background recovery when ready.
    if (pageRuntimeReady()) return;
    const video =
      fallbackPlaybackState.video || document.querySelector('video');
    if (!(video instanceof HTMLVideoElement) || video.ended) return;
    fallbackPlaybackState.video = video;
    fallbackPlaybackState.wantsPlayback = true;
    clearFallbackRecoveryTimers();
    fallbackSafePlay(video);
    for (const delay of [80, 250, 750, 1500]) {
      const timer = setTimeout(() => {
        fallbackPlaybackState.recoveryTimers.delete(timer);
        if (
          fallbackPlaybackState.wantsPlayback &&
          fallbackIsHidden()
        ) {
          fallbackSafePlay(video);
        }
      }, delay);
      fallbackPlaybackState.recoveryTimers.add(timer);
    }
  }

  function attachFallbackVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    fallbackPlaybackState.video = video;
    if (fallbackAttachedVideos.has(video)) return;
    fallbackAttachedVideos.add(video);
    video.addEventListener(
      'play',
      () => {
        if (pageRuntimeReady()) {
          syncFallbackPlayerControls();
          return;
        }
        fallbackPlaybackState.video = video;
        fallbackPlaybackState.wantsPlayback = true;
        fallbackPlaybackState.userPauseUntil = 0;
        configureFallbackAudioSession();
        markVideoInline(video);
        updateFallbackMediaSessionMetadata();
        syncFallbackPlayerControls();
      },
      true
    );
    video.addEventListener(
      'pause',
      () => {
        if (pageRuntimeReady()) {
          syncFallbackPlayerControls();
          return;
        }
        if (fallbackPlaybackState.video !== video) return;
        if (
          Date.now() <= fallbackPlaybackState.userPauseUntil ||
          !fallbackPlaybackState.wantsPlayback ||
          video.ended
        ) {
          syncFallbackPlayerControls();
          return;
        }
        if (fallbackIsHidden()) recoverFallbackPlayback();
        else fallbackPlaybackState.wantsPlayback = false;
        syncFallbackPlayerControls();
      },
      true
    );
  }

  function prepareFallbackBackgroundPlayback() {
    // When page.js is alive, do not steal Media Session handlers or recover
    // playback from the isolated world — that fights Lock Screen / Dynamic
    // Island controls and the in-page play/pause strip.
    if (pageRuntimeReady()) return;
    const video =
      fallbackPlaybackState.video || document.querySelector('video');
    if (!(video instanceof HTMLVideoElement) || video.ended) return;
    attachFallbackVideo(video);
    if (
      !video.paused &&
      Date.now() > fallbackPlaybackState.userPauseUntil
    ) {
      fallbackPlaybackState.wantsPlayback = true;
    }
    configureFallbackAudioSession();
    updateFallbackMediaSessionMetadata();
    if (fallbackPlaybackState.wantsPlayback) recoverFallbackPlayback();
    try {
      navigator.mediaSession?.setActionHandler('play', () => {
        fallbackPlaybackState.wantsPlayback = true;
        fallbackPlaybackState.userPauseUntil = 0;
        fallbackSafePlay(video);
        syncFallbackPlayerControls();
        setTimeout(syncFallbackPlayerControls, 0);
        setTimeout(syncFallbackPlayerControls, 250);
      });
      navigator.mediaSession?.setActionHandler('pause', () => {
        fallbackPlaybackState.wantsPlayback = false;
        fallbackPlaybackState.userPauseUntil = Date.now() + 5000;
        clearFallbackRecoveryTimers();
        video.pause();
        syncFallbackPlayerControls();
        setTimeout(syncFallbackPlayerControls, 0);
        setTimeout(syncFallbackPlayerControls, 250);
      });
    } catch {
      // Media Session handlers are optional in Orion.
    }
  }

  function markVideoInline(video) {
    if (!video || String(video.tagName).toLowerCase() !== 'video') return;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('x-webkit-airplay', 'deny');
    try {
      video.playsInline = true;
      video.webkitPlaysInline = true;
      video.removeAttribute('disablepictureinpicture');
      video.disablePictureInPicture = false;
    } catch {
      // Attribute enforcement above remains effective in Orion's isolated world.
    }
  }

  function markVideoTree(root = document) {
    if (String(root?.tagName).toLowerCase() === 'video') {
      markVideoInline(root);
      attachFallbackVideo(root);
    }
    root?.querySelectorAll?.('video').forEach((video) => {
      markVideoInline(video);
      attachFallbackVideo(video);
    });
  }

  function fallbackVideo(shouldAttach = true) {
    const stateVideo =
      fallbackPlaybackState.video instanceof HTMLVideoElement &&
      fallbackPlaybackState.video.isConnected
        ? fallbackPlaybackState.video
        : null;
    const video =
      stateVideo || document.querySelector('video.html5-main-video, video');
    if (!(video instanceof HTMLVideoElement)) return null;
    if (shouldAttach) attachFallbackVideo(video);
    return video;
  }

  function syncFallbackPlayerControls() {
    const toolbar = document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID);
    if (!(toolbar instanceof HTMLElement)) return;
    const video = fallbackVideo(false);
    const playButton = toolbar.querySelector(
      '[data-fyp-player-action="play-pause"]'
    );
    if (playButton instanceof HTMLButtonElement) {
      const paused = !video || video.paused || video.ended;
      const label = paused ? 'Play' : 'Pause';
      const playbackState = paused ? 'paused' : 'playing';
      if (playButton.dataset.fypPlaybackState !== playbackState) {
        playButton.dataset.fypPlaybackState = playbackState;
        playButton.innerHTML = paused
          ? PLAYER_CONTROL_ICONS.play
          : PLAYER_CONTROL_ICONS.pause;
      }
      playButton.setAttribute('aria-label', label);
      playButton.title = label;
      playButton.setAttribute('aria-pressed', String(!paused));
    }
    const pipButton = toolbar.querySelector('[data-fyp-player-action="pip"]');
    if (pipButton instanceof HTMLButtonElement) {
      const active =
        document.pictureInPictureElement === video ||
        video?.webkitPresentationMode === 'picture-in-picture';
      pipButton.setAttribute('aria-pressed', String(active));
    }
    const fullscreenButton = toolbar.querySelector(
      '[data-fyp-player-action="fullscreen"]'
    );
    if (fullscreenButton instanceof HTMLButtonElement) {
      const active = Boolean(
        document.fullscreenElement ||
          document.webkitFullscreenElement ||
          video?.webkitDisplayingFullscreen
      );
      fullscreenButton.setAttribute('aria-pressed', String(active));
    }
  }

  function fallbackPlayerMenuHosts() {
    return [
      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID),
    ].filter((node) => node instanceof HTMLElement);
  }

  function closeFallbackPlayerControlMenu(host) {
    const hosts = host instanceof HTMLElement ? [host] : fallbackPlayerMenuHosts();
    for (const menuHost of hosts) {
      menuHost.querySelector('.fyp-player-menu')?.remove();
      menuHost
        .querySelectorAll('[aria-haspopup="menu"]')
        .forEach((button) => button.setAttribute('aria-expanded', 'false'));
    }
  }

  function createFallbackPlayerControlMenu(host, sourceButton, label) {
    if (!(host instanceof HTMLElement)) return null;
    const current = host.querySelector('.fyp-player-menu');
    if (
      current?.dataset.fypMenuOwner === sourceButton.dataset.fypPlayerAction
    ) {
      closeFallbackPlayerControlMenu(host);
      return null;
    }
    closeFallbackPlayerControlMenu();
    const menu = document.createElement('div');
    menu.className = 'fyp-player-menu';
    menu.dataset.fypMenuOwner = sourceButton.dataset.fypPlayerAction || '';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    sourceButton.setAttribute('aria-expanded', 'true');
    host.appendChild(menu);
    return menu;
  }

  function appendFallbackPlayerMenuTitle(menu, text) {
    const title = document.createElement('div');
    title.className = 'fyp-player-menu-title';
    title.textContent = text;
    menu.appendChild(title);
  }

  function appendFallbackPlayerMenuCollapse(menu) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fyp-player-menu-collapse';
    button.dataset.fypPlayerOption = 'menu-collapse';
    button.setAttribute('aria-label', 'Collapse menu');
    button.title = 'Collapse menu';
    button.innerHTML = PLAYER_CONTROL_ICONS.collapse;
    menu.appendChild(button);
    return button;
  }

  function appendFallbackPlayerMenuOption(
    menu,
    {
      action,
      label,
      checked = false,
      disabled = false,
      trackIndex,
      speed,
      quality,
      captionLanguage,
      captionLabel,
    }
  ) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'fyp-player-menu-option';
    option.dataset.fypPlayerOption = action;
    if (trackIndex !== undefined) {
      option.dataset.fypTrackIndex = String(trackIndex);
    }
    if (speed !== undefined) option.dataset.fypSpeed = String(speed);
    if (quality !== undefined) option.dataset.fypQuality = String(quality);
    if (captionLanguage !== undefined) {
      option.dataset.fypCaptionLanguage = String(captionLanguage);
    }
    if (captionLabel !== undefined) {
      option.dataset.fypCaptionLabel = String(captionLabel);
    }
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', String(checked));
    option.disabled = disabled;
    option.textContent = label;
    menu.appendChild(option);
    return option;
  }

  function fallbackCaptionTracks(video) {
    const tracks = [...video.textTracks].filter(
      (track) => track.kind === 'captions' || track.kind === 'subtitles'
    );
    const seen = new Set();
    return tracks.filter((track) => {
      const key = `${track.label || ''}|${track.language || ''}`
        .trim()
        .toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function fallbackCaptionOptionText(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value?.simpleText === 'string') return value.simpleText.trim();
    if (Array.isArray(value?.runs)) {
      return value.runs.map((run) => run.text || '').join('').trim();
    }
    return '';
  }

  function fallbackYouTubeCaptionTrackList() {
    const player = document.querySelector('#movie_player');
    if (!player || typeof player.getOption !== 'function') return [];
    try {
      const tracks = player.getOption('captions', 'tracklist');
      return Array.isArray(tracks) ? tracks : [];
    } catch {
      return [];
    }
  }

  function selectFallbackYouTubeCaptionTrack(selectedTrack) {
    const player = document.querySelector('#movie_player');
    if (!player || typeof player.setOption !== 'function') return false;
    try {
      player.loadModule?.('captions');
    } catch {}
    const selectedLabel = String(
      selectedTrack?.label || selectedTrack?.captionLabel || ''
    )
      .trim()
      .toLowerCase();
    const selectedLanguage = String(
      selectedTrack?.language ||
        selectedTrack?.languageCode ||
        selectedTrack?.captionLanguage ||
        selectedTrack?.lang ||
        ''
    ).toLowerCase();
    const youtubeTrackList = fallbackYouTubeCaptionTrackList();
    let youtubeTrack =
      youtubeTrackList.find((track) => {
        const label = fallbackCaptionOptionText(
          track.displayName || track.name || track.label
        ).toLowerCase();
        const language = String(
          track.languageCode || track.language || track.lang || ''
        ).toLowerCase();
        return (
          (selectedLabel && label === selectedLabel) ||
          (selectedLanguage && language === selectedLanguage)
        );
      }) || null;
    if (!youtubeTrack && selectedTrack && typeof selectedTrack === 'object') {
      if (
        selectedTrack.languageCode ||
        selectedTrack.language ||
        selectedTrack.lang
      ) {
        youtubeTrack = selectedTrack;
      } else if (selectedLanguage) {
        youtubeTrack = {
          languageCode: selectedLanguage,
          language: selectedLanguage,
        };
      }
    }
    if (!youtubeTrack) return false;
    try {
      player.setOption('captions', 'track', youtubeTrack);
      player.setOption('captions', 'reload', true);
      return true;
    } catch {
      return false;
    }
  }

  function currentFallbackYouTubeCaptionTrack() {
    const player = document.querySelector('#movie_player');
    if (!player || typeof player.getOption !== 'function') return null;
    try {
      const track = player.getOption('captions', 'track');
      if (!track || typeof track !== 'object') return null;
      const language = String(
        track.languageCode || track.language || track.lang || ''
      ).trim();
      const label = fallbackCaptionOptionText(
        track.displayName || track.name || track.label
      );
      if (!language && !label) return null;
      return track;
    } catch {
      return null;
    }
  }

  function fallbackQualityOptionLabel(quality) {
    const labels = {
      auto: 'Auto',
      highres: 'High res',
      hd2160: '2160p',
      hd1440: '1440p',
      hd1080: '1080p',
      hd720: '720p',
      large: '480p',
      medium: '360p',
      small: '240p',
      tiny: '144p',
    };
    return labels[quality] || String(quality || '').toUpperCase() || 'Auto';
  }

  function fallbackYouTubeQualityLevels() {
    const player = document.querySelector('#movie_player');
    if (!player) return [...FALLBACK_QUALITY_LEVELS];
    let levels = [];
    try {
      if (typeof player.getAvailableQualityLevels === 'function') {
        levels = player.getAvailableQualityLevels() || [];
      }
    } catch {}
    if (!levels.length) {
      try {
        const optionLevels = player.getOption?.('quality', 'levels');
        levels = Array.isArray(optionLevels) ? optionLevels : [];
      } catch {
        levels = [];
      }
    }
    if (!levels.length) {
      try {
        const qualityData = player.getAvailableQualityData?.() || [];
        levels = qualityData
          .map((entry) => entry?.quality || entry?.id || entry)
          .filter(Boolean);
      } catch {
        levels = [];
      }
    }
    const normalized = [
      ...new Set(
        levels.map((level) => String(level || '').trim()).filter(Boolean)
      ),
    ];
    if (!normalized.includes('auto')) normalized.unshift('auto');
    if (normalized.length <= 1) return [...FALLBACK_QUALITY_LEVELS];
    return normalized;
  }

  function currentFallbackYouTubeQuality(video) {
    if (video && fallbackSelectedQualityByVideo.has(video)) {
      return fallbackSelectedQualityByVideo.get(video);
    }
    const player = document.querySelector('#movie_player');
    try {
      return (
        player?.getPlaybackQuality?.() ||
        player?.getOption?.('quality', 'requested') ||
        'auto'
      );
    } catch {
      return 'auto';
    }
  }

  function applyFallbackYouTubeQuality(quality) {
    const player = document.querySelector('#movie_player');
    if (!player || !quality) return;
    try {
      player.setPlaybackQualityRange?.(quality, quality);
    } catch {}
    try {
      player.setPlaybackQuality?.(quality);
    } catch {}
    try {
      player.setOption?.('quality', 'requested', quality);
    } catch {}
  }

  function fallbackMenuHostForButton(sourceButton) {
    return (
      sourceButton.closest(`#${PLAYER_CONTROLS_TOOLBAR_ID}`)
    );
  }

  function toggleFallbackSpeedMenu(video, sourceButton) {
    const host = fallbackMenuHostForButton(sourceButton);
    if (!(host instanceof HTMLElement)) return;
    const menu = createFallbackPlayerControlMenu(
      host,
      sourceButton,
      'Playback speed'
    );
    if (!menu) return;
    appendFallbackPlayerMenuCollapse(menu);
    appendFallbackPlayerMenuTitle(menu, 'Playback speed');
    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      appendFallbackPlayerMenuOption(menu, {
        action: 'playback-speed',
        label: speed === 1 ? 'Normal' : `${speed}×`,
        checked: Math.abs(video.playbackRate - speed) < 0.01,
        speed,
      });
    }
  }

  function toggleFallbackQualityMenu(video, sourceButton) {
    const host = fallbackMenuHostForButton(sourceButton);
    if (!(host instanceof HTMLElement)) return;
    const menu = createFallbackPlayerControlMenu(
      host,
      sourceButton,
      'Video quality'
    );
    if (!menu) return;
    appendFallbackPlayerMenuCollapse(menu);
    appendFallbackPlayerMenuTitle(menu, 'Video quality');
    const qualities = fallbackYouTubeQualityLevels();
    const currentQuality = String(currentFallbackYouTubeQuality(video) || 'auto');
    for (const quality of qualities) {
      appendFallbackPlayerMenuOption(menu, {
        action: 'playback-quality',
        label: fallbackQualityOptionLabel(quality),
        checked: currentQuality === quality,
        quality,
      });
    }
  }

  async function runFallbackPlayerControlOption(option) {
    const video = fallbackVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    const preservePlayback = !video.paused;
    const action = option.dataset.fypPlayerOption;

    if (action === 'menu-collapse') {
      // Close only; shared cleanup below still runs.
    } else if (action === 'captions-off') {
      const applyCaptionsOff = () => {
        try {
          const player = document.querySelector('#movie_player');
          player?.loadModule?.('captions');
          player?.setOption?.('captions', 'track', {});
        } catch {}
        fallbackSelectedCaptionTrackByVideo.delete(video);
      };
      applyCaptionsOff();
      setTimeout(applyCaptionsOff, 120);
    } else if (action === 'caption-track') {
      const language = String(option.dataset.fypCaptionLanguage || '').trim();
      const label = String(option.dataset.fypCaptionLabel || '').trim();
      const trackIndex = Number(option.dataset.fypTrackIndex);
      const youtubeTracks = fallbackYouTubeCaptionTrackList();
      const textTracks = fallbackCaptionTracks(video);
      const selectedMeta =
        (Number.isFinite(trackIndex) && youtubeTracks[trackIndex]) ||
        {
          language,
          languageCode: language,
          label,
          captionLanguage: language,
          captionLabel: label,
        };
      const applyCaptionSelection = () => {
        selectFallbackYouTubeCaptionTrack(selectedMeta);
        const matchedTextTrack =
          (Number.isFinite(trackIndex) && textTracks[trackIndex]) ||
          textTracks.find((track) => {
            const trackLanguage = String(track.language || '').toLowerCase();
            const trackLabel = String(track.label || '')
              .trim()
              .toLowerCase();
            return (
              (language && trackLanguage === language.toLowerCase()) ||
              (label && trackLabel === label.toLowerCase())
            );
          });
        if (matchedTextTrack) {
          fallbackSelectedCaptionTrackByVideo.set(video, matchedTextTrack);
        } else {
          fallbackSelectedCaptionTrackByVideo.set(video, selectedMeta);
        }
      };
      applyCaptionSelection();
      setTimeout(applyCaptionSelection, 120);
    } else if (action === 'playback-speed') {
      const speed = Number(option.dataset.fypSpeed);
      if (Number.isFinite(speed)) {
        const applyPlaybackRate = () => {
          video.playbackRate = speed;
          try {
            document.querySelector('#movie_player')?.setPlaybackRate?.(speed);
          } catch {}
        };
        applyPlaybackRate();
        setTimeout(applyPlaybackRate, 120);
      }
    } else if (action === 'playback-quality') {
      const quality = String(option.dataset.fypQuality || '').trim();
      if (quality) {
        const applyQuality = () => {
          applyFallbackYouTubeQuality(quality);
          fallbackSelectedQualityByVideo.set(video, quality);
        };
        applyQuality();
        setTimeout(applyQuality, 120);
      }
    }

    if (preservePlayback) {
      fallbackPlaybackState.wantsPlayback = true;
      fallbackPlaybackState.userPauseUntil = 0;
      for (const delay of [0, 120, 350]) {
        setTimeout(() => {
          if (video.paused && !video.ended) fallbackSafePlay(video);
        }, delay);
      }
    }
    closeFallbackPlayerControlMenu();
    setTimeout(syncFallbackPlayerControls, 0);
    setTimeout(syncFallbackPlayerControls, 250);
  }

  async function runFallbackPlayerControlAction(action, sourceButton) {
    const video = fallbackVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    const preservePlayback = action !== 'play-pause' && !video.paused;
    if (action === 'rewind' || action === 'forward') {
      const offset = action === 'rewind' ? -10 : 10;
      const duration = Number.isFinite(video.duration)
        ? video.duration
        : Number.POSITIVE_INFINITY;
      video.currentTime = Math.max(
        0,
        Math.min(duration, video.currentTime + offset)
      );
    } else if (action === 'play-pause') {
      if (video.paused || video.ended) {
        fallbackPlaybackState.wantsPlayback = true;
        fallbackPlaybackState.userPauseUntil = 0;
        try {
          await video.play();
        } catch {
          document.querySelector('.ytp-play-button')?.click();
        }
      } else {
        fallbackPlaybackState.wantsPlayback = false;
        fallbackPlaybackState.userPauseUntil = Date.now() + 3000;
        clearFallbackRecoveryTimers();
        video.pause();
      }
    } else if (
      action === 'speed' &&
      sourceButton instanceof HTMLButtonElement
    ) {
      toggleFallbackSpeedMenu(video, sourceButton);
    } else if (
      action === 'quality' &&
      sourceButton instanceof HTMLButtonElement
    ) {
      toggleFallbackQualityMenu(video, sourceButton);
    } else if (action === 'pip') {
      video.removeAttribute('disablepictureinpicture');
      try {
        video.disablePictureInPicture = false;
      } catch {}
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture?.();
      } else if (typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture();
      } else if (typeof video.webkitSetPresentationMode === 'function') {
        const mode =
          video.webkitPresentationMode === 'picture-in-picture'
            ? 'inline'
            : 'picture-in-picture';
        video.webkitSetPresentationMode(mode);
      }
    } else if (action === 'fullscreen') {
      const player =
        video.closest('#movie_player, .html5-video-player, ytd-player') ||
        video;
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit =
          document.exitFullscreen || document.webkitExitFullscreen;
        await exit?.call(document);
      } else {
        const request =
          player.requestFullscreen ||
          player.webkitRequestFullscreen ||
          player.webkitRequestFullScreen;
        if (typeof request === 'function') {
          await request.call(player);
        } else {
          const enter =
            video.webkitEnterFullscreen || video.webkitEnterFullScreen;
          enter?.call(video);
        }
      }
    }
    if (preservePlayback) {
      fallbackPlaybackState.wantsPlayback = true;
      fallbackPlaybackState.userPauseUntil = 0;
      for (const delay of [0, 120, 350]) {
        setTimeout(() => {
          if (video.paused && !video.ended) fallbackSafePlay(video);
        }, delay);
      }
    }
    setTimeout(syncFallbackPlayerControls, 0);
    setTimeout(syncFallbackPlayerControls, 250);
  }

  function acceptSingleFallbackPlayerControlAction(button) {
    if (!(button instanceof HTMLElement)) return false;
    const now = Date.now();
    const previous = Number(button.dataset.fypLastActionAt || 0);
    if (now - previous < 450) return false;
    button.dataset.fypLastActionAt = String(now);
    return true;
  }

  function fallbackEventClientPoint(event) {
    if (event.changedTouches?.[0]) {
      return {
        x: event.changedTouches[0].clientX,
        y: event.changedTouches[0].clientY,
      };
    }
    if (event.touches?.[0]) {
      return {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      };
    }
    return {
      x: Number(event.clientX) || 0,
      y: Number(event.clientY) || 0,
    };
  }

  function handleFallbackPlayerControlActionCapture(event) {
    if (pageRuntimeReady()) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest(FYP_OWNED_SELECTOR)) return;

    if (Date.now() < ignoreFallbackPlayerControlActionsUntil) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const optionButton = target.closest('[data-fyp-player-option]');
    if (optionButton instanceof HTMLButtonElement) {
      if (event.type === 'pointerdown' || event.type === 'touchstart') {
        const point = fallbackEventClientPoint(event);
        pendingFallbackMenuOptionGesture = {
          button: optionButton,
          x: point.x,
          y: point.y,
        };
        event.stopPropagation();
        return;
      }
      if (event.type === 'pointercancel' || event.type === 'touchcancel') {
        pendingFallbackMenuOptionGesture = null;
        return;
      }
      if (event.type === 'pointerup' || event.type === 'touchend') {
        const gesture = pendingFallbackMenuOptionGesture;
        pendingFallbackMenuOptionGesture = null;
        if (!gesture || gesture.button !== optionButton) return;
        const point = fallbackEventClientPoint(event);
        const moved =
          Math.abs(point.x - gesture.x) > MENU_OPTION_TAP_SLOP_PX ||
          Math.abs(point.y - gesture.y) > MENU_OPTION_TAP_SLOP_PX;
        if (moved) return;
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
        if (!acceptSingleFallbackPlayerControlAction(optionButton)) return;
        ignoreFallbackPlayerControlActionsUntil = Date.now() + 500;
        void runFallbackPlayerControlOption(optionButton);
        return;
      }
      if (event.type === 'click') {
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }

    const button = target.closest('[data-fyp-player-action]');
    if (!(button instanceof HTMLButtonElement)) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    if (!acceptSingleFallbackPlayerControlAction(button)) return;
    void runFallbackPlayerControlAction(
      button.dataset.fypPlayerAction,
      button
    );
  }

  function closeFallbackPlayerControlMenuFromOutside(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(`#${PLAYER_CONTROLS_TOOLBAR_ID}`)) return;
    closeFallbackPlayerControlMenu();
  }

  function enforceFallbackHorizontalViewportLock() {
    const scrollingElement = document.scrollingElement;
    if (scrollingElement?.scrollLeft) scrollingElement.scrollLeft = 0;
    if (document.documentElement.scrollLeft) {
      document.documentElement.scrollLeft = 0;
    }
    if (document.body?.scrollLeft) document.body.scrollLeft = 0;
  }

  const FALLBACK_SKIP_AD_SELECTOR = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    'button[class*="ytp-ad-skip"]',
  ].join(',');

  function skipFallbackPlayerAd() {
    document
      .querySelectorAll(FALLBACK_SKIP_AD_SELECTOR)
      .forEach((button) => button.click());
  }

  const FALLBACK_AD_BLOCK_ENFORCEMENT_PATTERN =
    /ad blockers? (?:are not allowed|violate)|ad blocker.{0,40}youtube|video playback is blocked|disable (?:your )?ad blocker|allow youtube ads|ad-blocking software/i;

  function dismissFallbackAdBlockEnforcement(root = document) {
    let removed = false;
    const candidates = root.querySelectorAll?.(
      [
        'ytd-enforcement-message-view-model',
        'yt-playability-error-supported-renderers',
        '#error-screen',
        'tp-yt-paper-dialog',
      ].join(',')
    );
    for (const candidate of candidates || []) {
      const text = (candidate.textContent || '').replace(/\s+/g, ' ').trim();
      if (!FALLBACK_AD_BLOCK_ENFORCEMENT_PATTERN.test(text)) continue;
      const dialog = candidate.closest('tp-yt-paper-dialog') || candidate;
      dialog.remove();
      removed = true;
    }
    if (!removed) return;

    if (!document.querySelector('tp-yt-paper-dialog[opened]')) {
      document
        .querySelectorAll(
          'tp-yt-iron-overlay-backdrop.opened, ' +
            'tp-yt-paper-dialog + tp-yt-iron-overlay-backdrop'
        )
        .forEach((backdrop) => backdrop.remove());
      document.documentElement.style.removeProperty('overflow');
      document.body?.style.removeProperty('overflow');
      document.querySelector('ytd-app')?.removeAttribute('aria-hidden');
    }

    const video = fallbackVideo();
    if (video && video.paused && !video.ended && video.readyState > 0) {
      fallbackPlaybackState.wantsPlayback = true;
      fallbackPlaybackState.userPauseUntil = 0;
      fallbackSafePlay(video);
    }
  }

  function visiblePlacementTarget(selectors) {
    return [...document.querySelectorAll(selectors)].find((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.getClientRects().length > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
  }

  function ensureFallbackPlayerControlsToolbar() {
    if (location.pathname !== '/watch') {
      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID)?.remove();
      return;
    }
    const titleCandidate = visiblePlacementTarget(
      [
        'ytd-watch-metadata #title',
        'ytd-video-primary-info-renderer #title',
        'ytd-watch-flexy #below h1',
        'ytd-watch-flexy #primary h1',
      ].join(',')
    );
    const title = titleCandidate?.closest('#title, h1') || titleCandidate;
    const playerAnchor = visiblePlacementTarget(
      [
        'ytd-watch-flexy #player-full-bleed-container',
        'ytd-watch-flexy #player-container-outer',
        'ytd-watch-flexy #player',
        '#player-container-outer',
        '#player',
      ].join(',')
    );
    if (!(title instanceof Element) && !(playerAnchor instanceof Element)) {
      return;
    }
    let toolbar = document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID);
    if (
      !(toolbar instanceof HTMLElement) ||
      toolbar.dataset.fypControlsLayout !== PLAYER_CONTROLS_LAYOUT_VERSION
    ) {
      toolbar?.remove();
      toolbar = document.createElement('div');
      toolbar.id = PLAYER_CONTROLS_TOOLBAR_ID;
      toolbar.dataset.fypControlsLayout = PLAYER_CONTROLS_LAYOUT_VERSION;
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', 'Video player controls');
      toolbar.innerHTML = playerControlsMarkup();
    }
    if (title instanceof Element) {
      if (title.nextElementSibling !== toolbar) {
        title.insertAdjacentElement('afterend', toolbar);
      }
    } else if (
      playerAnchor instanceof Element &&
      playerAnchor.nextElementSibling !== toolbar
    ) {
      playerAnchor.insertAdjacentElement('afterend', toolbar);
    }
    syncFallbackPlayerControls();
  }

  function scheduleFallbackPlayerControlsToolbar() {
    if (fallbackUiQueued) return;
    fallbackUiQueued = true;
    setTimeout(() => {
      fallbackUiQueued = false;
      ensureFallbackPlayerControlsToolbar();
    }, 0);
  }

  function redirectShorts() {
    if (!location.pathname.startsWith('/shorts')) return false;
    location.replace('https://www.youtube.com/?app=desktop&persist_app=1');
    return true;
  }

  function channelVideosUrl(input) {
    let target;
    try {
      target = new URL(input, location.href);
    } catch {
      return null;
    }
    if (
      !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(
        target.hostname
      ) ||
      !CHANNEL_ROOT_PATH_PATTERN.test(target.pathname)
    ) {
      return null;
    }
    target.protocol = 'https:';
    target.hostname = 'www.youtube.com';
    target.port = '';
    target.pathname = `${target.pathname.replace(/\/+$/, '')}/videos`;
    target.searchParams.set('app', 'desktop');
    target.searchParams.set('persist_app', '1');
    return target;
  }

  function redirectChannelRootToVideos() {
    const target = channelVideosUrl(location.href);
    if (!target || target.href === location.href) return false;
    location.replace(target.href);
    return true;
  }

  function redirectChannelLinkToVideos(event) {
    if (
      event.defaultPrevented ||
      event.button > 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const link = event.target?.closest?.('a[href]');
    const target = channelVideosUrl(link?.href || link?.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign(target.href);
  }

  function markFallbackHistoryFeedBrowse() {
    const browse = document.querySelector('ytd-browse');
    if (!(browse instanceof HTMLElement)) return;
    if (location.pathname.startsWith('/feed/history')) {
      browse.setAttribute(HISTORY_FEED_ATTR, 'history');
    } else if (browse.getAttribute(HISTORY_FEED_ATTR) === 'history') {
      browse.removeAttribute(HISTORY_FEED_ATTR);
    }
  }

  function installDomFallbacks() {
    if (redirectChannelRootToVideos()) return;
    redirectShorts();
    markVideoTree(document);
    markFallbackHistoryFeedBrowse();
    ensureFallbackPlayerControlsToolbar();

    const videoObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) markVideoTree(node);
      }
      scheduleFallbackPlayerControlsToolbar();
    });
    videoObserver.observe(document, { childList: true, subtree: true });

    const prepareInlinePlayback = (event) => {
      const target = event.target;
      if (
        String(target?.tagName).toLowerCase() === 'video' ||
        target?.closest?.('#movie_player, ytd-player, #player-container')
      ) {
        markVideoTree(document);
      }
    };
    document.addEventListener('pointerdown', prepareInlinePlayback, true);
    document.addEventListener('touchstart', prepareInlinePlayback, {
      capture: true,
      passive: true,
    });
    document.addEventListener('click', prepareInlinePlayback, true);
    document.addEventListener(
      'play',
      (event) => markVideoInline(event.target),
      true
    );
    document.addEventListener(
      'PointerEvent' in window ? 'pointerdown' : 'touchstart',
      handleFallbackPlayerControlActionCapture,
      { capture: true, passive: false }
    );
    document.addEventListener(
      'PointerEvent' in window ? 'pointerup' : 'touchend',
      handleFallbackPlayerControlActionCapture,
      { capture: true, passive: false }
    );
    document.addEventListener(
      'PointerEvent' in window ? 'pointercancel' : 'touchcancel',
      handleFallbackPlayerControlActionCapture,
      { capture: true, passive: true }
    );
    document.addEventListener(
      'PointerEvent' in window ? 'pointerdown' : 'touchstart',
      closeFallbackPlayerControlMenuFromOutside,
      true
    );
    if (!('PointerEvent' in window)) {
      document.addEventListener(
        'click',
        handleFallbackPlayerControlActionCapture,
        true
      );
    }
    document.addEventListener(
      'scroll',
      enforceFallbackHorizontalViewportLock,
      { capture: true, passive: true }
    );
    window.addEventListener('scroll', enforceFallbackHorizontalViewportLock, {
      passive: true,
    });

    document.addEventListener(
      'visibilitychange',
      () => {
        if (fallbackIsHidden()) prepareFallbackBackgroundPlayback();
      },
      true
    );
    document.addEventListener(
      'webkitvisibilitychange',
      () => {
        if (fallbackIsHidden()) prepareFallbackBackgroundPlayback();
      },
      true
    );
    document.addEventListener(
      'freeze',
      prepareFallbackBackgroundPlayback,
      true
    );
    document.addEventListener(
      'yt-navigate-finish',
      () => {
        if (!redirectChannelRootToVideos()) {
          markFallbackHistoryFeedBrowse();
          ensureFallbackPlayerControlsToolbar();
        }
      },
      true
    );
    window.addEventListener(
      'blur',
      prepareFallbackBackgroundPlayback,
      true
    );
    window.addEventListener(
      'pagehide',
      prepareFallbackBackgroundPlayback,
      true
    );
    setInterval(() => {
      markFallbackHistoryFeedBrowse();
      ensureFallbackPlayerControlsToolbar();
      syncFallbackPlayerControls();
      updateFallbackMediaSessionMetadata();
    }, 1200);
    setInterval(() => {
      skipFallbackPlayerAd();
      dismissFallbackAdBlockEnforcement();
    }, 300);

    document.addEventListener(
      'click',
      (event) => {
        const link = event.target?.closest?.('a[href*="/shorts"]');
        if (!link) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        location.assign('https://www.youtube.com/?app=desktop&persist_app=1');
      },
      true
    );
    document.addEventListener('click', redirectChannelLinkToVideos, true);

    const installFallbackStyle = () => {
      const root = document.documentElement || document.head || document.body;
      if (!root || document.getElementById(DOM_FALLBACK_STYLE_ID)) return false;
      const style = document.createElement('style');
      style.id = DOM_FALLBACK_STYLE_ID;
      style.textContent = `
        ytd-mini-guide-renderer,
        ytd-mini-guide-entry-renderer,
        ytd-guide-entry-renderer:has(a[href^="/shorts"]),
        ytd-rich-shelf-renderer:has(a[href*="/shorts"]),
        ytd-reel-shelf-renderer,
        ytm-reel-shelf-renderer,
        ytm-shorts-lockup-view-model,
        ytm-shorts-lockup-view-model-v2,
        ytd-rich-item-renderer:has(a[href*="/shorts"]),
        yt-lockup-view-model:has(a[href*="/shorts"]),
        a[href^="/shorts"],
        a[href*="youtube.com/shorts/"],
        [is-shorts] {
          display: none !important;
        }

        ytd-enforcement-message-view-model {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        ytd-app,
        ytd-page-manager,
        ytd-watch-flexy,
        ytd-watch-flexy #columns,
        ytd-watch-flexy #primary,
        ytd-watch-flexy #secondary {
          box-sizing: border-box !important;
          max-width: 100vw !important;
          min-width: 0 !important;
        }

        html,
        body {
          width: 100% !important;
          max-width: 100vw !important;
          overflow-x: hidden !important;
          overscroll-behavior-x: none !important;
        }

        @supports (overflow: clip) {
          html,
          body {
            overflow-x: clip !important;
          }
        }

        @media (max-width: 700px) {
          ytd-browse[page-subtype='channels'],
          ytd-browse[page-subtype='channels'] #primary,
          ytd-browse[page-subtype='channels']
            ytd-two-column-browse-results-renderer,
          ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer,
          ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer #contents {
            box-sizing: border-box !important;
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100vw !important;
            margin-right: 0 !important;
            margin-left: 0 !important;
            overflow-x: hidden !important;
          }

          ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer {
            --ytd-rich-grid-items-per-row: 1 !important;
            --ytd-rich-grid-posts-per-row: 1 !important;
          }

          ytd-browse[page-subtype='channels'] ytd-rich-grid-row,
          ytd-browse[page-subtype='channels'] ytd-rich-item-renderer,
          ytd-browse[page-subtype='channels'] ytd-grid-video-renderer,
          ytd-browse[page-subtype='channels'] ytd-video-renderer,
          ytd-browse[page-subtype='channels']
            ytd-channel-video-player-renderer,
          ytd-browse[page-subtype='channels'] yt-lockup-view-model,
          ytd-browse[page-subtype='channels'] ytd-thumbnail {
            box-sizing: border-box !important;
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            margin-right: 0 !important;
            margin-left: 0 !important;
          }

          ytd-browse[page-subtype='history']
            ytd-two-column-browse-results-renderer,
          ytd-browse[${HISTORY_FEED_ATTR}='history']
            ytd-two-column-browse-results-renderer {
            box-sizing: border-box !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            width: 100% !important;
            max-width: 100vw !important;
            margin: 0 auto !important;
            padding: 0 12px !important;
            overflow-x: hidden !important;
          }

          ytd-browse[page-subtype='history'] #secondary,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary,
          ytd-browse[page-subtype='history'] ytd-browse-feed-actions-renderer,
          ytd-browse[${HISTORY_FEED_ATTR}='history']
            ytd-browse-feed-actions-renderer {
            display: flex !important;
            visibility: visible !important;
            flex-direction: column !important;
            align-items: center !important;
            order: -1 !important;
            width: 100% !important;
            max-width: 100% !important;
            position: static !important;
            text-align: center !important;
          }

          ytd-browse[page-subtype='history'] yt-chip-cloud-renderer,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-chip-cloud-renderer,
          ytd-browse[page-subtype='history'] #chips,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] #chips {
            display: flex !important;
            flex-wrap: wrap !important;
            justify-content: center !important;
            width: 100% !important;
            margin: 0 auto 8px !important;
          }

          ytd-browse[page-subtype='history'] ytd-video-renderer #dismissible,
          ytd-browse[${HISTORY_FEED_ATTR}='history']
            ytd-video-renderer #dismissible {
            display: flex !important;
            flex-direction: column !important;
            width: 100% !important;
            max-width: 100% !important;
          }

          ytd-browse[page-subtype='history'] yt-lockup-view-model,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-lockup-view-model,
          ytd-browse[page-subtype='history']
            :is(
              .yt-lockup-view-model,
              .ytLockupViewModelHost,
              .ytLockupViewModelVertical
            ),
          ytd-browse[${HISTORY_FEED_ATTR}='history']
            :is(
              .yt-lockup-view-model,
              .ytLockupViewModelHost,
              .ytLockupViewModelVertical
            ) {
            box-sizing: border-box !important;
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 auto 12px !important;
            text-align: center !important;
          }

          ytd-browse[page-subtype='history'] ytd-thumbnail,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-thumbnail,
          ytd-browse[page-subtype='history'] #thumbnail,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] #thumbnail,
          ytd-browse[page-subtype='history']
            :is(
              .yt-lockup-view-model__content-image,
              .ytLockupViewModelContentImage
            ),
          ytd-browse[${HISTORY_FEED_ATTR}='history']
            :is(
              .yt-lockup-view-model__content-image,
              .ytLockupViewModelContentImage
            ) {
            display: block !important;
            grid-column: 1 !important;
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            aspect-ratio: 16 / 9 !important;
            height: auto !important;
            overflow: hidden !important;
          }

          ytd-browse[page-subtype='history'] #details,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] #details,
          ytd-browse[page-subtype='history'] #meta,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] #meta,
          ytd-browse[page-subtype='history']
            :is(
              .yt-lockup-view-model__metadata,
              .ytLockupViewModelMetadata
            ),
          ytd-browse[${HISTORY_FEED_ATTR}='history']
            :is(
              .yt-lockup-view-model__metadata,
              .ytLockupViewModelMetadata
            ),
          ytd-browse[page-subtype='history'] h3,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] h3,
          ytd-browse[page-subtype='history'] #video-title,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] #video-title {
            display: block !important;
            grid-column: 1 !important;
            width: 100% !important;
            max-width: 100% !important;
            overflow: visible !important;
            text-align: center !important;
            white-space: normal !important;
            -webkit-line-clamp: unset !important;
          }

          ytd-browse[page-subtype='history'] #channel-info,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] #channel-info {
            display: inline-flex !important;
            visibility: visible !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 8px !important;
            margin: 4px auto 0 !important;
          }

          ytd-browse[page-subtype='history'] yt-img-shadow#avatar,
          ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-img-shadow#avatar,
          ytd-browse[page-subtype='history'] yt-decorated-avatar-view-model,
          ytd-browse[${HISTORY_FEED_ATTR}='history']
            yt-decorated-avatar-view-model {
            display: inline-flex !important;
            visibility: visible !important;
            width: 36px !important;
            height: 36px !important;
          }
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} {
          box-sizing: border-box !important;
          position: relative !important;
          z-index: 5 !important;
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          flex-wrap: wrap !important;
          width: fit-content !important;
          max-width: 100% !important;
          min-width: 0 !important;
          margin: clamp(.5rem, 2.4vw, .8rem) auto !important;
          padding: clamp(.45rem, 2vw, .7rem) !important;
          gap: clamp(.35rem, 1.8vw, .65rem) !important;
          justify-content: center !important;
          align-items: center !important;
          border: 1px solid rgba(255, 255, 255, .14) !important;
          border-radius: clamp(.85rem, 4vw, 1.2rem) !important;
          background: rgba(255, 255, 255, .08) !important;
          backdrop-filter: blur(12px) !important;
          -webkit-backdrop-filter: blur(12px) !important;
          overflow: visible !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control {
          appearance: none !important;
          box-sizing: border-box !important;
          display: inline-flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          flex: 0 0 auto !important;
          width: clamp(2.9rem, 13vw, 3.45rem) !important;
          min-width: 2.9rem !important;
          height: clamp(2.75rem, 12vw, 3.25rem) !important;
          margin: 0 !important;
          padding: clamp(.62rem, 2.6vw, .85rem) !important;
          align-items: center !important;
          justify-content: center !important;
          color: #fff !important;
          background: rgba(255, 255, 255, .12) !important;
          border: 1px solid rgba(255, 255, 255, .12) !important;
          border-radius: 999px !important;
          touch-action: manipulation !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID}
          .fyp-player-control[data-fyp-player-action='play-pause'] {
          color: #0f0f0f !important;
          background: #fff !important;
          border-color: #fff !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID}
          .fyp-player-control[aria-pressed='true']:not(
            [data-fyp-player-action='play-pause']
          ) {
          color: #fff !important;
          background: #ff0033 !important;
          border-color: #ff0033 !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg {
          display: block !important;
          width: 100% !important;
          height: 100% !important;
          max-width: clamp(1.25rem, 5.6vw, 1.6rem) !important;
          max-height: clamp(1.25rem, 5.6vw, 1.6rem) !important;
          fill: none !important;
          stroke: currentColor !important;
          stroke-width: 2 !important;
          stroke-linecap: round !important;
          stroke-linejoin: round !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID}
          .fyp-player-control[data-fyp-player-action='play-pause'] svg {
          fill: currentColor !important;
          stroke: none !important;
        }

        /* Native settings gear stays available; overflow/more clutter stays hidden. */
        #movie_player .ytp-overflow-button,
        .html5-video-player .ytp-overflow-button,
        #movie_player .ytp-more-button,
        .html5-video-player .ytp-more-button {
          display: none !important;
        }

        #movie_player .ytp-settings-button,
        .html5-video-player .ytp-settings-button {
          display: inline-flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu {
          box-sizing: border-box !important;
          flex: 1 0 100% !important;
          display: flex !important;
          flex-direction: column !important;
          width: min(100vw - 24px, 22rem) !important;
          min-width: 0 !important;
          max-height: min(42svh, 18rem) !important;
          margin-top: clamp(.15rem, .8vw, .3rem) !important;
          padding: clamp(.4rem, 2vw, .65rem) !important;
          gap: clamp(.25rem, 1vw, .4rem) !important;
          color: #fff !important;
          background: rgba(15, 15, 15, .97) !important;
          border: 1px solid rgba(255, 255, 255, .16) !important;
          border-radius: clamp(.75rem, 3vw, 1rem) !important;
          box-shadow: 0 .75rem 2rem rgba(0, 0, 0, .45) !important;
          overflow-x: hidden !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch !important;
          overscroll-behavior: contain !important;
          touch-action: pan-y !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-collapse {
          appearance: none !important;
          box-sizing: border-box !important;
          align-self: center !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: clamp(2.6rem, 12vw, 3.1rem) !important;
          min-height: clamp(1.7rem, 7vw, 2rem) !important;
          margin: 0 !important;
          padding: 0 !important;
          color: rgba(255, 255, 255, .88) !important;
          background: rgba(255, 255, 255, .08) !important;
          border: 1px solid rgba(255, 255, 255, .14) !important;
          border-radius: 999px !important;
          touch-action: manipulation !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-collapse svg {
          display: block !important;
          width: clamp(1.05rem, 4.5vw, 1.25rem) !important;
          height: clamp(1.05rem, 4.5vw, 1.25rem) !important;
          fill: none !important;
          stroke: currentColor !important;
          stroke-width: 2 !important;
          stroke-linecap: round !important;
          stroke-linejoin: round !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-title {
          padding: clamp(.25rem, 1vw, .4rem)
            clamp(.7rem, 3vw, .95rem) !important;
          color: rgba(255, 255, 255, .72) !important;
          font: 700 clamp(.78rem, 3.2vw, .9rem)/1.2
            Roboto, Arial, sans-serif !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option {
          appearance: none !important;
          box-sizing: border-box !important;
          width: 100% !important;
          min-height: clamp(2.45rem, 10vw, 2.9rem) !important;
          margin: 0 !important;
          padding: 0 clamp(.75rem, 3vw, 1rem) !important;
          color: #fff !important;
          background: rgba(255, 255, 255, .09) !important;
          border: 1px solid transparent !important;
          border-radius: clamp(.6rem, 2.5vw, .8rem) !important;
          text-align: left !important;
          font: 600 clamp(.8rem, 3.4vw, .95rem)/1.25
            Roboto, Arial, sans-serif !important;
          touch-action: pan-y !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID}
          .fyp-player-menu-option[aria-checked='true'] {
          background: #ff0033 !important;
          border-color: #ff0033 !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option:disabled {
          opacity: .55 !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID}
          .fyp-player-menu-option:focus-visible {
          outline: 2px solid #fff !important;
          outline-offset: -2px !important;
        }

        ytd-browse[page-subtype='channels']
          yt-tab-shape:has(a[href$='/shorts']),
        ytd-browse[page-subtype='channels']
          [role='tab']:has(a[href$='/shorts']),
        ytd-browse[page-subtype='channels']
          ytd-rich-item-renderer:has(a[href*='/shorts']),
        ytd-browse[page-subtype='channels']
          ytd-grid-video-renderer:has(a[href*='/shorts']),
        ytd-browse[page-subtype='channels']
          yt-lockup-view-model:has(a[href*='/shorts']),
        ytd-browse[page-subtype='channels'] ytd-reel-shelf-renderer,
        ytd-browse[page-subtype='channels']
          ytd-rich-shelf-renderer:has(a[href*='/shorts']) {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        /* Mirror page.js 2.2.3: leave native search alone; hide Ask/voice only. */
        ytd-masthead #voice-search-button,
        ytd-masthead button[aria-label*='Search with your voice' i],
        ytd-masthead button[aria-label*='Voice search' i],
        ytd-masthead [aria-label*='Ask YouTube' i],
        ytd-masthead [aria-label*='Ask Gemini' i],
        #voice-search-button,
        button[aria-label*='Search with your voice' i],
        button[aria-label*='Voice search' i],
        [aria-label*='Ask YouTube' i],
        [aria-label*='Ask Gemini' i] {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `;
      root.appendChild(style);
      return true;
    };

    if (!installFallbackStyle()) {
      const styleObserver = new MutationObserver(() => {
        if (installFallbackStyle()) styleObserver.disconnect();
      });
      styleObserver.observe(document, { childList: true, subtree: true });
    }
  }

  installDomFallbacks();

  const src = api.runtime.getURL('page.js');

  function pageRuntimeReady() {
    return (
      document.documentElement?.getAttribute(PAGE_READY_ATTR) ===
      EXPECTED_PAGE_VERSION
    );
  }

  function injectWithSrc() {
    const root = document.documentElement || document.head || document.body;
    if (!root) return false;
    if (pageRuntimeReady()) return true;
    document.getElementById(PAGE_SCRIPT_ID)?.remove();

    const script = document.createElement('script');
    script.id = PAGE_SCRIPT_ID;
    script.src = src;
    script.async = false;
    script.addEventListener(
      'error',
      () => {
        script.remove();
        injectWithText();
      },
      { once: true }
    );
    root.appendChild(script);
    return true;
  }

  async function injectWithText() {
    const root = document.documentElement || document.head || document.body;
    if (!root) return false;
    if (pageRuntimeReady()) return true;
    document.getElementById(PAGE_SCRIPT_ID)?.remove();

    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`page.js returned ${response.status}`);
      const code = await response.text();
      const script = document.createElement('script');
      script.id = PAGE_SCRIPT_ID;
      const nonceSource = document.querySelector('script[nonce]');
      const nonce = nonceSource?.nonce || nonceSource?.getAttribute('nonce');
      if (nonce) script.setAttribute('nonce', nonce);
      script.textContent = code;
      root.appendChild(script);
      script.remove();
      return pageRuntimeReady();
    } catch {
      return false;
    }
  }

  if (!injectWithSrc()) {
    const observer = new MutationObserver(() => {
      if (injectWithSrc()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }

  // A tag can exist without executing in Orion. Verify a PAGE-world handshake.
  setTimeout(() => {
    if (!pageRuntimeReady()) injectWithText();
  }, 200);

  setTimeout(() => {
    if (!pageRuntimeReady()) injectWithText();
  }, 1200);
})();
