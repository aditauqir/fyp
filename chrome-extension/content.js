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
  const EXPECTED_PAGE_VERSION = '3.1.4.g';
  const HISTORY_FEED_ATTR = 'data-fyp-feed';
  const DOM_FALLBACK_STYLE_ID = 'fyp-orion-dom-fallback-style';
  const PLAYER_CONTROLS_TOOLBAR_ID =
    'yt-mobile-orion-ext-controls-toolbar';
  const PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v311-reload-mount';
  const FYP_OWNED_SELECTOR = [
    `#${PLAYER_CONTROLS_TOOLBAR_ID}`,
    '[data-fyp-player-action]',
    '[data-fyp-player-option]',
  ].join(',');
  const MENU_OPTION_TAP_SLOP_PX = 12;
  const MEDIA_SESSION_OWNER_KEY = 'fyp:media-session-owner:v1';
  const MEDIA_SESSION_TAB_ATTR = 'data-fyp-media-session-tab';
  const MEDIA_SESSION_LEASE_MS = 15000;
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
  let fallbackMediaSessionHandlersInstalled = false;
  let fallbackMediaSessionStorageFailed = false;
  let fallbackMediaSessionLocalOwner = false;
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

  function getOrCreateFallbackMediaSessionTabId() {
    const root = document.documentElement;
    const existing = root?.getAttribute(MEDIA_SESSION_TAB_ATTR)?.trim();
    if (existing) return existing;
    const randomId =
      typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    root?.setAttribute(MEDIA_SESSION_TAB_ATTR, randomId);
    return randomId;
  }

  const fallbackMediaSessionTabId = getOrCreateFallbackMediaSessionTabId();

  function fallbackMediaSessionOwner() {
    if (fallbackMediaSessionStorageFailed) return null;
    try {
      const raw = localStorage.getItem(MEDIA_SESSION_OWNER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      fallbackMediaSessionStorageFailed = true;
      return null;
    }
  }

  function fallbackOwnsMediaSession() {
    if (fallbackMediaSessionStorageFailed) {
      return fallbackMediaSessionLocalOwner;
    }
    const owner = fallbackMediaSessionOwner();
    return Boolean(
      owner &&
        owner.tabId === fallbackMediaSessionTabId &&
        Number(owner.expiresAt) > Date.now()
    );
  }

  function claimFallbackMediaSessionOwnership(video) {
    if (
      location.pathname !== '/watch' ||
      !(video instanceof HTMLVideoElement) ||
      video.ended
    ) {
      return false;
    }
    const currentOwner = fallbackMediaSessionOwner();
    if (
      currentOwner &&
      currentOwner.tabId !== fallbackMediaSessionTabId &&
      Number(currentOwner.expiresAt) > Date.now() &&
      fallbackIsHidden()
    ) {
      return false;
    }
    const now = Date.now();
    try {
      localStorage.setItem(
        MEDIA_SESSION_OWNER_KEY,
        JSON.stringify({
          tabId: fallbackMediaSessionTabId,
          videoId: new URL(location.href).searchParams.get('v') || '',
          claimedAt: now,
          expiresAt: now + MEDIA_SESSION_LEASE_MS,
        })
      );
      fallbackMediaSessionLocalOwner = true;
      return true;
    } catch {
      // If storage is unavailable, keep the single-tab fallback operational.
      fallbackMediaSessionStorageFailed = true;
      fallbackMediaSessionLocalOwner = true;
      return true;
    }
  }

  function deactivateFallbackMediaSession() {
    if (!fallbackMediaSessionHandlersInstalled) return;
    for (const action of ['play', 'pause']) {
      try {
        navigator.mediaSession?.setActionHandler(action, null);
      } catch {}
    }
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    } catch {}
    fallbackMediaSessionHandlersInstalled = false;
    lastFallbackMediaSessionMetadataKey = '';
  }

  const PLAYER_CONTROL_ICONS = Object.freeze({
    rewind: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="11 19 2 12 11 5 11 19"></polygon><polygon points="22 19 13 12 22 5 22 19"></polygon></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"></path></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z"></path></svg>',
    forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13 19 22 12 13 5 13 19"></polygon><polygon points="2 19 11 12 2 5 2 19"></polygon></svg>',
    pip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><rect width="10" height="7" x="11" y="14" rx="1"></rect></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>',
    speed:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
    airplay:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="lucide lucide-airplay" aria-hidden="true"><path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1"></path><path d="m12 15 5 6H7Z"></path></svg>',
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
        'airplay',
        'AirPlay',
        PLAYER_CONTROL_ICONS.airplay
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
    if (!fallbackOwnsMediaSession()) return;
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
        claimFallbackMediaSessionOwnership(video);
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
      claimFallbackMediaSessionOwnership(video);
    }
    if (!fallbackOwnsMediaSession()) {
      deactivateFallbackMediaSession();
      return;
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
      fallbackMediaSessionHandlersInstalled = true;
    } catch {
      // Media Session handlers are optional in Orion.
    }
  }

  function markVideoInline(video) {
    if (!video || String(video.tagName).toLowerCase() !== 'video') return;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('x-webkit-airplay', 'allow');
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

  function fallbackYouTubeQualityOptions() {
    const player = document.querySelector('#movie_player');
    if (!player) {
      return FALLBACK_QUALITY_LEVELS.map((quality) => ({
        quality,
        label: fallbackQualityOptionLabel(quality),
      }));
    }
    const options = [];
    const seen = new Set();
    try {
      const qualityData = player.getAvailableQualityData?.() || [];
      for (const entry of qualityData) {
        const quality = String(entry?.quality || entry?.id || '').trim();
        if (!quality || seen.has(quality)) continue;
        seen.add(quality);
        options.push({
          quality,
          label:
            fallbackCaptionOptionText(
              entry?.qualityLabel || entry?.displayName || entry?.label
            ) || fallbackQualityOptionLabel(quality),
        });
      }
    } catch {}
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
    for (const level of levels) {
      const quality = String(level || '').trim();
      if (!quality || seen.has(quality)) continue;
      seen.add(quality);
      options.push({ quality, label: fallbackQualityOptionLabel(quality) });
    }
    if (!seen.has('auto')) {
      options.unshift({ quality: 'auto', label: 'Auto' });
    }
    if (options.length <= 1) {
      return FALLBACK_QUALITY_LEVELS.map((quality) => ({
        quality,
        label: fallbackQualityOptionLabel(quality),
      }));
    }
    return options;
  }

  function fallbackYouTubeQualityLevels() {
    return fallbackYouTubeQualityOptions().map((option) => option.quality);
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
    const qualities = fallbackYouTubeQualityOptions();
    const currentQuality = String(currentFallbackYouTubeQuality(video) || 'auto');
    for (const { quality, label } of qualities) {
      appendFallbackPlayerMenuOption(menu, {
        action: 'playback-quality',
        label,
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
    if (action === 'playback-quality') {
      const selectedQuality = String(option.dataset.fypQuality || '').trim();
      option
        .closest('.fyp-player-menu')
        ?.querySelectorAll('[data-fyp-player-option="playback-quality"]')
        .forEach((qualityOption) => {
          qualityOption.setAttribute(
            'aria-checked',
            String(qualityOption.dataset.fypQuality === selectedQuality)
          );
        });
    } else {
      closeFallbackPlayerControlMenu();
    }
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
    } else if (action === 'airplay') {
      video.setAttribute('x-webkit-airplay', 'allow');
      if (typeof video.webkitShowPlaybackTargetPicker === 'function') {
        video.webkitShowPlaybackTargetPicker();
      }
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

  const FALLBACK_AD_PLAYER_SELECTOR =
    '.html5-video-player.ad-showing, .html5-video-player.ad-interrupting';
  const FALLBACK_AD_PLAYER_UI_SELECTOR = [
    '.ytp-ad-player-overlay',
    '.ytp-ad-text',
    '.ytp-ad-preview-container',
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.video-ads',
    '[class*="ytp-skip-ad"]',
  ].join(',');
  const FALLBACK_MAX_AD_SEEK_DURATION_S = 90;

  function restoreFallbackAdSkipTweaks() {
    document.querySelectorAll('video[data-fyp-ad-skip-rate]').forEach((video) => {
      const restored = Number(video.dataset.fypAdSkipRate);
      if (Number.isFinite(restored) && restored > 0 && restored <= 4) {
        video.playbackRate = restored;
      } else {
        video.playbackRate = 1;
      }
      delete video.dataset.fypAdSkipRate;
    });
  }

  function skipFallbackPlayerAd() {
    document
      .querySelectorAll(FALLBACK_SKIP_AD_SELECTOR)
      .forEach((button) => button.click());

    const player = document.querySelector(FALLBACK_AD_PLAYER_SELECTOR);
    const duration = player?.querySelector?.('video')?.duration;
    const isAd =
      player &&
      (player.querySelector(FALLBACK_AD_PLAYER_UI_SELECTOR) ||
        (Number.isFinite(duration) &&
          duration > 0 &&
          duration <= FALLBACK_MAX_AD_SEEK_DURATION_S));
    if (!isAd) {
      restoreFallbackAdSkipTweaks();
      return;
    }

    const adVideo = player.querySelector('video');
    if (!(adVideo instanceof HTMLMediaElement)) return;
    if (adVideo.dataset.fypAdSkipRate == null) {
      adVideo.dataset.fypAdSkipRate = String(adVideo.playbackRate || 1);
    }
    if (
      Number.isFinite(adVideo.duration) &&
      adVideo.duration > 0 &&
      adVideo.duration <= FALLBACK_MAX_AD_SEEK_DURATION_S &&
      adVideo.currentTime < adVideo.duration
    ) {
      adVideo.currentTime = adVideo.duration;
    } else if (adVideo.playbackRate < 8) {
      adVideo.playbackRate = 16;
    }
  }

  const FALLBACK_AD_BLOCK_ENFORCEMENT_PATTERN =
    /ad blockers? (?:are not allowed|violate)|ad blocker.{0,40}youtube|video playback is blocked|disable (?:your )?ad blocker|allow youtube ads|ad-blocking software/i;

  function fallbackGuideDrawerIsBusy() {
    /*
     * Issue #1 fallback: same hamburger leftover lock as page.js. Read
     * Polymer opened/opening/peeking only. Do not set drawer attributes.
     */
    const drawer = document.querySelector(
      'tp-yt-app-drawer#guide, tp-yt-app-drawer'
    );
    if (!(drawer instanceof HTMLElement)) return false;
    if (
      drawer.hasAttribute('opened') ||
      drawer.hasAttribute('opening') ||
      drawer.hasAttribute('peeking')
    ) {
      return true;
    }
    try {
      if (drawer.opened === true) return true;
    } catch {
      // Polymer may throw on unready custom elements.
    }
    return false;
  }

  function fallbackOverlayHostIsOpen() {
    return Boolean(
      document.querySelector(
        'tp-yt-paper-dialog[opened], tp-yt-iron-dropdown[opened], ' +
          'iron-dropdown[opened]'
      )
    );
  }

  function removeFallbackOrphanAdBackdrops() {
    /*
     * Do not delete every .opened iron backdrop. The hamburger drawer can
     * share that class; only remove orphans when the drawer is closed.
     */
    if (fallbackGuideDrawerIsBusy() || fallbackOverlayHostIsOpen()) return;
    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((backdrop) => {
      if (!(backdrop instanceof HTMLElement)) return;
      if (backdrop.closest('tp-yt-app-drawer')) return;
      backdrop.remove();
    });
  }

  function restoreFallbackScrollAfterGuideClose() {
    if (pageRuntimeReady()) return;
    /*
     * Issue #1 fallback: after hamburger close, restore overflow if Polymer
     * left html/body/ytd-app locked. CSS hides leftover #scrim separately.
     */
    if (fallbackGuideDrawerIsBusy() || fallbackOverlayHostIsOpen()) return;

    for (const node of [
      document.documentElement,
      document.body,
      document.querySelector('ytd-app'),
      document.querySelector('ytm-app'),
      document.querySelector('ytd-page-manager'),
    ]) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.style.overflow === 'hidden' || node.style.overflowY === 'hidden') {
        node.style.removeProperty('overflow');
        node.style.removeProperty('overflow-y');
      }
    }

    const app = document.querySelector('ytd-app');
    if (
      app instanceof HTMLElement &&
      app.getAttribute('aria-hidden') === 'true'
    ) {
      app.removeAttribute('aria-hidden');
    }
  }

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

    removeFallbackOrphanAdBackdrops();
    restoreFallbackScrollAfterGuideClose();

    const video = fallbackVideo();
    if (video && video.paused && !video.ended && video.readyState > 0) {
      fallbackPlaybackState.wantsPlayback = true;
      fallbackPlaybackState.userPauseUntil = 0;
      fallbackSafePlay(video);
    }
  }

  function findFallbackWatchTitleAnchor() {
    const selectors = [
      'ytd-watch-metadata #title',
      'ytd-video-primary-info-renderer #title',
      'ytd-watch-flexy ytd-watch-metadata h1',
      'ytd-watch-flexy #below h1',
    ];
    for (const selector of selectors) {
      for (const candidate of document.querySelectorAll(selector)) {
        if (!isFallbackUsableWatchMount(candidate)) continue;
        return candidate.closest('#title') || candidate;
      }
    }
    return null;
  }

  function findFallbackWatchMetadataHost() {
    const selectors = [
      'ytd-watch-flexy ytd-watch-metadata',
      'ytd-watch-flexy ytd-video-primary-info-renderer',
    ];
    for (const selector of selectors) {
      for (const candidate of document.querySelectorAll(selector)) {
        if (isFallbackUsableWatchMount(candidate)) return candidate;
      }
    }
    return null;
  }

  const FALLBACK_COLLAPSED_PLAYER_SHELL_SELECTOR = [
    'ytd-watch-flexy[full-bleed-player] #columns #player',
    'ytd-watch-flexy[theater] #columns #player',
    'ytd-watch-flexy:not([full-bleed-player]) #player-full-bleed-container',
  ].join(', ');

  /*
   * Issue #2 fallback: title/metadata must be visible and not inside the
   * collapsed player shell. Reload can park the strip there before the title
   * exists.
   */
  function isFallbackUsableWatchMount(node) {
    if (!(node instanceof Element) || !node.isConnected) return false;
    if (node.closest('[hidden]')) return false;
    if (node.closest(FALLBACK_COLLAPSED_PLAYER_SHELL_SELECTOR)) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none') return false;
    return true;
  }

  function findFallbackWatchBelowHost() {
    const selectors = [
      'ytd-watch-flexy #below',
      'ytd-watch-flexy #primary-inner',
    ];
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (isFallbackUsableWatchMount(candidate)) return candidate;
    }
    return null;
  }

  function findFallbackVisibleWatchPlayerHost() {
    const watch = document.querySelector('ytd-watch-flexy');
    if (!(watch instanceof Element)) return null;
    const fullBleed =
      watch.hasAttribute('full-bleed-player') ||
      watch.hasAttribute('theater');
    const selectors = fullBleed
      ? [
          'ytd-watch-flexy #player-full-bleed-container',
          'ytd-watch-flexy #player-container-outer',
          'ytd-watch-flexy #player',
        ]
      : [
          'ytd-watch-flexy #player-container-outer',
          'ytd-watch-flexy #player',
          'ytd-watch-flexy #player-full-bleed-container',
        ];
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (!(candidate instanceof Element) || !candidate.isConnected) continue;
      if (candidate.closest(FALLBACK_COLLAPSED_PLAYER_SHELL_SELECTOR)) continue;
      if (candidate.closest('[hidden]')) continue;
      if (getComputedStyle(candidate).display === 'none') continue;
      return candidate;
    }
    return null;
  }

  function fallbackToolbarIsParkedOnPlayer(toolbar) {
    if (!(toolbar instanceof HTMLElement) || !toolbar.isConnected) {
      return false;
    }
    if (toolbar.closest('#movie_player, .html5-video-player')) return true;
    if (toolbar.closest(FALLBACK_COLLAPSED_PLAYER_SHELL_SELECTOR)) return true;
    return false;
  }

  function fallbackToolbarIsCorrectlyPlaced(
    toolbar,
    title,
    metadata,
    below,
    playerHost,
    watch
  ) {
    if (!(toolbar instanceof HTMLElement) || !toolbar.isConnected) {
      return false;
    }
    if (fallbackToolbarIsParkedOnPlayer(toolbar)) return false;
    if (title instanceof Element) {
      return (
        title.nextElementSibling === toolbar &&
        isFallbackUsableWatchMount(title)
      );
    }
    if (metadata instanceof Element) {
      return (
        toolbar.parentElement === metadata &&
        metadata.firstElementChild === toolbar &&
        isFallbackUsableWatchMount(metadata)
      );
    }
    if (below instanceof Element) {
      return (
        toolbar.parentElement === below &&
        below.firstElementChild === toolbar &&
        isFallbackUsableWatchMount(below)
      );
    }
    if (playerHost instanceof Element) {
      return (
        playerHost.nextElementSibling === toolbar &&
        !playerHost.closest(FALLBACK_COLLAPSED_PLAYER_SHELL_SELECTOR)
      );
    }
    if (watch instanceof Element) {
      return toolbar.parentElement === watch;
    }
    return false;
  }

  function mountFallbackPlayerControlsToolbar(
    toolbar,
    title,
    metadata,
    below,
    playerHost,
    watch
  ) {
    if (title instanceof Element) {
      title.insertAdjacentElement('afterend', toolbar);
      return true;
    }
    if (metadata instanceof Element) {
      metadata.insertAdjacentElement('afterbegin', toolbar);
      return true;
    }
    if (below instanceof Element) {
      below.insertAdjacentElement('afterbegin', toolbar);
      return true;
    }
    if (playerHost instanceof Element) {
      playerHost.insertAdjacentElement('afterend', toolbar);
      return true;
    }
    if (watch instanceof Element) {
      watch.append(toolbar);
      return true;
    }
    return false;
  }

  function ensureFallbackPlayerControlsToolbar() {
    if (location.pathname !== '/watch') {
      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID)?.remove();
      return;
    }
    const title = findFallbackWatchTitleAnchor();
    const metadata = findFallbackWatchMetadataHost();
    const below = findFallbackWatchBelowHost();
    const playerHost = findFallbackVisibleWatchPlayerHost();
    const watch = document.querySelector('ytd-watch-flexy');
    const watchChromeExists =
      title instanceof Element ||
      metadata instanceof Element ||
      below instanceof Element ||
      playerHost instanceof Element ||
      watch instanceof Element;
    if (!watchChromeExists) return;

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
    if (
      !fallbackToolbarIsCorrectlyPlaced(
        toolbar,
        title,
        metadata,
        below,
        playerHost,
        watch
      )
    ) {
      mountFallbackPlayerControlsToolbar(
        toolbar,
        title,
        metadata,
        below,
        playerHost,
        watch
      );
    }
    syncFallbackPlayerControls();
  }

  const FALLBACK_PLAYER_CONTROLS_TOOLBAR_RETRY_MS = Object.freeze([
    0, 60, 160, 400, 900, 1800, 3500,
  ]);
  let fallbackPlayerControlsToolbarScheduleToken = 0;

  function scheduleFallbackPlayerControlsToolbar() {
    const token = ++fallbackPlayerControlsToolbarScheduleToken;
    for (const delay of FALLBACK_PLAYER_CONTROLS_TOOLBAR_RETRY_MS) {
      setTimeout(() => {
        if (token !== fallbackPlayerControlsToolbarScheduleToken) return;
        ensureFallbackPlayerControlsToolbar();
      }, delay);
    }
  }

  function redirectShorts() {
    if (
      !location.pathname.startsWith('/shorts') &&
      !location.pathname.startsWith('/playables')
    ) {
      return false;
    }
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
    scheduleFallbackPlayerControlsToolbar();

    const videoObserver = new MutationObserver((mutations) => {
      if (pageRuntimeReady()) {
        videoObserver.disconnect();
        return;
      }
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) markVideoTree(node);
      }
      scheduleFallbackPlayerControlsToolbar();
    });
    videoObserver.observe(document, { childList: true, subtree: true });

    const prepareInlinePlayback = (event) => {
      if (pageRuntimeReady()) return;
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
          scheduleFallbackPlayerControlsToolbar();
        }
      },
      true
    );
    window.addEventListener('pageshow', scheduleFallbackPlayerControlsToolbar, true);
    window.addEventListener('popstate', scheduleFallbackPlayerControlsToolbar, true);
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
    window.addEventListener(
      'storage',
      (event) => {
        if (pageRuntimeReady() || event.key !== MEDIA_SESSION_OWNER_KEY) return;
        if (!fallbackOwnsMediaSession()) deactivateFallbackMediaSession();
      },
      true
    );
    setInterval(() => {
      if (pageRuntimeReady()) return;
      markFallbackHistoryFeedBrowse();
      ensureFallbackPlayerControlsToolbar();
      syncFallbackPlayerControls();
      updateFallbackMediaSessionMetadata();
      restoreFallbackScrollAfterGuideClose();
    }, 1200);
    setInterval(() => {
      if (pageRuntimeReady()) return;
      skipFallbackPlayerAd();
      dismissFallbackAdBlockEnforcement();
      restoreFallbackScrollAfterGuideClose();
    }, 300);

    document.addEventListener(
      'yt-guide-close',
      restoreFallbackScrollAfterGuideClose,
      true
    );
    document.addEventListener(
      'iron-overlay-closed',
      restoreFallbackScrollAfterGuideClose,
      true
    );

    document.addEventListener(
      'click',
      (event) => {
        const link = event.target?.closest?.(
          'a[href*="/shorts"], a[href*="/playables"]'
        );
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
        ytd-guide-entry-renderer:has(a[href*="/playables"]),
        ytd-guide-entry-renderer:has(a[title*="Playables" i]),
        ytd-mini-guide-entry-renderer:has(a[href*="/playables"]),
        tp-yt-paper-item:has(a[href^="/shorts"]),
        tp-yt-paper-item:has(a[href*="/playables"]),
        ytd-rich-shelf-renderer:has(a[href*="/shorts"]),
        ytd-rich-shelf-renderer:has(a[href*="/playables"]),
        ytd-rich-shelf-renderer:has([title*="Playables" i]),
        ytd-rich-shelf-renderer:has([aria-label*="Playables" i]),
        ytd-reel-shelf-renderer,
        ytd-rich-section-renderer:has(a[href*="/shorts"]),
        ytd-rich-section-renderer:has(a[href*="/playables"]),
        ytd-rich-section-renderer:has([title*="Playables" i]),
        ytd-rich-section-renderer:has([aria-label*="Playables" i]),
        ytm-reel-shelf-renderer,
        ytm-shorts-lockup-view-model,
        ytm-shorts-lockup-view-model-v2,
        ytd-rich-item-renderer:has(a[href*="/shorts"]),
        ytd-rich-item-renderer:has(a[href*="/playables"]),
        yt-lockup-view-model:has(a[href*="/shorts"]),
        yt-lockup-view-model:has(a[href*="/playables"]),
        grid-shelf-view-model:has(a[href*="/shorts"]),
        grid-shelf-view-model:has(a[href*="/playables"]),
        grid-shelf-view-model:has([title*="Playables" i]),
        grid-shelf-view-model:has([aria-label*="Playables" i]),
        yt-playable-game-renderer,
        ytd-game-card-renderer,
        ytd-playable-renderer,
        ytd-playables-shelf-renderer,
        yt-playables-shelf-renderer,
        yt-chip-cloud-chip-renderer:has(yt-formatted-string[title*="Playables" i]),
        yt-chip-cloud-chip-renderer:has([title*="Playables" i]),
        a[href^="/shorts"],
        a[href*="youtube.com/shorts/"],
        a[href^="/playables"],
        a[href*="youtube.com/playables"],
        [is-shorts],
        [is-playables],
        [is-playable] {
          display: none !important;
        }

        tp-yt-app-drawer#guide {
          touch-action: pan-y !important;
        }
        tp-yt-app-drawer#guide #contentContainer {
          touch-action: pan-y !important;
          overscroll-behavior: contain !important;
          overscroll-behavior-y: contain !important;
        }
        tp-yt-app-drawer#guide ytd-guide-renderer,
        tp-yt-app-drawer#guide #guide-wrapper,
        tp-yt-app-drawer#guide #guide-inner-content,
        tp-yt-app-drawer#guide #sections,
        tp-yt-app-drawer#guide #items {
          touch-action: pan-y !important;
          overscroll-behavior: contain !important;
          overscroll-behavior-y: contain !important;
          -webkit-overflow-scrolling: touch !important;
        }

        tp-yt-app-drawer#guide:not([opened]):not([opening]):not([peeking]) #scrim,
        tp-yt-app-drawer:not([opened]):not([opening]):not([peeking]) > #scrim {
          /* Issue #1: leftover drawer dimmer after close. */
          pointer-events: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
        }

        ytd-enforcement-message-view-model,
        ytd-ad-slot-renderer,
        ytd-display-ad-renderer,
        ytd-promoted-sparkles-web-renderer,
        .ytp-ad-overlay-container,
        .ytp-ad-module,
        .video-ads,
        #player-ads,
        #masthead-ad {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        ytd-app,
        ytm-app,
        ytd-page-manager,
        #content.ytd-app,
        #page-manager,
        ytd-watch-flexy,
        ytd-watch-flexy #columns,
        ytd-watch-flexy #primary,
        ytd-watch-flexy #secondary {
          box-sizing: border-box !important;
          max-width: 100% !important;
          min-width: 0 !important;
        }

        html,
        body,
        ytd-app,
        ytm-app,
        ytd-page-manager,
        #content.ytd-app,
        #page-manager {
          width: 100% !important;
          max-width: 100% !important;
          overflow-x: hidden !important;
          overscroll-behavior-x: none !important;
        }

        @supports (overflow: clip) {
          html,
          body,
          ytd-app,
          ytm-app,
          ytd-page-manager,
          #content.ytd-app,
          #page-manager {
            overflow-x: clip !important;
          }
        }

        @media (max-width: 700px) {
          ytd-browse,
          ytd-search,
          ytd-two-column-browse-results-renderer,
          ytd-two-column-search-results-renderer,
          #masthead-container,
          ytd-masthead,
          #columns,
          #primary,
          #secondary,
          #primary-inner,
          #secondary-inner {
            box-sizing: border-box !important;
            max-width: 100% !important;
            min-width: 0 !important;
          }

          ytd-browse[page-subtype='channels'],
          ytd-browse[page-subtype='channels'] #primary,
          ytd-browse[page-subtype='channels']
            ytd-two-column-browse-results-renderer,
          ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer,
          ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer #contents {
            box-sizing: border-box !important;
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
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
            max-width: 100% !important;
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
          width: 100% !important;
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

        /* Mirror page.js: leave native search alone; hide Ask/voice only. */
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

        /* Force-hide back button completely */
        #fyp-search-back-button,
        [data-fyp-mobile-search-open='true'] #fyp-search-back-button,
        ytd-masthead[data-fyp-mobile-search-open='true'] #fyp-search-back-button,
        body[data-fyp-search-active='true'] #fyp-search-back-button {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
          width: 0 !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        /* Force-hide hamburger menu & drawer during search */
        html[data-fyp-search-active='true'] #start,
        html[data-fyp-search-active='true'] #guide-button,
        html[data-fyp-search-active='true'] #guide-button-icon,
        html[data-fyp-search-active='true'] button[aria-label='Guide'],
        html[data-fyp-search-active='true'] ytd-masthead #guide-button,
        html[data-fyp-search-active='true'] ytd-masthead button[aria-label='Guide'],
        html[data-fyp-search-active='true'] tp-yt-app-drawer#guide,
        html[data-fyp-search-active='true'] #guide,
        body[data-fyp-search-active='true'] #start,
        body[data-fyp-search-active='true'] #guide-button,
        body[data-fyp-search-active='true'] #guide-button-icon,
        body[data-fyp-search-active='true'] button[aria-label='Guide'],
        body[data-fyp-search-active='true'] ytd-masthead #guide-button,
        body[data-fyp-search-active='true'] ytd-masthead button[aria-label='Guide'],
        body[data-fyp-search-active='true'] tp-yt-app-drawer#guide,
        body[data-fyp-search-active='true'] #guide,
        ytd-masthead[data-fyp-mobile-search-open='true'] #start,
        ytd-masthead[data-fyp-mobile-search-open='true'] #end,
        ytd-masthead[data-fyp-mobile-search-open='true'] #guide-button,
        ytd-masthead[data-fyp-mobile-search-open='true'] #guide-button-icon,
        ytd-masthead[data-fyp-mobile-search-open='true'] button[aria-label='Guide'],
        ytd-masthead[data-fyp-mobile-search-open='true'] yt-icon-button#guide-button,
        ytd-masthead[data-fyp-mobile-search-open='true'] ~ #guide,
        ytd-masthead[data-fyp-mobile-search-open='true'] ~ tp-yt-app-drawer#guide,
        ytd-masthead[data-fyp-mobile-search-open='true'] ~ ytd-mini-guide-renderer {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
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

  const __fyp_embedded_page_code = "/* Fyoutube — page context bundle */\n/* Generated by rebuild-extension.sh — edit youtube-mobile-background.user.js, then rebuild. */\n(() => {\r\n  'use strict';\r\n\r\n  document.documentElement?.setAttribute('data-fyp-page-ready', '3.1.4.g');\n\r\n  /*\r\n   * Pristine timers for FYP-owned work (background recovery, controls hold, scans).\r\n   * YouTube CPU Tamer patches window.* for YouTube only — see installYoutubeCpuTamer.\r\n   * On Orion iPhone, rAF does not run while the document is hidden; FYP must not\r\n   * route recoverPlayback through rAF-gated timers.\r\n   * 2.2.12: tamer is OFF by default — wrapping setTimeout/setInterval during\r\n   * timeupdate starved caption painting and slowed player init on Orion.\r\n   */\r\n  const setTimeout = window.setTimeout.bind(window);\r\n  const setInterval = window.setInterval.bind(window);\r\n  const clearTimeout = window.clearTimeout.bind(window);\r\n  const clearInterval = window.clearInterval.bind(window);\r\n  const requestAnimationFrame = window.requestAnimationFrame.bind(window);\r\n\r\n  const SCRIPT_ID = 'yt-mobile-orion-ext';\r\n  const STYLE_ID = `${SCRIPT_ID}-style`;\r\n  const NAV_ID = `${SCRIPT_ID}-nav`;\r\n  const WELCOME_ID = `${SCRIPT_ID}-welcome`;\r\n  const PLAYER_CONTROLS_TOOLBAR_ID = `${SCRIPT_ID}-controls-toolbar`;\r\n  const PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v311-reload-mount';\r\n  const WELCOME_KEY = `${SCRIPT_ID}:welcome-shown`;\r\n  const BACKEND_HOST = 'www.youtube.com';\r\n  const CHANNEL_ROOT_PATH_PATTERN =\r\n    /^\\/(?:@[^/]+|channel\\/[^/]+|c\\/[^/]+|user\\/[^/]+)\\/?$/;\r\n  const NAV_LAYOUT_VERSION = 'ext-v314-search-overlay';\n  const CPU_TAMER_FLAG = '__fypYoutubeCpuTamer';\r\n  /** Off by default on Orion — opt in via __fypEnableCpuTamer or localStorage. */\r\n  const CPU_TAMER_ENABLED_BY_DEFAULT = false;\r\n  const RYD_API_URL = 'https://returnyoutubedislikeapi.com';\r\n  const RYD_CACHE_TTL_MS = 5 * 60 * 1000;\r\n  const RYD_TEXT_ATTR = 'data-fyp-dislike-count';\r\n  const rydCache = new Map();\r\n  const rydPending = new Set();\r\n  let rydDislikeObserver = null;\r\n  let rydObservedHost = null;\r\n  let rydReapplyQueued = false;\r\n  const HISTORY_FEED_ATTR = 'data-fyp-feed';\r\n  const SIMPLE_SEARCH_ATTR = 'data-fyp-simple-search';\r\n  const MOBILE_SEARCH_OPEN_ATTR = 'data-fyp-mobile-search-open';\n  const SEARCH_OVERLAY_ID = 'fyp-search-overlay';\n  const SEARCH_OVERLAY_FORM_ID = 'fyp-search-overlay-form';\n  const SEARCH_OVERLAY_INPUT_ID = 'fyp-search-overlay-input';\n  const MOBILE_SEARCH_TRIGGER_SELECTOR = [\r\n    'ytd-masthead #search-button',\r\n    'ytd-masthead #search-button-narrow',\r\n    'ytd-masthead #search-icon-legacy',\r\n    'ytd-masthead button[aria-label=\"Search\"]',\r\n    'ytd-masthead [role=\"button\"][aria-label=\"Search\"]',\r\n    'ytd-masthead yt-icon-button[aria-label=\"Search\"]',\r\n    'ytd-masthead yt-searchbox',\r\n    'ytd-masthead ytd-searchbox',\r\n    'ytd-masthead .ytSearchboxComponentSearchButton',\r\n  ].join(',');\r\n  const PLAYER_CONTROLS_VISIBLE_MS = 10000;\r\n  const MENU_OPTION_TAP_SLOP_PX = 12;\r\n  const MEDIA_SESSION_OWNER_KEY = 'fyp:media-session-owner:v1';\r\n  const MEDIA_SESSION_TAB_ATTR = 'data-fyp-media-session-tab';\r\n  const MEDIA_SESSION_LEASE_MS = 15000;\r\n  const MEDIA_SESSION_REFRESH_MS = 5000;\r\n  const PAGE_SCAN_MIN_INTERVAL_MS = 1200;\r\n  const FALLBACK_QUALITY_LEVELS = Object.freeze([\r\n    'auto',\r\n    'hd1080',\r\n    'hd720',\r\n    'large',\r\n    'medium',\r\n    'small',\r\n    'tiny',\r\n  ]);\r\n  /*\r\n   * Orion's floating address bar overlays the bottom of the page (like Safari).\r\n   * Keep floating controls above that chrome so they stay tappable.\r\n   */\r\n  const ORION_NAV_GAP = '72px';\r\n  const FYP_OWNED_SELECTOR = [\r\n    `#${PLAYER_CONTROLS_TOOLBAR_ID}`,\r\n    '[data-fyp-player-action]',\r\n    '[data-fyp-player-option]',\r\n  ].join(',');\r\n\r\n  /*\r\n   * Search recovery: hide Ask/voice/AI clutter early, then let the stable FYP\n   * overlay own the search interaction instead of depending on YouTube's\n   * changing masthead input implementation.\n   */\r\n  const CRITICAL_STYLE_ID = `${SCRIPT_ID}-critical-style`;\r\n  function injectCriticalAskHideStyle() {\r\n    if (document.getElementById(CRITICAL_STYLE_ID)) return;\r\n    const style = document.createElement('style');\r\n    style.id = CRITICAL_STYLE_ID;\r\n    style.textContent = `\r\n      ytd-masthead #voice-search-button,\r\n      ytd-masthead button[aria-label*='Search with your voice' i],\r\n      ytd-masthead button[aria-label*='Voice search' i],\r\n      ytd-masthead [aria-label*='Ask YouTube' i],\r\n      ytd-masthead [aria-label*='Ask Gemini' i],\r\n      #voice-search-button,\r\n      button[aria-label*='Search with your voice' i],\r\n      button[aria-label*='Voice search' i],\r\n      [aria-label*='Ask YouTube' i],\r\n      [aria-label*='Ask Gemini' i] {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n      }\n\n      /* Search is a FYP-owned layer. Keep it independent from YouTube's\n       * changing masthead DOM, including the modern textarea searchbox. */\n      #${SEARCH_OVERLAY_ID} {\n        box-sizing: border-box !important;\n        position: fixed !important;\n        top: 0 !important;\n        right: 0 !important;\n        bottom: 0 !important;\n        left: 0 !important;\n        z-index: 2147483647 !important;\n        display: none !important;\n        align-items: flex-start !important;\n        justify-content: center !important;\n        width: 100vw !important;\n        height: 100vh !important;\n        padding: calc(env(safe-area-inset-top, 0px) + 12px) 12px 12px !important;\n        color: var(--yt-spec-text-primary, #0f0f0f) !important;\n        background: rgba(0, 0, 0, .38) !important;\n        backdrop-filter: blur(4px) !important;\n        -webkit-backdrop-filter: blur(4px) !important;\n        pointer-events: auto !important;\n      }\n\n      #${SEARCH_OVERLAY_ID}[data-open='true'] {\n        display: flex !important;\n      }\n\n      #${SEARCH_OVERLAY_ID} [data-fyp-search-dialog] {\n        box-sizing: border-box !important;\n        width: min(640px, 100%) !important;\n        max-width: 640px !important;\n        margin: 0 auto !important;\n        padding: 4px !important;\n        background: var(--yt-spec-base-background, #fff) !important;\n        border: 1px solid rgba(0, 0, 0, .16) !important;\n        border-radius: 28px !important;\n        box-shadow: 0 12px 36px rgba(0, 0, 0, .28) !important;\n        pointer-events: auto !important;\n      }\n\n      #${SEARCH_OVERLAY_ID} form {\n        box-sizing: border-box !important;\n        display: flex !important;\n        align-items: center !important;\n        width: 100% !important;\n        min-height: 48px !important;\n        margin: 0 !important;\n        padding: 0 6px 0 16px !important;\n      }\n\n      #${SEARCH_OVERLAY_INPUT_ID} {\n        box-sizing: border-box !important;\n        flex: 1 1 auto !important;\n        width: 100% !important;\n        min-width: 0 !important;\n        height: 42px !important;\n        margin: 0 !important;\n        padding: 0 8px 0 0 !important;\n        color: var(--yt-spec-text-primary, #0f0f0f) !important;\n        background: transparent !important;\n        border: 0 !important;\n        outline: 0 !important;\n        box-shadow: none !important;\n        font: 400 16px/42px Roboto, Arial, sans-serif !important;\n        -webkit-appearance: none !important;\n      }\n\n      #${SEARCH_OVERLAY_INPUT_ID}::placeholder {\n        color: var(--yt-spec-text-secondary, #606060) !important;\n        opacity: 1 !important;\n      }\n\n      #${SEARCH_OVERLAY_ID} button[type='submit'] {\n        box-sizing: border-box !important;\n        flex: 0 0 auto !important;\n        min-width: 76px !important;\n        height: 38px !important;\n        margin: 0 !important;\n        padding: 0 16px !important;\n        color: #fff !important;\n        background: #0f0f0f !important;\n        border: 0 !important;\n        border-radius: 20px !important;\n        cursor: pointer !important;\n        font: 600 14px/38px Roboto, Arial, sans-serif !important;\n        touch-action: manipulation !important;\n      }\n\n      html[dark] #${SEARCH_OVERLAY_ID} [data-fyp-search-dialog],\n      html[dark-theme] #${SEARCH_OVERLAY_ID} [data-fyp-search-dialog],\n      ytd-app[dark] #${SEARCH_OVERLAY_ID} [data-fyp-search-dialog] {\n        color: #f1f1f1 !important;\n        background: #212121 !important;\n        border-color: rgba(255, 255, 255, .22) !important;\n        box-shadow: 0 12px 36px rgba(0, 0, 0, .58) !important;\n      }\n\n      html[dark] #${SEARCH_OVERLAY_INPUT_ID},\n      html[dark-theme] #${SEARCH_OVERLAY_INPUT_ID},\n      ytd-app[dark] #${SEARCH_OVERLAY_INPUT_ID} {\n        color: #fff !important;\n      }\n\n      html[dark] #${SEARCH_OVERLAY_INPUT_ID}::placeholder,\n      html[dark-theme] #${SEARCH_OVERLAY_INPUT_ID}::placeholder,\n      ytd-app[dark] #${SEARCH_OVERLAY_INPUT_ID}::placeholder {\n        color: #aaa !important;\n      }\n\n      html[data-fyp-search-active='true'] ytd-masthead #center,\n      html[data-fyp-search-active='true'] ytd-masthead #end {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n      }\n    `;\n    const host = document.documentElement || document.head;\r\n    if (host) host.appendChild(style);\r\n  }\r\n  injectCriticalAskHideStyle();\r\n\r\n  /*\r\n   * YouTube CPU Tamer by AnimationFrame — adapted for FYP page-world on Orion iOS.\r\n   * Original: CY Fung, MIT — https://greasyfork.org/en/scripts/431573\r\n   * Requires GPU acceleration. Fail soft (skip) if WebGL or clean timers unavailable.\r\n   * Patches window timers only; FYP locals above stay pristine for background audio.\r\n   */\r\n  function shouldInstallYoutubeCpuTamer(win = window) {\r\n    try {\r\n      if (win.__fypEnableCpuTamer === true) return true;\r\n      if (win.__fypEnableCpuTamer === false) return false;\r\n      const stored = win.localStorage?.getItem('fypEnableCpuTamer');\r\n      if (stored === '1' || stored === 'true') return true;\r\n      if (stored === '0' || stored === 'false') return false;\r\n    } catch {\r\n      // localStorage may be blocked in some embeds.\r\n    }\r\n    return CPU_TAMER_ENABLED_BY_DEFAULT;\r\n  }\r\n\r\n  function installYoutubeCpuTamer(win = window) {\r\n    try {\r\n      if (win[CPU_TAMER_FLAG]) return;\r\n      win[CPU_TAMER_FLAG] = true;\r\n    } catch {\r\n      return;\r\n    }\r\n\r\n    const isGPUAccelerationAvailable = (() => {\r\n      try {\r\n        const canvas = document.createElement('canvas');\r\n        return !!(\r\n          canvas.getContext('webgl') || canvas.getContext('experimental-webgl')\r\n        );\r\n      } catch {\r\n        return false;\r\n      }\r\n    })();\r\n\r\n    if (!isGPUAccelerationAvailable) {\r\n      try {\r\n        delete win[CPU_TAMER_FLAG];\r\n      } catch {\r\n        win[CPU_TAMER_FLAG] = false;\r\n      }\r\n      return;\r\n    }\r\n\r\n    /** @type {globalThis.PromiseConstructor} */\r\n    const PromiseCtor = (async () => {})().constructor;\r\n    const PromiseExternal = ((resolve_, reject_) => {\r\n      const h = (resolve, reject) => {\r\n        resolve_ = resolve;\r\n        reject_ = reject;\r\n      };\r\n      return class PromiseExternal extends PromiseCtor {\r\n        constructor(cb = h) {\r\n          super(cb);\r\n          if (cb === h) {\r\n            this.resolve = resolve_;\r\n            this.reject = reject_;\r\n          }\r\n        }\r\n      };\r\n    })();\r\n\r\n    const timeupdateDT = (() => {\r\n      win.__fypCpuTamerTimeupdate__ = 1;\r\n      document.addEventListener(\r\n        'timeupdate',\r\n        () => {\r\n          win.__fypCpuTamerTimeupdate__ = Date.now();\r\n        },\r\n        true\r\n      );\r\n      let kz = -1;\r\n      try {\r\n        kz = win.top.__fypCpuTamerTimeupdate__;\r\n      } catch {\r\n        // Cross-origin top frame.\r\n      }\r\n      return kz >= 1\r\n        ? () => win.top.__fypCpuTamerTimeupdate__\r\n        : () => win.__fypCpuTamerTimeupdate__;\r\n    })();\r\n\r\n    const cleanContext = async (targetWin) => {\r\n      const waitFn = requestAnimationFrame;\r\n      try {\r\n        let mx = 16;\r\n        const frameId = 'fyp-vanillajs-iframe-v1';\r\n        let frame = document.getElementById(frameId);\r\n        let removeIframeFn = null;\r\n        if (!frame) {\r\n          frame = document.createElement('iframe');\r\n          frame.id = frameId;\r\n          // Upstream skips blob URL when `kagi` is defined (Orion/Kagi) or non-WebKit.\r\n          const blobURL =\r\n            typeof webkitCancelAnimationFrame === 'function' &&\r\n            typeof kagi === 'undefined'\r\n              ? (frame.src = URL.createObjectURL(\r\n                  new Blob([], { type: 'text/html' })\r\n                ))\r\n              : null;\r\n          frame.sandbox = 'allow-same-origin';\r\n          let noscriptHost = document.createElement('noscript');\r\n          noscriptHost.appendChild(frame);\r\n          while (!document.documentElement && mx-- > 0) {\r\n            await new PromiseCtor(waitFn);\r\n          }\r\n          const root = document.documentElement;\r\n          if (!root) return null;\r\n          root.appendChild(noscriptHost);\r\n          if (blobURL) {\r\n            PromiseCtor.resolve().then(() => URL.revokeObjectURL(blobURL));\r\n          }\r\n\r\n          removeIframeFn = (nativeSetTimeout) => {\r\n            const removeIframeOnDocumentReady = (e) => {\r\n              e &&\r\n                targetWin.removeEventListener(\r\n                  'DOMContentLoaded',\r\n                  removeIframeOnDocumentReady,\r\n                  false\r\n                );\r\n              e = noscriptHost;\r\n              noscriptHost = targetWin = removeIframeFn = null;\r\n              nativeSetTimeout ? nativeSetTimeout(() => e.remove(), 200) : e.remove();\r\n            };\r\n            if (!nativeSetTimeout || document.readyState !== 'loading') {\r\n              removeIframeOnDocumentReady();\r\n            } else {\r\n              targetWin.addEventListener(\r\n                'DOMContentLoaded',\r\n                removeIframeOnDocumentReady,\r\n                false\r\n              );\r\n            }\r\n          };\r\n        }\r\n        while (!frame.contentWindow && mx-- > 0) {\r\n          await new PromiseCtor(waitFn);\r\n        }\r\n        const fc = frame.contentWindow;\r\n        if (!fc) return null;\r\n        try {\r\n          const {\r\n            requestAnimationFrame: raf,\r\n            setInterval: si,\r\n            setTimeout: st,\r\n            clearInterval: ci,\r\n            clearTimeout: ct,\r\n          } = fc;\r\n          const res = {\r\n            requestAnimationFrame: raf,\r\n            setInterval: si,\r\n            setTimeout: st,\r\n            clearInterval: ci,\r\n            clearTimeout: ct,\r\n          };\r\n          for (const k of Object.keys(res)) {\r\n            res[k] = res[k].bind(targetWin);\r\n          }\r\n          if (removeIframeFn) {\r\n            PromiseCtor.resolve(res.setTimeout).then(removeIframeFn);\r\n          }\r\n          return res;\r\n        } catch {\r\n          if (removeIframeFn) removeIframeFn();\r\n          return null;\r\n        }\r\n      } catch (e) {\r\n        console.warn('[FYP] CPU tamer cleanContext failed', e);\r\n        return null;\r\n      }\r\n    };\r\n\r\n    cleanContext(win).then((ctx) => {\r\n      if (!ctx) {\r\n        try {\r\n          delete win[CPU_TAMER_FLAG];\r\n        } catch {\r\n          win[CPU_TAMER_FLAG] = false;\r\n        }\r\n        return;\r\n      }\r\n\r\n      const {\r\n        requestAnimationFrame: pristineRAF,\r\n        setTimeout: pristineSetTimeout,\r\n        setInterval: pristineSetInterval,\r\n        clearTimeout: pristineClearTimeout,\r\n        clearInterval: pristineClearInterval,\r\n      } = ctx;\r\n\r\n      let afInterupter = null;\r\n\r\n      const getRAFHelper = () => {\r\n        const asc = document.createElement('a-f');\r\n        if (!('onanimationiteration' in asc)) {\r\n          return (resolve) => pristineRAF((afInterupter = resolve));\r\n        }\r\n        asc.id = 'a-f';\r\n        let qr = null;\r\n        asc.onanimationiteration = function () {\r\n          if (qr !== null) qr = (qr(), null);\r\n        };\r\n        if (!document.getElementById('fyp-afscript')) {\r\n          const style = document.createElement('style');\r\n          style.id = 'fyp-afscript';\r\n          style.textContent = `\r\n            @keyframes fypAF1 {\r\n              0% { order: 0; }\r\n              100% { order: 1; }\r\n            }\r\n            #a-f[id] {\r\n              visibility: collapse !important;\r\n              position: fixed !important;\r\n              display: block !important;\r\n              top: -100px !important;\r\n              left: -100px !important;\r\n              margin: 0 !important;\r\n              padding: 0 !important;\r\n              outline: 0 !important;\r\n              border: 0 !important;\r\n              z-index: -1 !important;\r\n              width: 0px !important;\r\n              height: 0px !important;\r\n              contain: strict !important;\r\n              pointer-events: none !important;\r\n              animation: 1ms steps(2, jump-none) 0ms infinite alternate forwards running fypAF1 !important;\r\n            }\r\n          `;\r\n          (document.head || document.documentElement).appendChild(style);\r\n        }\r\n        document.documentElement.insertBefore(\r\n          asc,\r\n          document.documentElement.firstChild\r\n        );\r\n        return (resolve) => (qr = afInterupter = resolve);\r\n      };\r\n\r\n      const rafPN = getRAFHelper();\r\n\r\n      (() => {\r\n        let afPromiseP;\r\n        let afPromiseQ;\r\n        afPromiseP = afPromiseQ = { resolved: true };\r\n        let afix = 0;\r\n        const afResolve = async (rX) => {\r\n          await new PromiseCtor(rafPN);\r\n          rX.resolved = true;\r\n          const t = (afix = (afix & 1073741823) + 1);\r\n          return rX.resolve(t), t;\r\n        };\r\n        const eFunc = async () => {\r\n          const uP = !afPromiseP.resolved ? afPromiseP : null;\r\n          const uQ = !afPromiseQ.resolved ? afPromiseQ : null;\r\n          let t = 0;\r\n          if (uP && uQ) {\r\n            const t1 = await uP;\r\n            const t2 = await uQ;\r\n            t = ((t1 - t2) & 536870912) === 0 ? t1 : t2;\r\n          } else {\r\n            const vP = !uP ? (afPromiseP = new PromiseExternal()) : null;\r\n            const vQ = !uQ ? (afPromiseQ = new PromiseExternal()) : null;\r\n            if (uQ) await uQ;\r\n            else if (uP) await uP;\r\n            if (vP) t = await afResolve(vP);\r\n            if (vQ) t = await afResolve(vQ);\r\n          }\r\n          return t;\r\n        };\r\n        const inExec = new Set();\r\n        const wFunc = async (handler, wStore) => {\r\n          try {\r\n            const ct = Date.now();\r\n            if (ct - timeupdateDT() < 800 && ct - wStore.dt < 800) {\r\n              const cid = wStore.cid;\r\n              inExec.add(cid);\r\n              const t = await eFunc();\r\n              const didNotRemove = inExec.delete(cid);\r\n              if (!didNotRemove || t === wStore.lastExecution) return;\r\n              wStore.lastExecution = t;\r\n            }\r\n            wStore.dt = ct;\r\n            handler();\r\n          } catch (e) {\r\n            console.error(e);\r\n            throw e;\r\n          }\r\n        };\r\n        const sFunc = (propFunc) => {\r\n          return (func, ms = 0, ...args) => {\r\n            if (typeof func === 'function') {\r\n              const wStore = { dt: Date.now() };\r\n              return (wStore.cid = propFunc(\r\n                wFunc,\r\n                ms,\r\n                args.length > 0 ? func.bind(null, ...args) : func,\r\n                wStore\r\n              ));\r\n            }\r\n            return propFunc(func, ms, ...args);\r\n          };\r\n        };\r\n        win.setTimeout = sFunc(pristineSetTimeout);\r\n        win.setInterval = sFunc(pristineSetInterval);\r\n\r\n        const dFunc = (propFunc) => {\r\n          return (cid) => {\r\n            if (cid) inExec.delete(cid) || propFunc(cid);\r\n          };\r\n        };\r\n\r\n        win.clearTimeout = dFunc(pristineClearTimeout);\r\n        win.clearInterval = dFunc(pristineClearInterval);\r\n\r\n        try {\r\n          win.setTimeout.toString = pristineSetTimeout.toString.bind(\r\n            pristineSetTimeout\r\n          );\r\n          win.setInterval.toString = pristineSetInterval.toString.bind(\r\n            pristineSetInterval\r\n          );\r\n          win.clearTimeout.toString = pristineClearTimeout.toString.bind(\r\n            pristineClearTimeout\r\n          );\r\n          win.clearInterval.toString = pristineClearInterval.toString.bind(\r\n            pristineClearInterval\r\n          );\r\n        } catch (e) {\r\n          console.warn(e);\r\n        }\r\n      })();\r\n\r\n      let mInterupter = null;\r\n      pristineSetInterval(() => {\r\n        if (mInterupter === afInterupter) {\r\n          if (mInterupter !== null) {\r\n            afInterupter = mInterupter = (mInterupter(), null);\r\n          }\r\n        } else {\r\n          mInterupter = afInterupter;\r\n        }\r\n      }, 125);\r\n\r\n      try {\r\n        document.documentElement?.setAttribute('data-fyp-cpu-tamer', '1');\r\n      } catch {\r\n        // Attribute is diagnostics-only.\r\n      }\r\n    });\r\n  }\r\n\r\n  if (shouldInstallYoutubeCpuTamer(window)) {\r\n    installYoutubeCpuTamer(window);\r\n  } else {\r\n    try {\r\n      document.documentElement?.setAttribute('data-fyp-cpu-tamer', '0');\r\n    } catch {\r\n      // Attribute is diagnostics-only.\r\n    }\r\n  }\r\n\r\n  let playerControlsHideTimer = null;\r\n  const selectedCaptionTrackByVideo = new WeakMap();\r\n  const captionDedupeReadyAtByVideo = new WeakMap();\r\n  const CAPTION_DEDUPE_DELAY_MS = 450;\r\n  const selectedQualityByVideo = new WeakMap();\r\n  let ignorePlayerControlActionsUntil = 0;\r\n  let pendingMenuOptionGesture = null;\r\n  let lastMediaSessionMetadataKey = '';\r\n  let mediaSessionHandlersInstalled = false;\r\n  let lastMediaSessionHandlerInstallAt = 0;\r\n  let mediaSessionStorageFailed = false;\r\n  let mediaSessionLocalOwner = false;\r\n  function channelVideosUrl(input) {\r\n    let target;\r\n    try {\r\n      target = new URL(input, location.href);\r\n    } catch {\r\n      return null;\r\n    }\r\n    if (\r\n      !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(\r\n        target.hostname\r\n      ) ||\r\n      !CHANNEL_ROOT_PATH_PATTERN.test(target.pathname)\r\n    ) {\r\n      return null;\r\n    }\r\n    target.protocol = 'https:';\r\n    target.hostname = BACKEND_HOST;\r\n    target.port = '';\r\n    target.pathname = `${target.pathname.replace(/\\/+$/, '')}/videos`;\r\n    target.searchParams.set('app', 'desktop');\r\n    target.searchParams.set('persist_app', '1');\r\n    return target;\r\n  }\r\n\r\n  function redirectChannelRootToVideos() {\r\n    const target = channelVideosUrl(location.href);\r\n    if (!target || target.href === location.href) return false;\r\n    location.replace(target.href);\r\n    return true;\r\n  }\r\n\r\n  function redirectChannelLinkToVideos(event) {\r\n    if (\r\n      event.defaultPrevented ||\r\n      event.button > 0 ||\r\n      event.metaKey ||\r\n      event.ctrlKey ||\r\n      event.shiftKey ||\r\n      event.altKey\r\n    ) {\r\n      return;\r\n    }\r\n    const link = event.target?.closest?.('a[href]');\r\n    const target = channelVideosUrl(link?.href || link?.getAttribute('href'));\r\n    if (!target) return;\r\n    event.preventDefault();\r\n    event.stopImmediatePropagation();\r\n    location.assign(target.href);\r\n  }\r\n  /*\r\n   * Normalize every normal and short YouTube link onto the desktop host.\r\n   * Orion can then use the full desktop player underneath the mobile-only UI\r\n   * provided by this script.\r\n   */\r\n  if (location.hostname === 'youtu.be') {\r\n    const videoId = location.pathname.split('/').filter(Boolean)[0];\r\n    if (videoId) {\r\n      const target = new URL(`https://${BACKEND_HOST}/watch`);\r\n      target.searchParams.set('v', videoId);\r\n      for (const [key, value] of new URL(location.href).searchParams) {\r\n        target.searchParams.set(key, value);\r\n      }\r\n      target.searchParams.set('app', 'desktop');\r\n      target.searchParams.set('persist_app', '1');\r\n      target.hash = location.hash;\r\n      location.replace(target.href);\r\n      return;\r\n    }\r\n  }\r\n\r\n  if (location.hostname !== BACKEND_HOST) {\r\n    const target = new URL(location.href);\r\n    target.protocol = 'https:';\r\n    target.hostname = BACKEND_HOST;\r\n    target.port = '';\r\n    target.searchParams.set('app', 'desktop');\r\n    target.searchParams.set('persist_app', '1');\r\n    location.replace(target.href);\r\n    return;\r\n  }\r\n\r\n  if (redirectChannelRootToVideos()) return;\r\n\r\n  // Never land on Shorts or Playables (mini-games) — send those URLs to Home.\r\n  if (\r\n    location.pathname.startsWith('/shorts') ||\r\n    location.pathname.startsWith('/playables')\r\n  ) {\r\n    location.replace(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);\r\n    return;\r\n  }\r\n\r\n  /*\r\n   * Built-in YouTube ad blocking so uBlock Origin is not required.\r\n   * YouTube network/player pruning is adapted from Universal Ad Blocker Pro\r\n   * by Gorstak (Goran Štambuk), MIT:\r\n   * https://greasyfork.org/en/scripts/561518-universal-ad-blocker-pro\r\n   * Other-site blockers from that script are not included.\r\n   */\r\n  const AD_RESPONSE_ARRAY_KEYS = new Set(['adPlacements', 'adSlots', 'playerAds']);\r\n  const AD_RESPONSE_DELETE_KEYS = new Set([\r\n    'adBreakHeartbeatParams',\r\n    'ad3Module',\r\n    'adSafetyReason',\r\n  ]);\r\n  const AD_JSON_HINT =\r\n    /\"ad(?:Placements|Slots|BreakHeartbeatParams|3Module|SafetyReason)\"|\"playerAds\"/;\r\n  const BLOCKED_AD_HOST_SNIPPETS = [\r\n    'doubleclick.net',\r\n    'googleadservices.com',\r\n    'googlesyndication.com',\r\n    'adservice.google.com',\r\n    'googleads.',\r\n    'pagead2.',\r\n  ];\r\n  const BLOCKED_AD_PATH_SNIPPETS = [\r\n    '/pagead/',\r\n    '/api/stats/ads',\r\n    '/api/stats/atr',\r\n    '/ptracking',\r\n    '/get_midroll',\r\n    '/ad_break',\r\n    '/pcs/activeview',\r\n  ];\r\n  const MAX_AD_SEEK_DURATION_S = 90;\r\n  const AD_PLAYER_SELECTOR =\r\n    '.html5-video-player.ad-showing, .html5-video-player.ad-interrupting';\r\n  const AD_PLAYER_UI_SELECTOR = [\r\n    '.ytp-ad-player-overlay',\r\n    '.ytp-ad-text',\r\n    '.ytp-ad-preview-container',\r\n    '.ytp-ad-skip-button',\r\n    '.ytp-skip-ad-button',\r\n    '.video-ads',\r\n    '[class*=\"ytp-skip-ad\"]',\r\n  ].join(',');\r\n\r\n  function pruneAdsFromPlayerResponse(value, seen = new WeakSet()) {\r\n    if (!value || typeof value !== 'object' || seen.has(value)) return value;\r\n    seen.add(value);\r\n\r\n    if (Array.isArray(value)) {\r\n      value.forEach((item) => pruneAdsFromPlayerResponse(item, seen));\r\n      return value;\r\n    }\r\n\r\n    for (const key of Object.keys(value)) {\r\n      if (AD_RESPONSE_ARRAY_KEYS.has(key)) {\r\n        value[key] = [];\r\n        continue;\r\n      }\r\n      if (AD_RESPONSE_DELETE_KEYS.has(key)) {\r\n        delete value[key];\r\n        continue;\r\n      }\r\n      pruneAdsFromPlayerResponse(value[key], seen);\r\n    }\r\n\r\n    if (value.playerConfig && typeof value.playerConfig === 'object') {\r\n      if ('adPlacementConfig' in value.playerConfig) {\r\n        value.playerConfig.adPlacementConfig = {};\r\n      }\r\n      if ('adSignalsConfig' in value.playerConfig) {\r\n        value.playerConfig.adSignalsConfig = {};\r\n      }\r\n    }\r\n    return value;\r\n  }\r\n\r\n  function sanitizePlayerResponseText(text) {\r\n    if (typeof text !== 'string' || !AD_JSON_HINT.test(text)) return text;\r\n    try {\r\n      return JSON.stringify(pruneAdsFromPlayerResponse(JSON.parse(text)));\r\n    } catch {\r\n      return text;\r\n    }\r\n  }\r\n\r\n  function requestUrl(input) {\r\n    if (typeof input === 'string') return input;\r\n    if (input instanceof URL) return String(input);\r\n    if (input && typeof input.url === 'string') return input.url;\r\n    return '';\r\n  }\r\n\r\n  function isPlayerResponseUrl(input) {\r\n    const url = requestUrl(input);\r\n    return (\r\n      url.includes('/youtubei/v1/player') ||\r\n      url.includes('/youtubei/v1/get_watch') ||\r\n      /\\/playlist(?:\\?|$)/.test(url)\r\n    );\r\n  }\r\n\r\n  function isBlockedAdRequest(input) {\r\n    const url = requestUrl(input).toLowerCase();\r\n    if (!url) return false;\r\n    if (url.includes('googlevideo.com') && !url.includes('/ptracking')) {\r\n      return false;\r\n    }\r\n    return (\r\n      BLOCKED_AD_HOST_SNIPPETS.some((host) => url.includes(host)) ||\r\n      BLOCKED_AD_PATH_SNIPPETS.some((path) => url.includes(path))\r\n    );\r\n  }\r\n\r\n  function blockedAdJsonResponse() {\r\n    return new Response('{}', {\r\n      status: 200,\r\n      statusText: 'OK',\r\n      headers: { 'Content-Type': 'application/json' },\r\n    });\r\n  }\r\n\r\n  function installJsonAdPrune() {\r\n    const nativeJsonParse = JSON.parse.bind(JSON);\r\n    JSON.parse = function fypJsonParse(text, reviver) {\r\n      const parsed = nativeJsonParse(text, reviver);\r\n      if (typeof text === 'string' && AD_JSON_HINT.test(text)) {\r\n        try {\r\n          pruneAdsFromPlayerResponse(parsed);\r\n        } catch {\r\n          // Leave YouTube's object intact if pruning throws.\r\n        }\r\n      }\r\n      return parsed;\r\n    };\r\n  }\r\n\r\n  function bindPrunedWindowJson(propertyName) {\r\n    let current = pruneAdsFromPlayerResponse(window[propertyName]);\r\n    try {\r\n      Object.defineProperty(window, propertyName, {\r\n        configurable: true,\r\n        get: () => current,\r\n        set: (value) => {\r\n          current = pruneAdsFromPlayerResponse(value);\r\n        },\r\n      });\r\n    } catch {\r\n      if (window[propertyName]) pruneAdsFromPlayerResponse(window[propertyName]);\r\n    }\r\n  }\r\n\r\n  function installPlayerResponseAdFilter() {\r\n    const installFlag = '__vmYtPlayerResponseFilterV3';\r\n    if (window[installFlag]) return;\r\n    Object.defineProperty(window, installFlag, {\r\n      configurable: false,\r\n      value: true,\r\n    });\r\n\r\n    bindPrunedWindowJson('ytInitialPlayerResponse');\r\n    bindPrunedWindowJson('ytInitialData');\r\n    installJsonAdPrune();\r\n\r\n    const nativeFetch = window.fetch;\r\n    if (typeof nativeFetch === 'function') {\r\n      window.fetch = async function filteredYouTubeFetch(input, init) {\r\n        if (isBlockedAdRequest(input)) return blockedAdJsonResponse();\r\n        const response = await nativeFetch.call(this, input, init);\r\n        if (isBlockedAdRequest(response.url || input)) return blockedAdJsonResponse();\r\n        if (!isPlayerResponseUrl(response.url || input)) return response;\r\n        try {\r\n          const originalText = await response.clone().text();\r\n          const filteredText = sanitizePlayerResponseText(originalText);\r\n          if (filteredText === originalText) return response;\r\n\r\n          const filteredResponse = new Response(filteredText, {\r\n            status: response.status,\r\n            statusText: response.statusText,\r\n            headers: response.headers,\r\n          });\r\n          for (const property of ['url', 'redirected', 'type']) {\r\n            try {\r\n              Object.defineProperty(filteredResponse, property, {\r\n                configurable: true,\r\n                value: response[property],\r\n              });\r\n            } catch {\r\n              // These metadata properties are optional to the player.\r\n            }\r\n          }\r\n          return filteredResponse;\r\n        } catch {\r\n          return response;\r\n        }\r\n      };\r\n    }\r\n\r\n    if (typeof navigator.sendBeacon === 'function') {\r\n      const nativeBeacon = navigator.sendBeacon.bind(navigator);\r\n      navigator.sendBeacon = function fypSendBeacon(url, data) {\r\n        if (isBlockedAdRequest(url)) return true;\r\n        return nativeBeacon(url, data);\r\n      };\r\n    }\r\n\r\n    const NativeXHR = window.XMLHttpRequest;\r\n    if (typeof NativeXHR !== 'function') return;\r\n    const xhrUrls = new WeakMap();\r\n    const blockedXhr = new WeakSet();\r\n    const nativeOpen = NativeXHR.prototype.open;\r\n    NativeXHR.prototype.open = function filteredYouTubeOpen(method, url) {\r\n      const href = requestUrl(url);\r\n      xhrUrls.set(this, href);\r\n      if (isBlockedAdRequest(href)) {\r\n        blockedXhr.add(this);\r\n        return nativeOpen.call(this, method, 'data:,');\r\n      }\r\n      blockedXhr.delete(this);\r\n      return nativeOpen.apply(this, arguments);\r\n    };\r\n\r\n    const responseTextDescriptor = Object.getOwnPropertyDescriptor(\r\n      NativeXHR.prototype,\r\n      'responseText'\r\n    );\r\n    const responseDescriptor = Object.getOwnPropertyDescriptor(\r\n      NativeXHR.prototype,\r\n      'response'\r\n    );\r\n\r\n    if (responseTextDescriptor?.get && responseTextDescriptor.configurable) {\r\n      Object.defineProperty(NativeXHR.prototype, 'responseText', {\r\n        ...responseTextDescriptor,\r\n        get() {\r\n          if (blockedXhr.has(this)) return '{}';\r\n          const text = responseTextDescriptor.get.call(this);\r\n          return isPlayerResponseUrl(xhrUrls.get(this))\r\n            ? sanitizePlayerResponseText(text)\r\n            : text;\r\n        },\r\n      });\r\n    }\r\n\r\n    if (responseDescriptor?.get && responseDescriptor.configurable) {\r\n      Object.defineProperty(NativeXHR.prototype, 'response', {\r\n        ...responseDescriptor,\r\n        get() {\r\n          if (blockedXhr.has(this)) return {};\r\n          const response = responseDescriptor.get.call(this);\r\n          if (!isPlayerResponseUrl(xhrUrls.get(this))) return response;\r\n          if (typeof response === 'string') return sanitizePlayerResponseText(response);\r\n          return pruneAdsFromPlayerResponse(response);\r\n        },\r\n      });\r\n    }\r\n  }\r\n\r\n  installPlayerResponseAdFilter();\r\n\r\n  const nativeDocumentAddEventListener = document.addEventListener.bind(document);\r\n  const nativeWindowAddEventListener = window.addEventListener.bind(window);\r\n\r\n  function inheritedDescriptor(object, property) {\r\n    let current = object;\r\n    while (current) {\r\n      const descriptor = Object.getOwnPropertyDescriptor(current, property);\r\n      if (descriptor) return descriptor;\r\n      current = Object.getPrototypeOf(current);\r\n    }\r\n    return null;\r\n  }\r\n\r\n  const nativeHiddenDescriptor = inheritedDescriptor(document, 'hidden');\r\n  const nativeVisibilityDescriptor = inheritedDescriptor(document, 'visibilityState');\r\n\r\n  function readNativeDescriptor(descriptor, fallback) {\r\n    try {\r\n      return descriptor?.get ? descriptor.get.call(document) : fallback;\r\n    } catch {\r\n      return fallback;\r\n    }\r\n  }\r\n\r\n  function isReallyHidden() {\r\n    const nativeHidden = readNativeDescriptor(nativeHiddenDescriptor, null);\r\n    if (typeof nativeHidden === 'boolean') return nativeHidden;\r\n    return readNativeDescriptor(nativeVisibilityDescriptor, 'visible') === 'hidden';\r\n  }\r\n\r\n  /*\r\n   * YouTube normally receives visibility events when iOS backgrounds the tab.\r\n   * Reporting \"visible\" prevents its page code from treating that transition\r\n   * as a reason to stop playback. The native values above remain available to\r\n   * this script so it can still request PiP and recover playback.\r\n   */\r\n  function spoofDocumentProperty(property, value) {\r\n    try {\r\n      Object.defineProperty(document, property, {\r\n        configurable: true,\r\n        enumerable: true,\r\n        get: () => value,\r\n      });\r\n    } catch {\r\n      // Some WebKit builds make these properties non-configurable.\r\n    }\r\n  }\r\n\r\n  spoofDocumentProperty('hidden', false);\r\n  spoofDocumentProperty('webkitHidden', false);\r\n  spoofDocumentProperty('visibilityState', 'visible');\r\n  spoofDocumentProperty('webkitVisibilityState', 'visible');\r\n\r\n  const state = {\r\n    video: null,\r\n    wantsPlayback: false,\r\n    recoveryTimers: new Set(),\r\n    userPauseUntil: 0,\r\n    fullscreenIntentUntil: 0,\r\n  };\r\n  const RESUME_STORAGE_KEY = 'fyp:resume:v1';\r\n  const resumeRestoreByVideoId = new Map();\r\n\r\n  const nativeMediaPause = HTMLMediaElement.prototype.pause;\r\n  HTMLMediaElement.prototype.pause = function guardedMediaPause() {\r\n    const isActiveVideo =\r\n      this === state.video || this.classList?.contains('html5-main-video');\r\n    const shouldKeepPlaying =\r\n      isActiveVideo &&\r\n      state.wantsPlayback &&\r\n      Date.now() > state.userPauseUntil &&\r\n      isReallyHidden() &&\r\n      !this.ended;\r\n    if (shouldKeepPlaying) return;\r\n    return nativeMediaPause.apply(this, arguments);\r\n  };\r\n\r\n  function safePlay(video = state.video) {\r\n    if (!video || video.ended || video.error) return;\r\n    const result = video.play();\r\n    if (result && typeof result.catch === 'function') {\r\n      result.catch(() => {});\r\n    }\r\n  }\r\n\r\n  function currentWatchVideoId() {\r\n    if (location.pathname !== '/watch') return '';\r\n    try {\r\n      return new URL(location.href).searchParams.get('v') || '';\r\n    } catch {\r\n      return '';\r\n    }\r\n  }\r\n\r\n  function getOrCreateMediaSessionTabId() {\r\n    const root = document.documentElement;\r\n    const existing = root?.getAttribute(MEDIA_SESSION_TAB_ATTR)?.trim();\r\n    if (existing) return existing;\r\n    const randomId =\r\n      typeof crypto?.randomUUID === 'function'\r\n        ? crypto.randomUUID()\r\n        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;\r\n    root?.setAttribute(MEDIA_SESSION_TAB_ATTR, randomId);\r\n    return randomId;\r\n  }\r\n\r\n  const mediaSessionTabId = getOrCreateMediaSessionTabId();\r\n\r\n  function readMediaSessionOwner() {\r\n    if (mediaSessionStorageFailed) return null;\r\n    try {\r\n      const raw = localStorage.getItem(MEDIA_SESSION_OWNER_KEY);\r\n      if (!raw) return null;\r\n      const owner = JSON.parse(raw);\r\n      if (\r\n        !owner ||\r\n        typeof owner.tabId !== 'string' ||\r\n        !Number.isFinite(owner.expiresAt)\r\n      ) {\r\n        return null;\r\n      }\r\n      return owner;\r\n    } catch {\r\n      mediaSessionStorageFailed = true;\r\n      return null;\r\n    }\r\n  }\r\n\r\n  function ownsMediaSession() {\r\n    if (mediaSessionStorageFailed) return mediaSessionLocalOwner;\r\n    const owner = readMediaSessionOwner();\r\n    return Boolean(\r\n      owner &&\r\n        owner.tabId === mediaSessionTabId &&\r\n        owner.expiresAt > Date.now()\r\n    );\r\n  }\r\n\r\n  function claimMediaSessionOwnership(video = state.video) {\r\n    if (\r\n      location.pathname !== '/watch' ||\r\n      !(video instanceof HTMLVideoElement) ||\r\n      video.ended\r\n    ) {\r\n      return false;\r\n    }\r\n    const currentOwner = readMediaSessionOwner();\r\n    if (\r\n      currentOwner &&\r\n      currentOwner.tabId !== mediaSessionTabId &&\r\n      currentOwner.expiresAt > Date.now() &&\r\n      isReallyHidden()\r\n    ) {\r\n      return false;\r\n    }\r\n    const now = Date.now();\r\n    const claim = {\r\n      tabId: mediaSessionTabId,\r\n      videoId: currentWatchVideoId(),\r\n      claimedAt: now,\r\n      expiresAt: now + MEDIA_SESSION_LEASE_MS,\r\n    };\r\n    try {\r\n      localStorage.setItem(MEDIA_SESSION_OWNER_KEY, JSON.stringify(claim));\r\n      mediaSessionLocalOwner = true;\r\n      return true;\r\n    } catch {\r\n      mediaSessionStorageFailed = true;\r\n      mediaSessionLocalOwner = true;\r\n      return true;\r\n    }\r\n  }\r\n\r\n  function renewMediaSessionOwnership(video = state.video) {\r\n    if (!ownsMediaSession()) return false;\r\n    return claimMediaSessionOwnership(video);\r\n  }\r\n\r\n  // Return YouTube Dislike integration (adapted from Anarios/return-youtube-dislike)\r\n  function findWatchButtonsRoot() {\r\n    const menuContainer = document.getElementById('menu-container');\r\n    if (menuContainer?.offsetParent === null) {\r\n      return (\r\n        document.querySelector('ytd-menu-renderer.ytd-watch-metadata > div') ||\r\n        document.querySelector('ytd-menu-renderer.ytd-video-primary-info-renderer > div')\r\n      );\r\n    }\r\n    return (\r\n      menuContainer?.querySelector('#top-level-buttons-computed') ||\r\n      document.querySelector('#top-level-buttons-computed')\r\n    );\r\n  }\r\n\r\n  function findWatchLikeHost() {\r\n    const root = findWatchButtonsRoot();\r\n    if (!(root instanceof Element)) return null;\r\n    return (\r\n      root.querySelector('#segmented-like-button') ||\r\n      root.querySelector('like-button-view-model') ||\r\n      root.querySelector('#like-button') ||\r\n      root.children?.[0] ||\r\n      null\r\n    );\r\n  }\r\n\r\n  function findWatchDislikeHost() {\r\n    const root = findWatchButtonsRoot();\r\n    if (!(root instanceof Element)) return null;\r\n    return (\r\n      root.querySelector('#segmented-dislike-button') ||\r\n      root.querySelector('dislike-button-view-model') ||\r\n      root.querySelector('#dislike-button') ||\r\n      root.children?.[1] ||\r\n      null\r\n    );\r\n  }\r\n\r\n  function updateWatchDislikeButtonShape(nativeButton) {\r\n    if (!(nativeButton instanceof HTMLElement)) return;\r\n    for (const className of [\r\n      'yt-spec-button-shape-next--icon-button',\r\n      'ytSpecButtonShapeNextIconButton',\r\n    ]) {\r\n      nativeButton.classList.remove(className);\r\n    }\r\n    for (const className of [\r\n      'yt-spec-button-shape-next--icon-leading',\r\n      'ytSpecButtonShapeNextIconLeading',\r\n    ]) {\r\n      nativeButton.classList.add(className);\r\n    }\r\n    nativeButton.style.width = 'auto';\r\n  }\r\n\r\n  function getWatchDislikeTextContainer(dislikeHost = findWatchDislikeHost()) {\r\n    if (!(dislikeHost instanceof Element)) return null;\r\n    const nativeButton = dislikeHost.querySelector('button');\r\n    let textNode = dislikeHost.querySelector(`[${RYD_TEXT_ATTR}]`);\r\n    if (!(textNode instanceof HTMLElement)) {\r\n      const selectors = [\r\n        '.yt-spec-button-shape-next__button-text-content',\r\n        '.ytSpecButtonShapeNextButtonTextContent',\r\n        '#text',\r\n        'yt-formatted-string',\r\n        'span[role=\"text\"]',\r\n      ];\r\n      for (const selector of selectors) {\r\n        const candidate = dislikeHost.querySelector(selector);\r\n        if (\r\n          candidate instanceof HTMLElement &&\r\n          candidate !== nativeButton &&\r\n          !candidate.closest('yt-icon, svg')\r\n        ) {\r\n          textNode = candidate;\r\n          break;\r\n        }\r\n      }\r\n    }\r\n    if (!(textNode instanceof HTMLElement)) {\r\n      if (!(nativeButton instanceof HTMLButtonElement)) return null;\r\n      const likeHost = findWatchLikeHost();\r\n      const template =\r\n        likeHost?.querySelector(\r\n          '.yt-spec-button-shape-next__button-text-content, .ytSpecButtonShapeNextButtonTextContent'\r\n        ) || null;\r\n      if (template instanceof HTMLElement) {\r\n        textNode = template.cloneNode(true);\r\n        const inner =\r\n          textNode.querySelector('span[role=\"text\"]') || textNode;\r\n        if (inner instanceof HTMLElement) inner.textContent = '';\r\n        nativeButton.appendChild(textNode);\r\n      } else {\r\n        textNode = document.createElement('span');\r\n        textNode.id = 'text';\r\n        textNode.setAttribute('role', 'text');\r\n        textNode.style.marginLeft = '6px';\r\n        nativeButton.appendChild(textNode);\r\n      }\r\n    }\r\n    if (!(textNode instanceof HTMLElement)) return null;\r\n    textNode.setAttribute(RYD_TEXT_ATTR, '1');\r\n    updateWatchDislikeButtonShape(nativeButton);\r\n    return textNode;\r\n  }\r\n\r\n  function formatDislikeCount(count) {\r\n    if (!Number.isFinite(count) || count < 0) return '';\r\n    try {\r\n      return new Intl.NumberFormat(undefined, {\r\n        notation: 'compact',\r\n        compactDisplay: 'short',\r\n        maximumFractionDigits: 1,\r\n      }).format(count);\r\n    } catch {\r\n      return String(Math.round(count));\r\n    }\r\n  }\r\n\r\n  function disconnectWatchDislikeObserver() {\r\n    rydDislikeObserver?.disconnect();\r\n    rydDislikeObserver = null;\r\n    rydObservedHost = null;\r\n  }\r\n\r\n  function queueStickyWatchDislikeReapply() {\r\n    if (rydReapplyQueued) return;\r\n    rydReapplyQueued = true;\r\n    setTimeout(() => {\r\n      rydReapplyQueued = false;\r\n      stickyReapplyWatchDislikeCount();\r\n    }, 40);\r\n  }\r\n\r\n  function ensureWatchDislikeObserver(dislikeHost) {\r\n    if (!(dislikeHost instanceof Element)) return;\r\n    if (rydObservedHost === dislikeHost && rydDislikeObserver) return;\r\n    disconnectWatchDislikeObserver();\r\n    rydObservedHost = dislikeHost;\r\n    rydDislikeObserver = new MutationObserver(() => {\r\n      queueStickyWatchDislikeReapply();\r\n    });\r\n    rydDislikeObserver.observe(dislikeHost, {\r\n      childList: true,\r\n      subtree: true,\r\n      characterData: true,\r\n      attributes: true,\r\n      attributeFilter: ['class', 'style'],\r\n    });\r\n  }\r\n\r\n  function stickyReapplyWatchDislikeCount() {\r\n    if (location.pathname !== '/watch') {\r\n      disconnectWatchDislikeObserver();\r\n      return;\r\n    }\r\n    const videoId = currentWatchVideoId();\r\n    if (!videoId) return;\r\n    const cache = rydCache.get(videoId);\r\n    if (!cache || !Number.isFinite(cache.dislikes)) return;\r\n    applyWatchDislikeCount(cache.dislikes);\r\n  }\r\n\r\n  function applyWatchDislikeCount(count) {\r\n    const text = formatDislikeCount(count);\r\n    if (!text) return false;\r\n    const dislikeHost = findWatchDislikeHost();\r\n    if (!(dislikeHost instanceof Element)) return false;\r\n    ensureWatchDislikeObserver(dislikeHost);\r\n    const textContainer = getWatchDislikeTextContainer(dislikeHost);\r\n    if (!(textContainer instanceof HTMLElement)) return false;\r\n    if (textContainer.textContent !== text) {\r\n      textContainer.textContent = text;\r\n    }\r\n    textContainer.setAttribute(RYD_TEXT_ATTR, '1');\r\n    updateWatchDislikeButtonShape(dislikeHost.querySelector('button'));\r\n    return true;\r\n  }\r\n\r\n  async function refreshWatchDislikeCount({ force = false } = {}) {\r\n    if (location.pathname !== '/watch') {\r\n      disconnectWatchDislikeObserver();\r\n      return;\r\n    }\r\n    const videoId = currentWatchVideoId();\r\n    if (!videoId) return;\r\n    const cache = rydCache.get(videoId);\r\n    if (\r\n      !force &&\r\n      cache &&\r\n      Date.now() - cache.at < RYD_CACHE_TTL_MS &&\r\n      Number.isFinite(cache.dislikes)\r\n    ) {\r\n      applyWatchDislikeCount(cache.dislikes);\r\n      return;\r\n    }\r\n    if (rydPending.has(videoId)) return;\r\n    rydPending.add(videoId);\r\n    try {\r\n      const response = await fetch(\r\n        `${RYD_API_URL}/votes?videoId=${encodeURIComponent(videoId)}`,\r\n        {\r\n          method: 'GET',\r\n        }\r\n      );\r\n      if (!response.ok) return;\r\n      const payload = await response.json();\r\n      const dislikes = Number(payload?.dislikes);\r\n      if (!Number.isFinite(dislikes)) return;\r\n      rydCache.set(videoId, { dislikes, at: Date.now() });\r\n      applyWatchDislikeCount(dislikes);\r\n    } catch {\r\n      // Keep native UI if API/network fails.\r\n    } finally {\r\n      rydPending.delete(videoId);\r\n    }\r\n  }\r\n\r\n  function readResumeStore() {\r\n    try {\r\n      const raw = localStorage.getItem(RESUME_STORAGE_KEY);\r\n      const parsed = raw ? JSON.parse(raw) : {};\r\n      return parsed && typeof parsed === 'object' ? parsed : {};\r\n    } catch {\r\n      return {};\r\n    }\r\n  }\r\n\r\n  function writeResumeStore(store) {\r\n    try {\r\n      localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(store));\r\n    } catch {\r\n      // Storage can fail in private mode or quota pressure.\r\n    }\r\n  }\r\n\r\n  function persistWatchResume(video = state.video) {\r\n    if (!(video instanceof HTMLVideoElement)) return;\r\n    const videoId = currentWatchVideoId();\r\n    if (!videoId || !Number.isFinite(video.currentTime)) return;\r\n    const current = Math.max(0, video.currentTime);\r\n    if (current < 2 || video.ended) return;\r\n    const duration = Number.isFinite(video.duration) ? video.duration : 0;\r\n    if (duration > 0 && current >= duration - 1) return;\r\n    const store = readResumeStore();\r\n    store[videoId] = {\r\n      t: Math.round(current),\r\n      at: Date.now(),\r\n    };\r\n    writeResumeStore(store);\r\n  }\r\n\r\n  function restoreWatchResume(video = state.video) {\r\n    if (!(video instanceof HTMLVideoElement)) return;\r\n    const videoId = currentWatchVideoId();\r\n    if (!videoId || resumeRestoreByVideoId.get(videoId)) return;\r\n    const store = readResumeStore();\r\n    const entry = store[videoId];\r\n    if (!entry || !Number.isFinite(entry.t)) return;\r\n    const target = Math.max(0, Number(entry.t) || 0);\r\n    if (target < 3) return;\r\n    const duration = Number.isFinite(video.duration)\r\n      ? video.duration\r\n      : Number.POSITIVE_INFINITY;\r\n    if (target >= duration - 2) return;\r\n    if (Number.isFinite(video.currentTime) && video.currentTime > 2) {\r\n      resumeRestoreByVideoId.set(videoId, true);\r\n      return;\r\n    }\r\n    try {\r\n      video.currentTime = target;\r\n      resumeRestoreByVideoId.set(videoId, true);\r\n    } catch {\r\n      // Seek can fail before metadata is available; loadedmetadata will retry.\r\n    }\r\n  }\r\n\r\n  function clearRecoveryTimers() {\r\n    for (const timer of state.recoveryTimers) clearTimeout(timer);\r\n    state.recoveryTimers.clear();\r\n  }\r\n\r\n  function configurePlaybackAudioSession() {\r\n    try {\r\n      if (navigator.audioSession) {\r\n        navigator.audioSession.type = 'playback';\r\n      }\r\n    } catch {\r\n      // AudioSession is an optional WebKit API.\r\n    }\r\n  }\r\n\r\n  function recoverPlayback(video = state.video) {\r\n    if (!video || !state.wantsPlayback || video.ended) return;\r\n    safePlay(video);\r\n    clearRecoveryTimers();\r\n    for (const delay of [80, 250, 750, 1500]) {\r\n      const timer = setTimeout(() => {\r\n        state.recoveryTimers.delete(timer);\r\n        if (state.wantsPlayback && isReallyHidden()) safePlay(video);\r\n      }, delay);\r\n      state.recoveryTimers.add(timer);\r\n    }\r\n  }\r\n\r\n  function onVideoPlay() {\r\n    state.wantsPlayback = true;\r\n    state.userPauseUntil = 0;\r\n    claimMediaSessionOwnership(state.video);\r\n    installMediaSessionHandlers({ force: true });\r\n    configurePlaybackAudioSession();\r\n    enforceInlinePlayback(state.video);\r\n    persistWatchResume(state.video);\r\n    updateMediaSessionMetadata();\r\n    syncCustomPlayerControls();\r\n  }\r\n\r\n  function onVideoPause() {\r\n    persistWatchResume(state.video);\r\n    if (Date.now() <= state.userPauseUntil || !state.wantsPlayback) {\r\n      state.wantsPlayback = false;\r\n      clearRecoveryTimers();\r\n      syncCustomPlayerControls();\r\n      return;\r\n    }\r\n    if (isReallyHidden() && state.wantsPlayback && !state.video?.ended) {\r\n      recoverPlayback();\r\n    } else if (!isReallyHidden()) {\r\n      // A pause while the page is visible is treated as an intentional pause.\r\n      state.wantsPlayback = false;\r\n      clearRecoveryTimers();\r\n    }\r\n    syncCustomPlayerControls();\r\n  }\r\n\r\n  function recordPlayerControlIntent(event) {\r\n    const target = event.target;\r\n    if (!(target instanceof Element)) return;\r\n    if (\r\n      target.closest(\r\n        `#movie_player, .html5-video-player, .html5-video-container, #${PLAYER_CONTROLS_TOOLBAR_ID}`\r\n      )\r\n    ) {\r\n      holdPlayerControlsVisible();\r\n    }\r\n    const control = target.closest([\r\n      '.ytp-play-button',\r\n      'button[aria-label^=\"Pause\"]',\r\n      'button[aria-label^=\"Play\"]',\r\n      'button[data-title-no-tooltip=\"Pause\"]',\r\n      'button[data-title-no-tooltip=\"Play\"]',\r\n    ].join(','));\r\n    if (!control) return;\r\n\r\n    const video = state.video || findVideo();\r\n    if (!video) return;\r\n    attachVideo(video);\r\n    if (video.paused || video.ended) {\r\n      state.wantsPlayback = true;\r\n      state.userPauseUntil = 0;\r\n    } else {\r\n      state.wantsPlayback = false;\r\n      state.userPauseUntil = Date.now() + 3000;\r\n      clearRecoveryTimers();\r\n    }\r\n  }\r\n\r\n  function holdPlayerControlsVisible() {\r\n    const player = document.querySelector(\r\n      '#movie_player, .html5-video-player'\r\n    );\r\n    if (!(player instanceof HTMLElement)) return;\r\n\r\n    player.dataset.fypControlsVisible = 'true';\r\n    if (playerControlsHideTimer) clearTimeout(playerControlsHideTimer);\r\n    playerControlsHideTimer = setTimeout(() => {\r\n      delete player.dataset.fypControlsVisible;\r\n      playerControlsHideTimer = null;\r\n    }, PLAYER_CONTROLS_VISIBLE_MS);\r\n  }\r\n\r\n  const PLAYER_CONTROL_ICONS = Object.freeze({\r\n    rewind: '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><polygon points=\"11 19 2 12 11 5 11 19\"></polygon><polygon points=\"22 19 13 12 22 5 22 19\"></polygon></svg>',\r\n    // YouTube-like filled triangle / bars (Material path), not Lucide stroke play/pause.\r\n    play: '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M8 5v14l11-7z\"></path></svg>',\r\n    pause: '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M6 4h4v16H6zm8 0h4v16h-4z\"></path></svg>',\r\n    forward: '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><polygon points=\"13 19 22 12 13 5 13 19\"></polygon><polygon points=\"2 19 11 12 2 5 2 19\"></polygon></svg>',\r\n    pip: '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8 3H5a2 2 0 0 0-2 2v3\"></path><path d=\"M16 3h3a2 2 0 0 1 2 2v3\"></path><path d=\"M8 21H5a2 2 0 0 1-2-2v-3\"></path><rect width=\"10\" height=\"7\" x=\"11\" y=\"14\" rx=\"1\"></rect></svg>',\r\n    fullscreen: '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8 3H5a2 2 0 0 0-2 2v3\"></path><path d=\"M16 3h3a2 2 0 0 1 2 2v3\"></path><path d=\"M8 21H5a2 2 0 0 1-2-2v-3\"></path><path d=\"M16 21h3a2 2 0 0 0 2-2v-3\"></path></svg>',\r\n    speed:\r\n      '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"10\"></circle><polyline points=\"12 6 12 12 16 14\"></polyline></svg>',\r\n    airplay:\r\n      '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" class=\"lucide lucide-airplay\" aria-hidden=\"true\"><path d=\"M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1\"></path><path d=\"m12 15 5 6H7Z\"></path></svg>',\r\n    collapse:\r\n      '<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m18 15-6-6-6 6\"></path></svg>',\r\n  });\r\n\r\n  function playerControlButtonMarkup(action, label, icon, extraClass = '') {\r\n    const menuAttributes =\r\n      action === 'speed' || action === 'quality'\r\n        ? ' aria-haspopup=\"menu\" aria-expanded=\"false\"'\r\n        : '';\r\n    const className = extraClass\r\n      ? `fyp-player-control ${extraClass}`\r\n      : 'fyp-player-control';\r\n    return (\r\n      `<button type=\"button\" class=\"${className}\" ` +\r\n      `data-fyp-player-action=\"${action}\" aria-label=\"${label}\" ` +\r\n      `title=\"${label}\" aria-pressed=\"false\"${menuAttributes}>${icon}</button>`\r\n    );\r\n  }\r\n\r\n  function playerControlsMarkup() {\r\n    return [\r\n      playerControlButtonMarkup(\r\n        'rewind',\r\n        'Back 10 seconds',\r\n        PLAYER_CONTROL_ICONS.rewind\r\n      ),\r\n      playerControlButtonMarkup(\r\n        'play-pause',\r\n        'Play',\r\n        PLAYER_CONTROL_ICONS.play\r\n      ),\r\n      playerControlButtonMarkup(\r\n        'forward',\r\n        'Forward 10 seconds',\r\n        PLAYER_CONTROL_ICONS.forward\r\n      ),\r\n      playerControlButtonMarkup(\r\n        'pip',\r\n        'Picture in Picture',\r\n        PLAYER_CONTROL_ICONS.pip\r\n      ),\r\n      playerControlButtonMarkup(\r\n        'airplay',\r\n        'AirPlay',\r\n        PLAYER_CONTROL_ICONS.airplay\r\n      ),\r\n      playerControlButtonMarkup(\r\n        'fullscreen',\r\n        'Fullscreen',\r\n        PLAYER_CONTROL_ICONS.fullscreen\r\n      ),\r\n    ].join('');\r\n  }\r\n\r\n  function controllableVideo(shouldAttach = true) {\r\n    const stateVideo =\r\n      state.video instanceof HTMLVideoElement && state.video.isConnected\r\n        ? state.video\r\n        : null;\r\n    const video = stateVideo || findVideo();\r\n    if (!(video instanceof HTMLVideoElement)) return null;\r\n    if (shouldAttach) attachVideo(video);\r\n    return video;\r\n  }\r\n\r\n  function syncCustomPlayerControls() {\r\n    const toolbar = document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID);\r\n    if (!(toolbar instanceof HTMLElement)) return;\r\n    const video = controllableVideo(false);\r\n    const playButton = toolbar.querySelector(\r\n      '[data-fyp-player-action=\"play-pause\"]'\r\n    );\r\n    if (playButton instanceof HTMLButtonElement) {\r\n      const paused = !video || video.paused || video.ended;\r\n      const label = paused ? 'Play' : 'Pause';\r\n      const playbackState = paused ? 'paused' : 'playing';\r\n      if (playButton.dataset.fypPlaybackState !== playbackState) {\r\n        playButton.dataset.fypPlaybackState = playbackState;\r\n        playButton.innerHTML = paused\r\n          ? PLAYER_CONTROL_ICONS.play\r\n          : PLAYER_CONTROL_ICONS.pause;\r\n      }\r\n      playButton.setAttribute('aria-label', label);\r\n      playButton.title = label;\r\n      playButton.setAttribute('aria-pressed', String(!paused));\r\n    }\r\n\r\n    const pipButton = toolbar.querySelector('[data-fyp-player-action=\"pip\"]');\r\n    if (pipButton instanceof HTMLButtonElement) {\r\n      const pipActive =\r\n        document.pictureInPictureElement === video ||\r\n        video?.webkitPresentationMode === 'picture-in-picture';\r\n      pipButton.setAttribute('aria-pressed', String(pipActive));\r\n    }\r\n\r\n    const fullscreenButton = toolbar.querySelector(\r\n      '[data-fyp-player-action=\"fullscreen\"]'\r\n    );\r\n    if (fullscreenButton instanceof HTMLButtonElement) {\r\n      const fullscreenActive = Boolean(\r\n        document.fullscreenElement ||\r\n          document.webkitFullscreenElement ||\r\n          video?.webkitDisplayingFullscreen\r\n      );\r\n      fullscreenButton.setAttribute('aria-pressed', String(fullscreenActive));\r\n    }\r\n  }\r\n\r\n  function playerMenuHosts() {\r\n    return [\r\n      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID),\r\n    ].filter((node) => node instanceof HTMLElement);\r\n  }\r\n\r\n  function closePlayerControlMenu(host) {\r\n    const hosts = host instanceof HTMLElement ? [host] : playerMenuHosts();\r\n    for (const menuHost of hosts) {\r\n      menuHost.querySelector('.fyp-player-menu')?.remove();\r\n      menuHost\r\n        .querySelectorAll('[aria-haspopup=\"menu\"]')\r\n        .forEach((button) => button.setAttribute('aria-expanded', 'false'));\r\n    }\r\n  }\r\n\r\n  function createPlayerControlMenu(host, sourceButton, label) {\r\n    if (!(host instanceof HTMLElement)) return null;\r\n    const current = host.querySelector('.fyp-player-menu');\r\n    if (\r\n      current?.dataset.fypMenuOwner === sourceButton.dataset.fypPlayerAction\r\n    ) {\r\n      closePlayerControlMenu(host);\r\n      return null;\r\n    }\r\n    closePlayerControlMenu();\r\n    const menu = document.createElement('div');\r\n    menu.className = 'fyp-player-menu';\r\n    menu.dataset.fypMenuOwner = sourceButton.dataset.fypPlayerAction || '';\r\n    menu.setAttribute('role', 'menu');\r\n    menu.setAttribute('aria-label', label);\r\n    sourceButton.setAttribute('aria-expanded', 'true');\r\n    host.appendChild(menu);\r\n    return menu;\r\n  }\r\n\r\n  function appendPlayerMenuTitle(menu, text) {\r\n    const title = document.createElement('div');\r\n    title.className = 'fyp-player-menu-title';\r\n    title.textContent = text;\r\n    menu.appendChild(title);\r\n  }\r\n\r\n  function appendPlayerMenuCollapse(menu) {\r\n    const button = document.createElement('button');\r\n    button.type = 'button';\r\n    button.className = 'fyp-player-menu-collapse';\r\n    button.dataset.fypPlayerOption = 'menu-collapse';\r\n    button.setAttribute('aria-label', 'Collapse menu');\r\n    button.title = 'Collapse menu';\r\n    button.innerHTML = PLAYER_CONTROL_ICONS.collapse;\r\n    menu.appendChild(button);\r\n    return button;\r\n  }\r\n\r\n  function appendPlayerMenuOption(\r\n    menu,\r\n    {\r\n      action,\r\n      label,\r\n      checked = false,\r\n      disabled = false,\r\n      trackIndex,\r\n      speed,\r\n      quality,\r\n      captionLanguage,\r\n      captionLabel,\r\n    }\r\n  ) {\r\n    const option = document.createElement('button');\r\n    option.type = 'button';\r\n    option.className = 'fyp-player-menu-option';\r\n    option.dataset.fypPlayerOption = action;\r\n    if (trackIndex !== undefined) {\r\n      option.dataset.fypTrackIndex = String(trackIndex);\r\n    }\r\n    if (speed !== undefined) option.dataset.fypSpeed = String(speed);\r\n    if (quality !== undefined) option.dataset.fypQuality = String(quality);\r\n    if (captionLanguage !== undefined) {\r\n      option.dataset.fypCaptionLanguage = String(captionLanguage);\r\n    }\r\n    if (captionLabel !== undefined) {\r\n      option.dataset.fypCaptionLabel = String(captionLabel);\r\n    }\r\n    option.setAttribute('role', 'menuitemradio');\r\n    option.setAttribute('aria-checked', String(checked));\r\n    option.disabled = disabled;\r\n    option.textContent = label;\r\n    menu.appendChild(option);\r\n    return option;\r\n  }\r\n\r\n  function captionTracks(video) {\r\n    const tracks = [...video.textTracks].filter(\r\n      (track) => track.kind === 'captions' || track.kind === 'subtitles'\r\n    );\r\n    const seen = new Set();\r\n    return tracks.filter((track) => {\r\n      const key = `${track.label || ''}|${track.language || ''}`\r\n        .trim()\r\n        .toLowerCase();\r\n      if (seen.has(key)) return false;\r\n      seen.add(key);\r\n      return true;\r\n    });\r\n  }\r\n\r\n  function captionOptionText(value) {\r\n    if (typeof value === 'string') return value.trim();\r\n    if (typeof value?.simpleText === 'string') return value.simpleText.trim();\r\n    if (Array.isArray(value?.runs)) {\r\n      return value.runs.map((run) => run.text || '').join('').trim();\r\n    }\r\n    return '';\r\n  }\r\n\r\n  function youtubeCaptionTrackList() {\r\n    const player = document.querySelector('#movie_player');\r\n    if (!player || typeof player.getOption !== 'function') return [];\r\n    try {\r\n      const tracks = player.getOption('captions', 'tracklist');\r\n      if (!Array.isArray(tracks)) return [];\r\n      const seen = new Set();\r\n      return tracks.filter((track) => {\r\n        const label = captionOptionText(\r\n          track.displayName || track.name || track.label\r\n        ).toLowerCase();\r\n        const language = String(\r\n          track.languageCode || track.language || track.lang || ''\r\n        ).toLowerCase();\r\n        const key = `${label}|${language}`;\r\n        if (seen.has(key)) return false;\r\n        seen.add(key);\r\n        return true;\r\n      });\r\n    } catch {\r\n      return [];\r\n    }\r\n  }\r\n\r\n  function selectYouTubeCaptionTrack(selectedTrack) {\r\n    const player = document.querySelector('#movie_player');\r\n    if (!player || typeof player.setOption !== 'function') return false;\r\n    try {\r\n      player.loadModule?.('captions');\r\n    } catch {}\r\n    const selectedLabel = String(\r\n      selectedTrack?.label || selectedTrack?.captionLabel || ''\r\n    )\r\n      .trim()\r\n      .toLowerCase();\r\n    const selectedLanguage = String(\r\n      selectedTrack?.language ||\r\n        selectedTrack?.languageCode ||\r\n        selectedTrack?.captionLanguage ||\r\n        selectedTrack?.lang ||\r\n        ''\r\n    ).toLowerCase();\r\n    const youtubeTrackList = youtubeCaptionTrackList();\r\n    let youtubeTrack =\r\n      youtubeTrackList.find((track) => {\r\n        const label = captionOptionText(\r\n          track.displayName || track.name || track.label\r\n        ).toLowerCase();\r\n        const language = String(\r\n          track.languageCode || track.language || track.lang || ''\r\n        ).toLowerCase();\r\n        return (\r\n          (selectedLabel && label === selectedLabel) ||\r\n          (selectedLanguage && language === selectedLanguage)\r\n        );\r\n      }) || null;\r\n    if (!youtubeTrack && selectedTrack && typeof selectedTrack === 'object') {\r\n      if (\r\n        selectedTrack.languageCode ||\r\n        selectedTrack.language ||\r\n        selectedTrack.lang\r\n      ) {\r\n        youtubeTrack = selectedTrack;\r\n      } else if (selectedLanguage) {\r\n        youtubeTrack = {\r\n          languageCode: selectedLanguage,\r\n          language: selectedLanguage,\r\n        };\r\n      }\r\n    }\r\n    if (!youtubeTrack) return false;\r\n    try {\r\n      // Drive YouTube's caption module exclusively; do not click the native\r\n      // subtitles button or force textTrack mode here.\r\n      player.setOption('captions', 'track', youtubeTrack);\r\n      player.setOption('captions', 'reload', true);\r\n      return true;\r\n    } catch {\r\n      return false;\r\n    }\r\n  }\r\n\r\n  function currentYouTubeCaptionTrack() {\r\n    const player = document.querySelector('#movie_player');\r\n    if (!player || typeof player.getOption !== 'function') return null;\r\n    try {\r\n      const track = player.getOption('captions', 'track');\r\n      if (!track || typeof track !== 'object') return null;\r\n      const language = String(\r\n        track.languageCode || track.language || track.lang || ''\r\n      ).trim();\r\n      const label = captionOptionText(\r\n        track.displayName || track.name || track.label\r\n      );\r\n      if (!language && !label) return null;\r\n      return track;\r\n    } catch {\r\n      return null;\r\n    }\r\n  }\r\n\r\n  function qualityOptionLabel(quality) {\r\n    const labels = {\r\n      auto: 'Auto',\r\n      highres: 'High res',\r\n      hd2160: '2160p',\r\n      hd1440: '1440p',\r\n      hd1080: '1080p',\r\n      hd720: '720p',\r\n      large: '480p',\r\n      medium: '360p',\r\n      small: '240p',\r\n      tiny: '144p',\r\n    };\r\n    return labels[quality] || String(quality || '').toUpperCase() || 'Auto';\r\n  }\r\n\r\n  function youtubeQualityOptions() {\r\n    const player = document.querySelector('#movie_player');\r\n    if (!player) {\r\n      return FALLBACK_QUALITY_LEVELS.map((quality) => ({\r\n        quality,\r\n        label: qualityOptionLabel(quality),\r\n      }));\r\n    }\r\n    const options = [];\r\n    const seen = new Set();\r\n    try {\r\n      const qualityData = player.getAvailableQualityData?.() || [];\r\n      for (const entry of qualityData) {\r\n        const quality = String(entry?.quality || entry?.id || '').trim();\r\n        if (!quality || seen.has(quality)) continue;\r\n        seen.add(quality);\r\n        options.push({\r\n          quality,\r\n          label:\r\n            captionOptionText(\r\n              entry?.qualityLabel || entry?.displayName || entry?.label\r\n            ) || qualityOptionLabel(quality),\r\n        });\r\n      }\r\n    } catch {}\r\n\r\n    let levels = [];\r\n    try {\r\n      if (typeof player.getAvailableQualityLevels === 'function') {\r\n        levels = player.getAvailableQualityLevels() || [];\r\n      }\r\n    } catch {}\r\n    if (!levels.length) {\r\n      try {\r\n        const optionLevels = player.getOption?.('quality', 'levels');\r\n        levels = Array.isArray(optionLevels) ? optionLevels : [];\r\n      } catch {\r\n        levels = [];\r\n      }\r\n    }\r\n    for (const level of levels) {\r\n      const quality = String(level || '').trim();\r\n      if (!quality || seen.has(quality)) continue;\r\n      seen.add(quality);\r\n      options.push({ quality, label: qualityOptionLabel(quality) });\r\n    }\r\n    if (!seen.has('auto')) {\r\n      options.unshift({ quality: 'auto', label: 'Auto' });\r\n    }\r\n    // Orion sometimes reports only \"auto\" before levels settle; keep a usable ladder.\r\n    if (options.length <= 1) {\r\n      return FALLBACK_QUALITY_LEVELS.map((quality) => ({\r\n        quality,\r\n        label: qualityOptionLabel(quality),\r\n      }));\r\n    }\r\n    return options;\r\n  }\r\n\r\n  function youtubeQualityLevels() {\r\n    return youtubeQualityOptions().map((option) => option.quality);\r\n  }\r\n\r\n  function currentYouTubeQuality(video) {\r\n    if (video && selectedQualityByVideo.has(video)) {\r\n      return selectedQualityByVideo.get(video);\r\n    }\r\n    const player = document.querySelector('#movie_player');\r\n    try {\r\n      return (\r\n        player?.getPlaybackQuality?.() ||\r\n        player?.getOption?.('quality', 'requested') ||\r\n        'auto'\r\n      );\r\n    } catch {\r\n      return 'auto';\r\n    }\r\n  }\r\n\r\n  function applyYouTubeQuality(quality) {\r\n    const player = document.querySelector('#movie_player');\r\n    if (!player || !quality) return;\r\n    try {\r\n      player.setPlaybackQualityRange?.(quality, quality);\r\n    } catch {}\r\n    try {\r\n      player.setPlaybackQuality?.(quality);\r\n    } catch {}\r\n    try {\r\n      player.setOption?.('quality', 'requested', quality);\r\n    } catch {}\r\n  }\r\n\r\n  function menuHostForButton(sourceButton) {\r\n    return sourceButton.closest(`#${PLAYER_CONTROLS_TOOLBAR_ID}`);\r\n  }\r\n\r\n  function toggleSpeedMenu(video, sourceButton) {\r\n    const host = menuHostForButton(sourceButton);\r\n    if (!(host instanceof HTMLElement)) return;\r\n    const menu = createPlayerControlMenu(\r\n      host,\r\n      sourceButton,\r\n      'Playback speed'\r\n    );\r\n    if (!menu) return;\r\n\r\n    appendPlayerMenuCollapse(menu);\r\n    appendPlayerMenuTitle(menu, 'Playback speed');\r\n    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {\r\n      appendPlayerMenuOption(menu, {\r\n        action: 'playback-speed',\r\n        label: speed === 1 ? 'Normal' : `${speed}×`,\r\n        checked: Math.abs(video.playbackRate - speed) < 0.01,\r\n        speed,\r\n      });\r\n    }\r\n  }\r\n\r\n  function toggleQualityMenu(video, sourceButton) {\r\n    const host = menuHostForButton(sourceButton);\r\n    if (!(host instanceof HTMLElement)) return;\r\n    const menu = createPlayerControlMenu(\r\n      host,\r\n      sourceButton,\r\n      'Video quality'\r\n    );\r\n    if (!menu) return;\r\n\r\n    appendPlayerMenuCollapse(menu);\r\n    appendPlayerMenuTitle(menu, 'Video quality');\r\n    const qualities = youtubeQualityOptions();\r\n    const currentQuality = String(currentYouTubeQuality(video) || 'auto');\r\n    for (const { quality, label } of qualities) {\r\n      appendPlayerMenuOption(menu, {\r\n        action: 'playback-quality',\r\n        label,\r\n        checked: currentQuality === quality,\r\n        quality,\r\n      });\r\n    }\r\n  }\r\n\r\n  async function runPlayerControlOption(option) {\r\n    const video = controllableVideo();\r\n    if (!(video instanceof HTMLVideoElement)) return;\r\n    const preservePlayback = !video.paused;\r\n    const action = option.dataset.fypPlayerOption;\r\n\r\n    /*\r\n     * Playback-speed is the known-good Orion pattern: apply immediately, retry\r\n     * once at 120ms, avoid native UI clicks that steal the gesture. Captions\r\n     * and quality follow that same shape. Caption ownership stays with YouTube's\r\n     * caption module — never click .ytp-subtitles-button from this menu.\r\n     */\r\n    if (action === 'menu-collapse') {\r\n      // Close only; shared cleanup below still runs.\r\n    } else if (action === 'captions-off') {\r\n      const applyCaptionsOff = () => {\r\n        try {\r\n          const player = document.querySelector('#movie_player');\r\n          player?.loadModule?.('captions');\r\n          player?.setOption?.('captions', 'track', {});\r\n        } catch {}\r\n        selectedCaptionTrackByVideo.delete(video);\r\n        captionDedupeReadyAtByVideo.delete(video);\r\n        delete video.dataset.fypNativeCaptionsHidden;\r\n      };\r\n      applyCaptionsOff();\r\n      setTimeout(applyCaptionsOff, 120);\r\n    } else if (action === 'caption-track') {\r\n      const language = String(option.dataset.fypCaptionLanguage || '').trim();\r\n      const label = String(option.dataset.fypCaptionLabel || '').trim();\r\n      const trackIndex = Number(option.dataset.fypTrackIndex);\r\n      const youtubeTracks = youtubeCaptionTrackList();\r\n      const textTracks = captionTracks(video);\r\n      const selectedMeta =\r\n        (Number.isFinite(trackIndex) && youtubeTracks[trackIndex]) ||\r\n        {\r\n          language,\r\n          languageCode: language,\r\n          label,\r\n          captionLanguage: language,\r\n          captionLabel: label,\r\n        };\r\n      const applyCaptionSelection = () => {\r\n        selectYouTubeCaptionTrack(selectedMeta);\r\n        const matchedTextTrack =\r\n          (Number.isFinite(trackIndex) && textTracks[trackIndex]) ||\r\n          textTracks.find((track) => {\r\n            const trackLanguage = String(track.language || '').toLowerCase();\r\n            const trackLabel = String(track.label || '')\r\n              .trim()\r\n              .toLowerCase();\r\n            return (\r\n              (language && trackLanguage === language.toLowerCase()) ||\r\n              (label && trackLabel === label.toLowerCase())\r\n            );\r\n          });\r\n        if (matchedTextTrack) {\r\n          selectedCaptionTrackByVideo.set(video, matchedTextTrack);\r\n        } else {\r\n          selectedCaptionTrackByVideo.set(video, selectedMeta);\r\n        }\r\n        // Deduplicate only after YouTube's custom caption layer can paint.\r\n        setTimeout(() => suppressDuplicateNativeCaptions(video), 250);\r\n      };\r\n      applyCaptionSelection();\r\n      setTimeout(applyCaptionSelection, 120);\r\n    } else if (action === 'playback-speed') {\r\n      const speed = Number(option.dataset.fypSpeed);\r\n      if (Number.isFinite(speed)) {\r\n        const applyPlaybackRate = () => {\r\n          video.playbackRate = speed;\r\n          try {\r\n            document.querySelector('#movie_player')?.setPlaybackRate?.(speed);\r\n          } catch {}\r\n        };\r\n        applyPlaybackRate();\r\n        setTimeout(applyPlaybackRate, 120);\r\n      }\r\n    } else if (action === 'playback-quality') {\r\n      const quality = String(option.dataset.fypQuality || '').trim();\r\n      if (quality) {\r\n        const applyQuality = () => {\r\n          applyYouTubeQuality(quality);\r\n          selectedQualityByVideo.set(video, quality);\r\n        };\r\n        applyQuality();\r\n        setTimeout(applyQuality, 120);\r\n      }\r\n    }\r\n\r\n    if (preservePlayback) {\r\n      state.wantsPlayback = true;\r\n      state.userPauseUntil = 0;\r\n      for (const delay of [0, 120, 350]) {\r\n        setTimeout(() => {\r\n          if (video.paused && !video.ended) safePlay(video);\r\n        }, delay);\r\n      }\r\n    }\r\n    if (action === 'playback-quality') {\r\n      const selectedQuality = String(option.dataset.fypQuality || '').trim();\r\n      option\r\n        .closest('.fyp-player-menu')\r\n        ?.querySelectorAll('[data-fyp-player-option=\"playback-quality\"]')\r\n        .forEach((qualityOption) => {\r\n          qualityOption.setAttribute(\r\n            'aria-checked',\r\n            String(qualityOption.dataset.fypQuality === selectedQuality)\r\n          );\r\n        });\r\n    } else {\r\n      closePlayerControlMenu();\r\n    }\r\n    setTimeout(syncCustomPlayerControls, 0);\r\n    setTimeout(syncCustomPlayerControls, 250);\r\n  }\r\n\r\n  async function runPlayerControlAction(action, sourceButton) {\r\n    const video = controllableVideo();\r\n    if (!(video instanceof HTMLVideoElement)) return;\r\n    const preservePlayback = action !== 'play-pause' && !video.paused;\r\n\r\n    if (action === 'rewind' || action === 'forward') {\r\n      const offset = action === 'rewind' ? -10 : 10;\r\n      const duration = Number.isFinite(video.duration)\r\n        ? video.duration\r\n        : Number.POSITIVE_INFINITY;\r\n      video.currentTime = Math.max(\r\n        0,\r\n        Math.min(duration, video.currentTime + offset)\r\n      );\r\n    } else if (action === 'play-pause') {\r\n      if (video.paused || video.ended) {\r\n        state.wantsPlayback = true;\r\n        state.userPauseUntil = 0;\r\n        try {\r\n          await video.play();\r\n        } catch {\r\n          document.querySelector('.ytp-play-button')?.click();\r\n        }\r\n      } else {\r\n        state.wantsPlayback = false;\r\n        state.userPauseUntil = Date.now() + 3000;\r\n        clearRecoveryTimers();\r\n        video.pause();\r\n      }\r\n    } else if (\r\n      action === 'speed' &&\r\n      sourceButton instanceof HTMLButtonElement\r\n    ) {\r\n      toggleSpeedMenu(video, sourceButton);\r\n    } else if (action === 'quality' && sourceButton instanceof HTMLButtonElement) {\r\n      toggleQualityMenu(video, sourceButton);\r\n    } else if (action === 'airplay') {\r\n      video.setAttribute('x-webkit-airplay', 'allow');\r\n      if (typeof video.webkitShowPlaybackTargetPicker === 'function') {\r\n        video.webkitShowPlaybackTargetPicker();\r\n      }\r\n    } else if (action === 'pip') {\r\n      video.removeAttribute('disablepictureinpicture');\r\n      try {\r\n        video.disablePictureInPicture = false;\r\n      } catch {}\r\n      if (document.pictureInPictureElement) {\r\n        await document.exitPictureInPicture?.();\r\n      } else if (typeof video.requestPictureInPicture === 'function') {\r\n        await video.requestPictureInPicture();\r\n      } else if (typeof video.webkitSetPresentationMode === 'function') {\r\n        const mode =\r\n          video.webkitPresentationMode === 'picture-in-picture'\r\n            ? 'inline'\r\n            : 'picture-in-picture';\r\n        video.webkitSetPresentationMode(mode);\r\n      }\r\n    } else if (action === 'fullscreen') {\r\n      state.fullscreenIntentUntil = Date.now() + 2000;\r\n      const player =\r\n        video.closest('#movie_player, .html5-video-player, ytd-player') ||\r\n        video;\r\n      if (document.fullscreenElement || document.webkitFullscreenElement) {\r\n        const exit =\r\n          document.exitFullscreen || document.webkitExitFullscreen;\r\n        await exit?.call(document);\r\n      } else {\r\n        const request =\r\n          player.requestFullscreen ||\r\n          player.webkitRequestFullscreen ||\r\n          player.webkitRequestFullScreen;\r\n        if (typeof request === 'function') {\r\n          await request.call(player);\r\n        } else {\r\n          const enter =\r\n            video.webkitEnterFullscreen || video.webkitEnterFullScreen;\r\n          enter?.call(video);\r\n        }\r\n      }\r\n    }\r\n\r\n    if (preservePlayback) {\r\n      state.wantsPlayback = true;\r\n      state.userPauseUntil = 0;\r\n      for (const delay of [0, 120, 350]) {\r\n        setTimeout(() => {\r\n          if (video.paused && !video.ended) safePlay(video);\r\n        }, delay);\r\n      }\r\n    }\r\n    setTimeout(syncCustomPlayerControls, 0);\r\n    setTimeout(syncCustomPlayerControls, 250);\r\n  }\r\n\r\n  function acceptSinglePlayerControlAction(button) {\r\n    if (!(button instanceof HTMLElement)) return false;\r\n    const now = Date.now();\r\n    const previous = Number(button.dataset.fypLastActionAt || 0);\r\n    if (now - previous < 450) return false;\r\n    button.dataset.fypLastActionAt = String(now);\r\n    return true;\r\n  }\r\n\r\n  function eventClientPoint(event) {\r\n    if (event.changedTouches?.[0]) {\r\n      return {\r\n        x: event.changedTouches[0].clientX,\r\n        y: event.changedTouches[0].clientY,\r\n      };\r\n    }\r\n    if (event.touches?.[0]) {\r\n      return {\r\n        x: event.touches[0].clientX,\r\n        y: event.touches[0].clientY,\r\n      };\r\n    }\r\n    return {\r\n      x: Number(event.clientX) || 0,\r\n      y: Number(event.clientY) || 0,\r\n    };\r\n  }\r\n\r\n  function isFypOwnedTarget(target) {\r\n    return target instanceof Element && Boolean(target.closest(FYP_OWNED_SELECTOR));\r\n  }\r\n\r\n  function handlePlayerControlActionCapture(event) {\r\n    const target = event.target;\r\n    if (!(target instanceof Element)) return;\r\n    /*\r\n     * Never steal YouTube chrome (settings gear, CC, progress, etc.).\r\n     * Capture handlers only own FYP strip / search nodes.\r\n     */\r\n    if (!isFypOwnedTarget(target)) return;\r\n\r\n    if (Date.now() < ignorePlayerControlActionsUntil) {\r\n      if (event.cancelable) event.preventDefault();\r\n      event.stopImmediatePropagation();\r\n      return;\r\n    }\r\n\r\n    const optionButton = target.closest('[data-fyp-player-option]');\r\n    if (optionButton instanceof HTMLButtonElement) {\r\n      /*\r\n       * Dropdown options must remain scrollable on Orion/iOS. Do not\r\n       * preventDefault on pointerdown/touchstart — that kills overflow-y\r\n       * scrolling. Activate only on a short, low-slop pointerup/touchend.\r\n       */\r\n      if (event.type === 'pointerdown' || event.type === 'touchstart') {\r\n        const point = eventClientPoint(event);\r\n        pendingMenuOptionGesture = {\r\n          button: optionButton,\r\n          x: point.x,\r\n          y: point.y,\r\n        };\r\n        event.stopPropagation();\r\n        return;\r\n      }\r\n      if (\r\n        event.type === 'pointercancel' ||\r\n        event.type === 'touchcancel'\r\n      ) {\r\n        pendingMenuOptionGesture = null;\r\n        return;\r\n      }\r\n      if (event.type === 'pointerup' || event.type === 'touchend') {\r\n        const gesture = pendingMenuOptionGesture;\r\n        pendingMenuOptionGesture = null;\r\n        if (!gesture || gesture.button !== optionButton) return;\r\n        const point = eventClientPoint(event);\r\n        const moved =\r\n          Math.abs(point.x - gesture.x) > MENU_OPTION_TAP_SLOP_PX ||\r\n          Math.abs(point.y - gesture.y) > MENU_OPTION_TAP_SLOP_PX;\r\n        if (moved) return;\r\n        if (event.cancelable) event.preventDefault();\r\n        event.stopImmediatePropagation();\r\n        if (!acceptSinglePlayerControlAction(optionButton)) return;\r\n        ignorePlayerControlActionsUntil = Date.now() + 500;\r\n        void runPlayerControlOption(optionButton);\r\n        return;\r\n      }\r\n      if (event.type === 'click') {\r\n        if (event.cancelable) event.preventDefault();\r\n        event.stopImmediatePropagation();\r\n      }\r\n      return;\r\n    }\r\n\r\n    const button = target.closest('[data-fyp-player-action]');\r\n    if (!(button instanceof HTMLButtonElement)) return;\r\n    if (event.cancelable) event.preventDefault();\r\n    event.stopImmediatePropagation();\r\n    if (!acceptSinglePlayerControlAction(button)) return;\r\n    void runPlayerControlAction(button.dataset.fypPlayerAction, button);\r\n  }\r\n\r\n  function closePlayerControlMenuFromOutside(event) {\r\n    const target = event.target;\r\n    if (!(target instanceof Element)) return;\r\n    if (target.closest(`#${PLAYER_CONTROLS_TOOLBAR_ID}`)) return;\r\n    // Do not preventDefault — native ytp menus / settings must keep working.\r\n    closePlayerControlMenu();\r\n  }\r\n\r\n  function enforceHorizontalViewportLock() {\r\n    const event = arguments[0];\r\n    if (guideDrawerIsBusy()) {\r\n      event?.stopImmediatePropagation?.();\r\n      return;\r\n    }\r\n    const scrollingElement = document.scrollingElement;\r\n    if (scrollingElement?.scrollLeft) scrollingElement.scrollLeft = 0;\r\n    if (document.documentElement.scrollLeft) {\r\n      document.documentElement.scrollLeft = 0;\r\n    }\r\n    if (document.body?.scrollLeft) document.body.scrollLeft = 0;\r\n    const app = document.querySelector('ytd-app, ytm-app');\r\n    if (app?.scrollLeft) app.scrollLeft = 0;\r\n    const pageManager = document.querySelector('ytd-page-manager, #page-manager');\r\n    if (pageManager?.scrollLeft) pageManager.scrollLeft = 0;\r\n    if (window.scrollX) window.scrollTo(0, window.scrollY);\r\n  }\r\n\r\n  function enforceInlinePlayback(video) {\r\n    if (!video) return;\r\n    if (!video.hasAttribute('playsinline')) video.setAttribute('playsinline', '');\r\n    if (!video.hasAttribute('webkit-playsinline')) {\r\n      video.setAttribute('webkit-playsinline', '');\r\n    }\r\n    try {\r\n      video.playsInline = true;\r\n    } catch {}\r\n    if (video.getAttribute('x-webkit-airplay') !== 'allow') {\r\n      video.setAttribute('x-webkit-airplay', 'allow');\r\n    }\r\n    try {\r\n      video.webkitPlaysInline = true;\r\n    } catch {}\r\n    try {\r\n      video.removeAttribute('disablepictureinpicture');\r\n      video.disablePictureInPicture = false;\r\n    } catch {}\r\n  }\r\n\r\n  function onVideoLoaded() {\r\n    enforceInlinePlayback(state.video);\r\n    restoreWatchResume(state.video);\r\n    void refreshWatchDislikeCount({ force: true });\r\n    updateMediaSessionMetadata();\r\n  }\r\n\r\n  function hasExplicitFullscreenIntent() {\r\n    return Date.now() <= state.fullscreenIntentUntil;\r\n  }\r\n\r\n  function isVideoFullscreenTarget(target) {\r\n    if (target instanceof HTMLVideoElement) return true;\r\n    if (!(target instanceof Element)) return false;\r\n    return Boolean(\r\n      target.matches?.(\r\n        '#movie_player, .html5-video-player, .html5-video-container, ytd-player'\r\n      ) || target.querySelector?.('video')\r\n    );\r\n  }\r\n\r\n  function recordFullscreenIntent(event) {\r\n    const target = event.target;\r\n    if (!(target instanceof Element)) return;\r\n    const control = target.closest([\r\n      '.ytp-fullscreen-button',\r\n      'button[aria-label=\"Full screen\"]',\r\n      'button[aria-label=\"Fullscreen\"]',\r\n      'button[title=\"Full screen\"]',\r\n      'button[title=\"Fullscreen\"]',\r\n      '[data-tooltip-target-id=\"ytp-fullscreen-button\"]',\r\n      '[data-fyp-player-action=\"fullscreen\"]',\r\n    ].join(','));\r\n    if (!control) return;\r\n    state.fullscreenIntentUntil = Date.now() + 2000;\r\n  }\r\n\r\n  /*\r\n   * WebKit can choose native fullscreen before a late play() patch takes\r\n   * effect. Mark video elements at creation time, then repeat immediately\r\n   * before native play(). Fullscreen entry remains available only for the two\r\n   * seconds following a real tap on YouTube's fullscreen control.\r\n   */\r\n  function installInlinePlaybackGuard() {\r\n    const flag = '__ytMobileOrionInlinePlaybackGuardV2';\r\n    if (window[flag]) return;\r\n    Object.defineProperty(window, flag, { value: true });\r\n\r\n    const replacePrototypeMethod = (prototype, method, createReplacement) => {\r\n      const nativeMethod = prototype?.[method];\r\n      if (typeof nativeMethod !== 'function') return;\r\n      const replacement = createReplacement(nativeMethod);\r\n      try {\r\n        const descriptor = Object.getOwnPropertyDescriptor(prototype, method);\r\n        Object.defineProperty(prototype, method, {\r\n          configurable: descriptor?.configurable ?? true,\r\n          enumerable: descriptor?.enumerable ?? false,\r\n          writable: descriptor?.writable ?? true,\r\n          value: replacement,\r\n        });\r\n      } catch {\r\n        try {\r\n          prototype[method] = replacement;\r\n        } catch {}\r\n      }\r\n    };\r\n\r\n    const patchVideoCreation = (prototype, method) => {\r\n      replacePrototypeMethod(\r\n        prototype,\r\n        method,\r\n        (nativeMethod) =>\r\n          function inlineVideoCreation(name) {\r\n            const element = nativeMethod.apply(this, arguments);\r\n            if (\r\n              element instanceof HTMLVideoElement ||\r\n              String(name).toLowerCase() === 'video'\r\n            ) {\r\n              enforceInlinePlayback(element);\r\n            }\r\n            return element;\r\n          }\r\n      );\r\n    };\r\n\r\n    patchVideoCreation(Document.prototype, 'createElement');\r\n    patchVideoCreation(Document.prototype, 'createElementNS');\r\n\r\n    replacePrototypeMethod(\r\n      Element.prototype,\r\n      'setAttribute',\r\n      (nativeSetAttribute) =>\r\n        function inlineBeforeVideoSource(name) {\r\n          if (\r\n            this instanceof HTMLVideoElement &&\r\n            String(name).toLowerCase() === 'src'\r\n          ) {\r\n            enforceInlinePlayback(this);\r\n          }\r\n          return nativeSetAttribute.apply(this, arguments);\r\n        }\r\n    );\r\n\r\n    try {\r\n      const srcDescriptor = Object.getOwnPropertyDescriptor(\r\n        HTMLMediaElement.prototype,\r\n        'src'\r\n      );\r\n      if (srcDescriptor?.set && srcDescriptor.configurable) {\r\n        Object.defineProperty(HTMLMediaElement.prototype, 'src', {\r\n          ...srcDescriptor,\r\n          set(value) {\r\n            if (this instanceof HTMLVideoElement) enforceInlinePlayback(this);\r\n            return srcDescriptor.set.call(this, value);\r\n          },\r\n        });\r\n      }\r\n    } catch {}\r\n\r\n    replacePrototypeMethod(\r\n      HTMLMediaElement.prototype,\r\n      'play',\r\n      (nativePlay) =>\r\n        function inlinePlay() {\r\n          if (this instanceof HTMLVideoElement) {\r\n            enforceInlinePlayback(this);\r\n            if (\r\n              this.classList?.contains('html5-main-video') ||\r\n              this === state.video\r\n            ) {\r\n              attachVideo(this);\r\n            }\r\n          }\r\n          return nativePlay.apply(this, arguments);\r\n        }\r\n    );\r\n\r\n    const guardFullscreenMethod = (prototype, method, promiseResult = false) => {\r\n      replacePrototypeMethod(\r\n        prototype,\r\n        method,\r\n        (nativeMethod) =>\r\n          function explicitFullscreenOnly() {\r\n            if (\r\n              isVideoFullscreenTarget(this) &&\r\n              !hasExplicitFullscreenIntent()\r\n            ) {\r\n              return promiseResult ? Promise.resolve(undefined) : undefined;\r\n            }\r\n            return nativeMethod.apply(this, arguments);\r\n          }\r\n      );\r\n    };\r\n\r\n    guardFullscreenMethod(HTMLVideoElement.prototype, 'webkitEnterFullscreen');\r\n    guardFullscreenMethod(HTMLVideoElement.prototype, 'webkitEnterFullScreen');\r\n    guardFullscreenMethod(Element.prototype, 'requestFullscreen', true);\r\n    guardFullscreenMethod(Element.prototype, 'webkitRequestFullscreen');\r\n    guardFullscreenMethod(Element.prototype, 'webkitRequestFullScreen');\r\n\r\n    replacePrototypeMethod(\r\n      HTMLVideoElement.prototype,\r\n      'webkitSetPresentationMode',\r\n      (nativePresentationMode) =>\r\n        function explicitPresentationModeOnly(mode) {\r\n          if (mode === 'fullscreen' && !hasExplicitFullscreenIntent()) {\r\n            return undefined;\r\n          }\r\n          return nativePresentationMode.apply(this, arguments);\r\n        }\r\n    );\r\n\r\n    nativeDocumentAddEventListener(\r\n      'PointerEvent' in window ? 'pointerdown' : 'touchstart',\r\n      recordFullscreenIntent,\r\n      { capture: true, passive: true }\r\n    );\r\n    nativeDocumentAddEventListener('click', recordFullscreenIntent, true);\r\n\r\n    const enforceVideoTree = (root) => {\r\n      if (root instanceof HTMLVideoElement) enforceInlinePlayback(root);\r\n      root.querySelectorAll?.('video').forEach(enforceInlinePlayback);\r\n    };\r\n    enforceVideoTree(document);\r\n    const videoObserver = new MutationObserver((mutations) => {\r\n      for (const mutation of mutations) {\r\n        mutation.addedNodes.forEach((node) => {\r\n          if (node instanceof Element) enforceVideoTree(node);\r\n        });\r\n      }\r\n    });\r\n    videoObserver.observe(document.documentElement || document, {\r\n      childList: true,\r\n      subtree: true,\r\n    });\r\n    nativeDocumentAddEventListener('play', (event) => {\r\n      if (event.target instanceof HTMLVideoElement) {\r\n        attachVideo(event.target);\r\n        enforceInlinePlayback(event.target);\r\n      }\r\n    }, true);\r\n  }\r\n\r\n  installInlinePlaybackGuard();\r\n\r\n  function attachVideo(video) {\r\n    if (!video || video === state.video) {\r\n      if (video) {\r\n        enforceInlinePlayback(video);\r\n        suppressDuplicateNativeCaptions(video);\r\n      }\r\n      return;\r\n    }\r\n    if (state.video) {\r\n      state.video.removeEventListener('play', onVideoPlay);\r\n      state.video.removeEventListener('playing', onVideoPlay);\r\n      state.video.removeEventListener('pause', onVideoPause);\r\n      state.video.removeEventListener('ended', onVideoPause);\r\n      state.video.removeEventListener('loadedmetadata', onVideoLoaded);\r\n      state.video.removeEventListener('timeupdate', onVideoTimeUpdate);\r\n    }\r\n\r\n    state.video = video;\r\n    state.wantsPlayback = !video.paused && !video.ended;\r\n    enforceInlinePlayback(video);\r\n    suppressDuplicateNativeCaptions(video);\r\n    video.addEventListener('play', onVideoPlay, true);\r\n    video.addEventListener('playing', onVideoPlay, true);\r\n    video.addEventListener('pause', onVideoPause, true);\r\n    video.addEventListener('ended', onVideoPause, true);\r\n    video.addEventListener('loadedmetadata', onVideoLoaded, true);\r\n    video.addEventListener('timeupdate', onVideoTimeUpdate, true);\r\n    if (!video.paused && !video.ended) claimMediaSessionOwnership(video);\r\n    installMediaSessionHandlers();\r\n  }\r\n\r\n  function onVideoTimeUpdate() {\r\n    if (!state.video || state.video.paused || state.video.ended) return;\r\n    persistWatchResume(state.video);\r\n  }\r\n\r\n  function findVideo() {\r\n    const videos = [...document.querySelectorAll('video')];\r\n    return (\r\n      videos.find((video) => video.classList.contains('html5-main-video')) ||\r\n      videos.find((video) => !video.ended && video.readyState > 0) ||\r\n      videos[0] ||\r\n      null\r\n    );\r\n  }\r\n\r\n  function captionTrackLabel(track) {\r\n    return `${track.label || ''} ${track.language || ''}`.trim();\r\n  }\r\n\r\n  function isEnglishCaptionTrack(track) {\r\n    return (\r\n      /^en(?:[-_]|$)/i.test(track.language || '') ||\r\n      /\\benglish\\b/i.test(track.label || '')\r\n    );\r\n  }\r\n\r\n  function isAutoGeneratedCaptionTrack(track) {\r\n    return /\\b(?:auto(?:matic)?(?:-generated)?|generated|asr)\\b/i.test(\r\n      captionTrackLabel(track)\r\n    );\r\n  }\r\n\r\n  function captionTrackScore(track, index) {\r\n    const english = isEnglishCaptionTrack(track);\r\n    const automatic = isAutoGeneratedCaptionTrack(track);\r\n    let score = 0;\r\n    if (english && !automatic) score += 400;\r\n    else if (english && automatic) score += 300;\r\n    else if (!automatic) score += 200;\r\n    else score += 100;\r\n    if (track.mode === 'showing') score += 20;\r\n    else if (track.mode === 'hidden') score += 10;\r\n    return score - index / 1000;\r\n  }\r\n\r\n  function chooseBestCaptionTrack(tracks) {\r\n    return tracks\r\n      .map((track, index) => ({\r\n        track,\r\n        score: captionTrackScore(track, index),\r\n      }))\r\n      .sort((left, right) => right.score - left.score)[0]?.track;\r\n  }\r\n\r\n  function matchCaptionTrackByMeta(tracks, meta) {\r\n    if (!meta || !tracks.length) return null;\r\n    const language = String(\r\n      meta.languageCode || meta.language || meta.lang || meta.captionLanguage || ''\r\n    )\r\n      .trim()\r\n      .toLowerCase();\r\n    const label = captionOptionText(\r\n      meta.displayName || meta.name || meta.label || meta.captionLabel\r\n    ).toLowerCase();\r\n    return (\r\n      tracks.find((track) => {\r\n        const trackLanguage = String(track.language || '').toLowerCase();\r\n        const trackLabel = String(track.label || '')\r\n          .trim()\r\n          .toLowerCase();\r\n        return (\r\n          (label && trackLabel === label) ||\r\n          (language && trackLanguage === language)\r\n        );\r\n      }) || null\r\n    );\r\n  }\r\n\r\n  function suppressDuplicateNativeCaptions(video = state.video || findVideo()) {\r\n    if (!(video instanceof HTMLVideoElement)) return;\r\n    const player = video.closest('#movie_player, .html5-video-player');\r\n    if (!player) return;\r\n\r\n    const tracks = [];\r\n    for (let index = 0; index < video.textTracks.length; index += 1) {\r\n      const track = video.textTracks[index];\r\n      if (track.kind === 'captions' || track.kind === 'subtitles') {\r\n        tracks.push(track);\r\n      }\r\n    }\r\n    if (!tracks.length) return;\r\n\r\n    const customCaptionsVisible = Boolean(\r\n      player.querySelector('.ytp-caption-window-container .ytp-caption-segment')\r\n    );\r\n    const captionsButtonState = player\r\n      .querySelector('.ytp-subtitles-button')\r\n      ?.getAttribute('aria-pressed');\r\n    const captionsButtonPressed = captionsButtonState === 'true';\r\n    const activeTracks = tracks.filter((track) => track.mode !== 'disabled');\r\n    const previousTrack = selectedCaptionTrackByVideo.get(video);\r\n    const captionsIntendedOn =\r\n      customCaptionsVisible ||\r\n      captionsButtonPressed ||\r\n      activeTracks.length > 0;\r\n\r\n    /*\r\n     * Caption contract: YouTube's custom caption DOM is the sole visible owner\r\n     * once it paints. Hide native WebKit ::cue only while .ytp-caption-segment\r\n     * exists — never on button/active-track alone. 2.2.11 early-hide left Orion\r\n     * with blank captions when the custom module was starved (CPU tamer) or\r\n     * never painted. Collapse only duplicate sibling TextTracks after a short\r\n     * delay — never disable the preferred track. Do not click\r\n     * .ytp-subtitles-button.\r\n     */\r\n    if (customCaptionsVisible) {\r\n      video.dataset.fypNativeCaptionsHidden = 'true';\r\n    } else {\r\n      delete video.dataset.fypNativeCaptionsHidden;\r\n    }\r\n\r\n    if (!captionsIntendedOn) {\r\n      selectedCaptionTrackByVideo.delete(video);\r\n      captionDedupeReadyAtByVideo.delete(video);\r\n      return;\r\n    }\r\n\r\n    if (!captionDedupeReadyAtByVideo.has(video)) {\r\n      captionDedupeReadyAtByVideo.set(\r\n        video,\r\n        Date.now() + CAPTION_DEDUPE_DELAY_MS\r\n      );\r\n    }\r\n    const dedupeReady =\r\n      customCaptionsVisible ||\r\n      Date.now() >= captionDedupeReadyAtByVideo.get(video);\r\n\r\n    /*\r\n     * Stay hands-off until activation is stable, then disable siblings only.\r\n     * Never force the preferred track to hidden/disabled.\r\n     */\r\n    if (!dedupeReady) return;\r\n    if (!activeTracks.length && !customCaptionsVisible) return;\r\n\r\n    const newlyActiveTracks = activeTracks.filter(\r\n      (track) => track !== previousTrack\r\n    );\r\n    const youtubeTrack = currentYouTubeCaptionTrack();\r\n    let selectedTrack;\r\n    if (previousTrack && newlyActiveTracks.length) {\r\n      // A native Languages-menu tap selected another track. Respect it while\r\n      // still disabling every other simultaneously selected subtitle.\r\n      selectedTrack = chooseBestCaptionTrack(newlyActiveTracks);\r\n    } else if (\r\n      previousTrack &&\r\n      tracks.includes(previousTrack) &&\r\n      previousTrack.mode !== 'disabled'\r\n    ) {\r\n      selectedTrack = previousTrack;\r\n    } else {\r\n      selectedTrack =\r\n        matchCaptionTrackByMeta(\r\n          activeTracks.length ? activeTracks : tracks,\r\n          youtubeTrack\r\n        ) ||\r\n        chooseBestCaptionTrack(activeTracks.length ? activeTracks : tracks);\r\n    }\r\n    if (!selectedTrack) return;\r\n\r\n    // Recover a preferred track that earlier builds left disabled.\r\n    if (selectedTrack.mode === 'disabled') {\r\n      try {\r\n        selectedTrack.mode = 'hidden';\r\n      } catch {\r\n        // CSS ::cue hiding still covers locked WebKit tracks.\r\n      }\r\n    }\r\n\r\n    // Disable only siblings. Leave preferred showing/hidden alone so YouTube's\r\n    // caption module keeps painting. Skip writes when already correct.\r\n    for (const track of tracks) {\r\n      if (track === selectedTrack) continue;\r\n      if (track.mode === 'disabled') continue;\r\n      try {\r\n        track.mode = 'disabled';\r\n      } catch {\r\n        // CSS ::cue hiding still covers locked WebKit tracks.\r\n      }\r\n    }\r\n    selectedCaptionTrackByVideo.set(video, selectedTrack);\r\n  }\r\n\r\n  function metadataContent(selector) {\r\n    return document.querySelector(selector)?.getAttribute('content')?.trim() || '';\r\n  }\r\n\r\n  function visibleVideoTitle() {\r\n    return (\r\n      document\r\n        .querySelector(\r\n          'ytd-watch-metadata h1 yt-formatted-string, ' +\r\n            'ytd-watch-metadata #title yt-formatted-string, ' +\r\n            'ytd-video-primary-info-renderer h1 yt-formatted-string'\r\n        )\r\n        ?.textContent?.replace(/\\s+/g, ' ')?.trim() || ''\r\n    );\r\n  }\r\n\r\n  function mediaSessionArtwork(videoId, response) {\r\n    const candidates = [];\r\n    if (videoId) {\r\n      candidates.push(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);\r\n    }\r\n    candidates.push(metadataContent('meta[property=\"og:image\"]'));\r\n    for (const thumbnail of [\r\n      ...(response?.videoDetails?.thumbnail?.thumbnails || []),\r\n    ].reverse()) {\r\n      candidates.push(thumbnail.url);\r\n    }\r\n\r\n    for (const src of candidates) {\r\n      if (!src) continue;\r\n      try {\r\n        const absolute = new URL(src, location.href).href;\r\n        return [{ src: absolute }];\r\n      } catch {}\r\n    }\r\n    return [];\r\n  }\r\n\r\n  function applyMediaArtworkPoster(video, artwork) {\r\n    if (!(video instanceof HTMLVideoElement) || !artwork.length) return;\r\n    const preferred =\r\n      artwork.find((item) => item.src.includes('/hqdefault.jpg')) ||\r\n      artwork[artwork.length - 1];\r\n    if (preferred?.src && video.poster !== preferred.src) {\r\n      video.poster = preferred.src;\r\n    }\r\n  }\r\n\r\n  function deactivateMediaSessionForThisTab() {\r\n    if (!('mediaSession' in navigator) || !mediaSessionHandlersInstalled) {\r\n      return;\r\n    }\r\n    for (const action of [\r\n      'play',\r\n      'pause',\r\n      'seekbackward',\r\n      'seekforward',\r\n      'seekto',\r\n    ]) {\r\n      try {\r\n        navigator.mediaSession.setActionHandler(action, null);\r\n      } catch {}\r\n    }\r\n    try {\r\n      navigator.mediaSession.playbackState = 'none';\r\n      navigator.mediaSession.metadata = null;\r\n    } catch {}\r\n    mediaSessionHandlersInstalled = false;\r\n    lastMediaSessionHandlerInstallAt = 0;\r\n    lastMediaSessionMetadataKey = '';\r\n  }\r\n\r\n  function updateMediaSessionMetadata() {\r\n    if (\r\n      !('mediaSession' in navigator) ||\r\n      typeof MediaMetadata !== 'function' ||\r\n      location.pathname !== '/watch'\r\n    ) {\r\n      return;\r\n    }\r\n    if (!ownsMediaSession()) return;\r\n    const response = window.ytInitialPlayerResponse;\r\n    const details = response?.videoDetails || {};\r\n    const videoId =\r\n      details.videoId || new URL(location.href).searchParams.get('v') || '';\r\n    const title =\r\n      details.title ||\r\n      visibleVideoTitle() ||\r\n      metadataContent('meta[property=\"og:title\"]') ||\r\n      metadataContent('meta[name=\"title\"]') ||\r\n      document.title.replace(/\\s*-\\s*YouTube\\s*$/i, '').trim();\r\n    const artist =\r\n      details.author ||\r\n      document\r\n        .querySelector(\r\n          'ytd-video-owner-renderer #channel-name a, ' +\r\n            'ytd-watch-metadata #owner #channel-name a'\r\n        )\r\n        ?.textContent?.trim() ||\r\n      'YouTube';\r\n    const artwork = mediaSessionArtwork(videoId, response);\r\n    if (!title || !artwork.length) return;\r\n    const video = state.video || findVideo();\r\n    applyMediaArtworkPoster(video, artwork);\r\n    try {\r\n      navigator.mediaSession.playbackState =\r\n        video && !video.paused && !video.ended ? 'playing' : 'paused';\r\n    } catch {}\r\n    const metadataKey = JSON.stringify([\r\n      videoId,\r\n      title,\r\n      artist,\r\n      artwork.map((item) => item.src),\r\n    ]);\r\n    const currentMetadata = navigator.mediaSession.metadata;\r\n    const currentArtwork = Array.from(currentMetadata?.artwork || []);\r\n    const artworkStillApplied = currentArtwork.some((item) =>\r\n      artwork.some((candidate) => candidate.src === item.src)\r\n    );\r\n    const textStillApplied =\r\n      currentMetadata?.title?.trim() === title &&\r\n      currentMetadata?.artist?.trim() === artist;\r\n    if (\r\n      metadataKey === lastMediaSessionMetadataKey &&\r\n      artworkStillApplied &&\r\n      textStillApplied\r\n    ) {\r\n      return;\r\n    }\r\n\r\n    try {\r\n      navigator.mediaSession.metadata = new MediaMetadata({\r\n        title,\r\n        artist,\r\n        album: 'YouTube',\r\n        artwork,\r\n      });\r\n      lastMediaSessionMetadataKey = metadataKey;\r\n    } catch {\r\n      // Media artwork is optional in older Orion/WebKit releases.\r\n    }\r\n  }\r\n\r\n  function mediaSessionVideo() {\r\n    if (!ownsMediaSession()) return null;\r\n    const video = controllableVideo(true);\r\n    return video instanceof HTMLVideoElement ? video : null;\r\n  }\r\n\r\n  function syncMediaSessionPlayback(video = mediaSessionVideo()) {\r\n    if (ownsMediaSession()) {\r\n      try {\r\n        navigator.mediaSession.playbackState =\r\n          video && !video.paused && !video.ended ? 'playing' : 'paused';\r\n      } catch {\r\n        // playbackState is optional in older Orion/WebKit builds.\r\n      }\r\n    }\r\n    syncCustomPlayerControls();\r\n  }\r\n\r\n  function handleMediaSessionPlay() {\r\n    const video = mediaSessionVideo();\r\n    if (!video) return;\r\n    renewMediaSessionOwnership(video);\r\n    state.wantsPlayback = true;\r\n    state.userPauseUntil = 0;\r\n    configurePlaybackAudioSession();\r\n    try {\r\n      document.querySelector('#movie_player')?.playVideo?.();\r\n    } catch {\r\n      // Player API is optional; the media element path below remains authoritative.\r\n    }\r\n    safePlay(video);\r\n    syncMediaSessionPlayback(video);\r\n    setTimeout(() => syncMediaSessionPlayback(video), 0);\r\n    setTimeout(() => syncMediaSessionPlayback(video), 250);\r\n  }\r\n\r\n  function handleMediaSessionPause() {\r\n    const video = mediaSessionVideo();\r\n    if (!video) return;\r\n    renewMediaSessionOwnership(video);\r\n    state.wantsPlayback = false;\r\n    state.userPauseUntil = Date.now() + 5000;\r\n    clearRecoveryTimers();\r\n    try {\r\n      document.querySelector('#movie_player')?.pauseVideo?.();\r\n    } catch {\r\n      // Player API is optional; the native pause below remains authoritative.\r\n    }\r\n    // Bypass the background pause guard so Lock Screen / Dynamic Island\r\n    // pause always wins over background-audio recovery.\r\n    nativeMediaPause.call(video);\r\n    syncMediaSessionPlayback(video);\r\n    setTimeout(() => syncMediaSessionPlayback(video), 0);\r\n    setTimeout(() => syncMediaSessionPlayback(video), 250);\r\n  }\r\n\r\n  function handleMediaSessionSeek(offsetSeconds) {\r\n    const video = mediaSessionVideo();\r\n    if (!video || !Number.isFinite(offsetSeconds)) return;\r\n    const duration = Number.isFinite(video.duration)\r\n      ? video.duration\r\n      : Number.POSITIVE_INFINITY;\r\n    video.currentTime = Math.max(\r\n      0,\r\n      Math.min(duration, video.currentTime + offsetSeconds)\r\n    );\r\n    syncMediaSessionPlayback(video);\r\n  }\r\n\r\n  function installMediaSessionHandlers({ force = false } = {}) {\r\n    if (!('mediaSession' in navigator)) return;\r\n    if (!ownsMediaSession()) {\r\n      deactivateMediaSessionForThisTab();\r\n      return;\r\n    }\r\n    const now = Date.now();\r\n    if (\r\n      !force &&\r\n      mediaSessionHandlersInstalled &&\r\n      now - lastMediaSessionHandlerInstallAt < MEDIA_SESSION_REFRESH_MS\r\n    ) {\r\n      return;\r\n    }\r\n    updateMediaSessionMetadata();\r\n    try {\r\n      navigator.mediaSession.setActionHandler('play', handleMediaSessionPlay);\r\n      navigator.mediaSession.setActionHandler('pause', handleMediaSessionPause);\r\n      navigator.mediaSession.setActionHandler('seekbackward', (details) => {\r\n        handleMediaSessionSeek(-(details?.seekOffset || 10));\r\n      });\r\n      navigator.mediaSession.setActionHandler('seekforward', (details) => {\r\n        handleMediaSessionSeek(details?.seekOffset || 10);\r\n      });\r\n      navigator.mediaSession.setActionHandler('seekto', (details) => {\r\n        const video = mediaSessionVideo();\r\n        if (!video || details?.seekTime == null) return;\r\n        video.currentTime = details.seekTime;\r\n        syncMediaSessionPlayback(video);\r\n      });\r\n      mediaSessionHandlersInstalled = true;\r\n      lastMediaSessionHandlerInstallAt = now;\r\n    } catch {\r\n      // MediaSession or a particular action is optional in older iOS WebKit.\r\n    }\r\n  }\r\n\r\n  function prepareForBackground() {\r\n    const video = state.video || findVideo();\r\n    if (!video) return;\r\n    attachVideo(video);\r\n    if (!video.paused && !video.ended) claimMediaSessionOwnership(video);\r\n    installMediaSessionHandlers();\r\n    configurePlaybackAudioSession();\r\n    // Respect an intentional Now Playing / toolbar pause window so background\r\n    // recovery cannot immediately undo Lock Screen or Dynamic Island pause.\r\n    if (\r\n      !video.paused &&\r\n      !video.ended &&\r\n      Date.now() > state.userPauseUntil\r\n    ) {\r\n      state.wantsPlayback = true;\r\n    }\r\n    if (state.wantsPlayback) recoverPlayback(video);\r\n  }\r\n\r\n  const SKIP_BUTTON_SELECTOR = [\r\n    '.ytp-ad-skip-button',\r\n    '.ytp-ad-skip-button-modern',\r\n    '.ytp-skip-ad-button',\r\n    '.videoAdUiSkipButton',\r\n    'button[class*=\"ytp-ad-skip\"]',\r\n  ].join(',');\r\n\r\n  function restoreAdSkipTweaks() {\r\n    document.querySelectorAll('video[data-fyp-ad-skip-rate]').forEach((video) => {\r\n      const restored = Number(video.dataset.fypAdSkipRate);\r\n      if (Number.isFinite(restored) && restored > 0 && restored <= 4) {\r\n        video.playbackRate = restored;\r\n      } else {\r\n        video.playbackRate = 1;\r\n      }\r\n      delete video.dataset.fypAdSkipRate;\r\n    });\r\n  }\r\n\r\n  function playerIsSkippingAd(player) {\r\n    if (!(player instanceof Element)) return false;\r\n    if (\r\n      !player.classList.contains('ad-showing') &&\r\n      !player.classList.contains('ad-interrupting')\r\n    ) {\r\n      return false;\r\n    }\r\n    const duration = player.querySelector('video')?.duration;\r\n    return Boolean(\r\n      player.querySelector(AD_PLAYER_UI_SELECTOR) ||\r\n        (Number.isFinite(duration) &&\r\n          duration > 0 &&\r\n          duration <= MAX_AD_SEEK_DURATION_S)\r\n    );\r\n  }\r\n\r\n  function skipPlayerAd() {\r\n    document.querySelectorAll(SKIP_BUTTON_SELECTOR).forEach((button) => {\r\n      if (button instanceof HTMLElement) button.click();\r\n    });\r\n\r\n    const player = document.querySelector(AD_PLAYER_SELECTOR);\r\n    if (!playerIsSkippingAd(player)) {\r\n      restoreAdSkipTweaks();\r\n      const video = findVideo();\r\n      if (video) attachVideo(video);\r\n      return;\r\n    }\r\n\r\n    const adVideo = player.querySelector('video');\r\n    if (!(adVideo instanceof HTMLMediaElement)) return;\r\n    attachVideo(adVideo);\r\n    if (adVideo.dataset.fypAdSkipRate == null) {\r\n      adVideo.dataset.fypAdSkipRate = String(adVideo.playbackRate || 1);\r\n    }\r\n    const duration = adVideo.duration;\r\n    if (\r\n      Number.isFinite(duration) &&\r\n      duration > 0 &&\r\n      duration <= MAX_AD_SEEK_DURATION_S &&\r\n      adVideo.currentTime < duration\r\n    ) {\r\n      adVideo.currentTime = duration;\r\n    } else if (adVideo.playbackRate < 8) {\r\n      adVideo.playbackRate = 16;\r\n    }\r\n  }\r\n\r\n  const AD_BLOCK_ENFORCEMENT_PATTERN =\r\n    /ad blockers? (?:are not allowed|violate)|ad blocker.{0,40}youtube|video playback is blocked|disable (?:your )?ad blocker|allow youtube ads|ad-blocking software/i;\r\n\r\n  function guideDrawerIsBusy() {\r\n    /*\r\n     * Issue #1: hamburger close can leave YouTube's overlay lock behind.\r\n     * Treat the drawer as busy while it is open, opening, or peeking so we\r\n     * never clear overflow / scrim while the user is still in the menu.\r\n     * Read Polymer state only. Do not set opened / peeking / swipe.\r\n     */\r\n    const drawer = document.querySelector(\r\n      'tp-yt-app-drawer#guide, tp-yt-app-drawer'\r\n    );\r\n    if (!(drawer instanceof HTMLElement)) return false;\r\n    if (\r\n      drawer.hasAttribute('opened') ||\r\n      drawer.hasAttribute('opening') ||\r\n      drawer.hasAttribute('peeking')\r\n    ) {\r\n      return true;\r\n    }\r\n    try {\r\n      if (drawer.opened === true) return true;\r\n    } catch {\r\n      // Polymer may throw on unready custom elements.\r\n    }\r\n    return false;\r\n  }\r\n\r\n  function overlayHostIsOpen() {\r\n    return Boolean(\r\n      document.querySelector(\r\n        'tp-yt-paper-dialog[opened], tp-yt-iron-dropdown[opened], ' +\r\n          'iron-dropdown[opened]'\r\n      )\r\n    );\r\n  }\r\n\r\n  function removeOrphanAdBackdrops() {\r\n    /*\r\n     * Ad-blocker dialogs share YouTube's iron overlay backdrop class with the\r\n     * hamburger drawer. Only remove backdrops that are not inside the drawer\r\n     * and only when no dialog or drawer is open.\r\n     */\r\n    if (guideDrawerIsBusy() || overlayHostIsOpen()) return;\r\n    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((backdrop) => {\r\n      if (!(backdrop instanceof HTMLElement)) return;\r\n      if (backdrop.closest('tp-yt-app-drawer')) return;\r\n      backdrop.remove();\r\n    });\r\n  }\r\n\r\n  function restoreScrollAfterGuideClose() {\r\n    /*\r\n     * After close, Polymer may keep overflow:hidden on html/body/ytd-app\r\n     * because the mini-guide rail we hide is the state it expects to restore.\r\n     * Clear that leftover lock. CSS hides leftover #scrim separately.\r\n     */\r\n    if (guideDrawerIsBusy() || overlayHostIsOpen()) return;\r\n\r\n    for (const node of [\r\n      document.documentElement,\r\n      document.body,\r\n      document.querySelector('ytd-app'),\r\n      document.querySelector('ytm-app'),\r\n      document.querySelector('ytd-page-manager'),\r\n    ]) {\r\n      if (!(node instanceof HTMLElement)) continue;\r\n      if (node.style.overflow === 'hidden' || node.style.overflowY === 'hidden') {\r\n        node.style.removeProperty('overflow');\r\n        node.style.removeProperty('overflow-y');\r\n      }\r\n    }\r\n\r\n    const app = document.querySelector('ytd-app');\r\n    if (\r\n      app instanceof HTMLElement &&\r\n      app.getAttribute('aria-hidden') === 'true'\r\n    ) {\r\n      app.removeAttribute('aria-hidden');\r\n    }\r\n  }\r\n\r\n  function dismissAdBlockEnforcement(root = document) {\r\n    let removed = false;\r\n    const candidates = root.querySelectorAll?.(\r\n      [\r\n        'ytd-enforcement-message-view-model',\r\n        'yt-playability-error-supported-renderers',\r\n        '#error-screen',\r\n        'tp-yt-paper-dialog',\r\n      ].join(',')\r\n    );\r\n    for (const candidate of candidates || []) {\r\n      const text = (candidate.textContent || '').replace(/\\s+/g, ' ').trim();\r\n      if (!AD_BLOCK_ENFORCEMENT_PATTERN.test(text)) continue;\r\n      const dialog = candidate.closest('tp-yt-paper-dialog') || candidate;\r\n      dialog.remove();\r\n      removed = true;\r\n    }\r\n    if (!removed) return;\r\n\r\n    removeOrphanAdBackdrops();\r\n    restoreScrollAfterGuideClose();\r\n\r\n    const video = findVideo();\r\n    if (video && video.paused && !video.ended && video.readyState > 0) {\r\n      attachVideo(video);\r\n      state.wantsPlayback = true;\r\n      state.userPauseUntil = 0;\r\n      safePlay(video);\r\n    }\r\n  }\r\n\r\n  function removeAdCards(root = document) {\r\n    const selector = [\r\n      'ytm-promoted-sparkles-web-renderer',\r\n      'ytm-companion-ad-renderer',\r\n      'ytm-display-ad-renderer',\r\n      'ytm-promoted-video-renderer',\r\n      'ytm-ad-slot-renderer',\r\n      'ytd-companion-slot-renderer',\r\n      'ytd-companion-ad-renderer',\r\n      'ytd-action-companion-ad-renderer',\r\n      'ytd-banner-promo-renderer-background',\r\n      'ytd-video-masthead-ad-v3-renderer',\r\n      'ytd-video-masthead-ad-renderer',\r\n      'ytd-video-masthead-ad-primary-video-renderer',\r\n      'ytd-in-feed-ad-layout-renderer',\r\n      'ytd-promoted-sparkles-web-renderer',\r\n      'ytd-promoted-sparkles-text-search-renderer',\r\n      'ytd-display-ad-renderer',\r\n      'ytd-promoted-video-renderer',\r\n      'ytd-ad-slot-renderer',\r\n      'ytd-banner-promo-renderer',\r\n      'ytd-statement-banner-renderer',\r\n      '.ytp-ad-overlay-container',\r\n      '.ytp-ad-message-container',\r\n      '.ytp-ad-module',\r\n      '.ytp-ad-overlay-slot',\r\n      '.video-ads',\r\n      '#player-ads',\r\n      '#masthead-ad',\r\n    ].join(',');\r\n    root.querySelectorAll?.(selector).forEach((element) => element.remove());\r\n  }\r\n\r\n  function injectStyle() {\r\n    let style = document.getElementById(STYLE_ID);\r\n    if (!style) {\r\n      style = document.createElement('style');\r\n      style.id = STYLE_ID;\r\n      const styleHost = document.head || document.documentElement;\r\n      if (styleHost) styleHost.appendChild(style);\r\n    }\r\n    if (style.dataset.layoutVersion === NAV_LAYOUT_VERSION) return;\r\n    style.dataset.layoutVersion = NAV_LAYOUT_VERSION;\r\n    style.textContent = `\r\n      ytm-promoted-sparkles-web-renderer,\r\n      ytm-companion-ad-renderer,\r\n      ytm-display-ad-renderer,\r\n      ytm-promoted-video-renderer,\r\n      ytm-ad-slot-renderer,\r\n      ytd-companion-slot-renderer,\r\n      ytd-companion-ad-renderer,\r\n      ytd-action-companion-ad-renderer,\r\n      ytd-banner-promo-renderer-background,\r\n      ytd-video-masthead-ad-v3-renderer,\r\n      ytd-video-masthead-ad-renderer,\r\n      ytd-video-masthead-ad-primary-video-renderer,\r\n      ytd-in-feed-ad-layout-renderer,\r\n      ytd-promoted-sparkles-web-renderer,\r\n      ytd-promoted-sparkles-text-search-renderer,\r\n      ytd-display-ad-renderer,\r\n      ytd-promoted-video-renderer,\r\n      ytd-ad-slot-renderer,\r\n      ytd-banner-promo-renderer,\r\n      ytd-statement-banner-renderer,\r\n      .ytp-ad-overlay-container,\r\n      .ytp-ad-message-container,\r\n      .ytp-ad-player-overlay,\r\n      .ytp-ad-module,\r\n      .ytp-ad-overlay-slot,\r\n      .video-ads,\r\n      #player-ads,\r\n      #masthead-ad {\r\n        display: none !important;\r\n        visibility: hidden !important;\r\n        pointer-events: none !important;\r\n      }\r\n\r\n      /* Burger drawer only — hide every persistent Home/Shorts/Subs/You rail and mini-games. */\r\n      ytm-pivot-bar-renderer,\r\n      ytd-mini-guide-renderer,\r\n      ytd-mini-guide-entry-renderer,\r\n      #guide-button-badge,\r\n      ytd-guide-entry-renderer:has(a[href^='/shorts']),\r\n      ytd-guide-entry-renderer:has(a[href*='/playables']),\r\n      ytd-guide-entry-renderer:has(a[title*='Playables' i]),\r\n      ytd-mini-guide-entry-renderer:has(a[href^='/shorts']),\r\n      ytd-mini-guide-entry-renderer:has(a[href*='/playables']),\r\n      ytd-guide-entry-renderer:has(a[title='Shorts']),\r\n      tp-yt-paper-item:has(a[href^='/shorts']),\r\n      tp-yt-paper-item:has(a[href*='/playables']),\r\n      ytd-rich-shelf-renderer:has(a[href*='/shorts']),\r\n      ytd-rich-shelf-renderer:has(a[href*='/playables']),\r\n      ytd-rich-shelf-renderer:has([title*='Playables' i]),\r\n      ytd-rich-shelf-renderer:has([aria-label*='Playables' i]),\r\n      ytd-reel-shelf-renderer,\r\n      ytd-rich-section-renderer:has(a[href*='/shorts']),\r\n      ytd-rich-section-renderer:has(a[href*='/playables']),\r\n      ytd-rich-section-renderer:has([title*='Playables' i]),\r\n      ytd-rich-section-renderer:has([aria-label*='Playables' i]),\r\n      ytm-reel-shelf-renderer,\r\n      ytm-shorts-lockup-view-model,\r\n      ytm-shorts-lockup-view-model-v2,\r\n      ytd-reel-item-renderer,\r\n      ytm-reel-item-renderer,\r\n      ytd-rich-item-renderer:has(a[href*='/shorts']),\r\n      ytd-rich-item-renderer:has(a[href*='/playables']),\r\n      yt-lockup-view-model:has(a[href*='/shorts']),\r\n      yt-lockup-view-model:has(a[href*='/playables']),\r\n      grid-shelf-view-model:has(a[href*='/shorts']),\r\n      grid-shelf-view-model:has(a[href*='/playables']),\r\n      grid-shelf-view-model:has([title*='Playables' i]),\r\n      grid-shelf-view-model:has([aria-label*='Playables' i]),\r\n      yt-playable-game-renderer,\r\n      ytd-game-card-renderer,\r\n      ytd-playable-renderer,\r\n      ytd-playables-shelf-renderer,\r\n      yt-playables-shelf-renderer,\r\n      yt-chip-cloud-chip-renderer:has(yt-formatted-string[title*='Playables' i]),\r\n      yt-chip-cloud-chip-renderer:has([title*='Playables' i]),\r\n      ytd-browse[page-subtype='channels'] yt-tab-shape:has(a[href$='/shorts']),\r\n      ytd-browse[page-subtype='channels'] [role='tab']:has(a[href$='/shorts']),\r\n      ytd-browse[page-subtype='channels'] ytd-rich-item-renderer:has(a[href*='/shorts']),\r\n      ytd-browse[page-subtype='channels'] ytd-grid-video-renderer:has(a[href*='/shorts']),\r\n      ytd-browse[page-subtype='channels'] yt-lockup-view-model:has(a[href*='/shorts']),\r\n      ytd-browse[page-subtype='channels'] ytd-reel-shelf-renderer,\r\n      ytd-browse[page-subtype='channels'] ytd-rich-shelf-renderer:has(a[href*='/shorts']),\r\n      a[href^='/shorts'],\r\n      a[href*='youtube.com/shorts/'],\r\n      a[href^='/playables'],\r\n      a[href*='youtube.com/playables'],\r\n      [is-shorts],\r\n      [is-playables],\r\n      [is-playable],\r\n      ytd-thumbnail[href*='/shorts'],\r\n      ytd-thumbnail[href*='/playables'] {\r\n        display: none !important;\r\n        visibility: hidden !important;\r\n        pointer-events: none !important;\r\n      }\r\n\r\n      /*\r\n       * Stabilize guide sidebar scrolling:\r\n       * Prevent vertical scroll gestures inside the drawer from chaining to\r\n       * window or triggering Polymer's swipe-to-close gesture.\r\n       */\r\n      tp-yt-app-drawer#guide {\r\n        touch-action: pan-y !important;\r\n      }\r\n      tp-yt-app-drawer#guide #contentContainer {\r\n        touch-action: pan-y !important;\r\n        overscroll-behavior: contain !important;\r\n        overscroll-behavior-y: contain !important;\r\n      }\r\n      tp-yt-app-drawer#guide ytd-guide-renderer,\r\n      tp-yt-app-drawer#guide #guide-wrapper,\r\n      tp-yt-app-drawer#guide #guide-inner-content,\r\n      tp-yt-app-drawer#guide #sections,\r\n      tp-yt-app-drawer#guide #items {\r\n        touch-action: pan-y !important;\r\n        overscroll-behavior: contain !important;\r\n        overscroll-behavior-y: contain !important;\r\n        -webkit-overflow-scrolling: touch !important;\r\n      }\r\n\r\n      ytd-app {\r\n        --ytd-mini-guide-width: 0px !important;\r\n        --ytd-mini-guide-width-min: 0px !important;\r\n      }\r\n\r\n      ytd-app[guide-persistent],\r\n      ytd-app[mini-guide-visible] {\r\n        --ytd-mini-guide-width: 0px !important;\r\n        --ytd-mini-guide-width-min: 0px !important;\r\n      }\r\n\r\n      /*\r\n       * 3.1.0 / issue #1: Closing the hamburger can leave #scrim painted over\r\n       * the page (grey overlay + no scroll) because the mini-guide rail is\r\n       * hidden. Hide leftover scrim only when the drawer is not open,\r\n       * opening, or peeking. Do not touch opened / peeking / swipe attributes.\r\n       */\r\n      tp-yt-app-drawer#guide:not([opened]):not([opening]):not([peeking]) #scrim,\r\n      tp-yt-app-drawer:not([opened]):not([opening]):not([peeking]) > #scrim {\r\n        pointer-events: none !important;\r\n        opacity: 0 !important;\r\n        visibility: hidden !important;\r\n      }\r\n\r\n      /* Kill YouTube miniplayer when leaving a video. */\r\n      ytd-miniplayer,\r\n      ytd-miniplayer[active],\r\n      #miniplayer,\r\n      #miniplayer-container,\r\n      .ytp-miniplayer-ui,\r\n      ytd-app[miniplayer-active_] #movie_player,\r\n      .miniplayer {\r\n        display: none !important;\r\n        visibility: hidden !important;\r\n        pointer-events: none !important;\r\n        width: 0 !important;\r\n        height: 0 !important;\r\n        opacity: 0 !important;\r\n      }\r\n\r\n      /* Force the guide (burger) button to stay visible on narrow Orion layouts.\r\n         Do NOT force the drawer itself visible — that makes it peek while scrolling. */\r\n      #guide-button,\r\n      ytd-masthead #guide-button,\r\n      #guide-button-icon,\r\n      button#button.yt-icon-button[aria-label='Guide'],\r\n      ytd-masthead button[aria-label='Guide'] {\r\n        display: inline-flex !important;\r\n        visibility: visible !important;\r\n        opacity: 1 !important;\r\n        pointer-events: auto !important;\r\n        width: 40px !important;\r\n        min-width: 40px !important;\r\n        height: 40px !important;\r\n      }\r\n\r\n      /* Remove header upload / create. */\r\n      ytd-masthead ytd-topbar-menu-button-renderer:has(a[href*='upload']),\r\n      ytd-masthead ytd-button-renderer:has(a[href*='upload']),\r\n      ytd-masthead a[href='/upload'],\r\n      ytd-masthead a[href*='upload?'],\r\n      ytd-masthead button[aria-label='Create'],\r\n      ytd-masthead button[aria-label*='Create a video'],\r\n      ytd-masthead [aria-label='Upload video'],\r\n      ytd-masthead [aria-label='Upload'],\r\n      #masthead-upload-button,\r\n      ytm-mobile-topbar-renderer button[aria-label*='Upload'],\r\n      ytm-mobile-topbar-renderer button[aria-label*='Create'],\r\n      ytm-mobile-topbar-renderer a[href*='upload'],\r\n      ytm-topbar-menu-button-renderer:has([aria-label*='Upload']),\r\n      ytm-topbar-menu-button-renderer:has([aria-label*='Create']) {\r\n        display: none !important;\r\n        visibility: hidden !important;\r\n        pointer-events: none !important;\r\n        width: 0 !important;\r\n        min-width: 0 !important;\r\n        margin: 0 !important;\r\n        padding: 0 !important;\r\n        overflow: hidden !important;\r\n      }\r\n\r\n      /*\r\n       * Desktop YouTube has a 426px minimum watch-column width. On an iPhone it\r\n       * centers that wider column and cuts roughly 18px from the left edge.\r\n       * Collapse only the content column at phone widths; the desktop player\r\n       * and data model stay untouched.\r\n       *\r\n       * 2.2.9: also clip overflow on ytd-app / page-manager (html/body alone\r\n       * does not stop WebKit horizontal swipe when a child paints past 100vw).\r\n       * Prefer max-width: 100% over 100vw to avoid the classic vw+padding bleed.\r\n       */\r\n      @media (max-width: 700px) {\r\n        html,\r\n        body,\r\n        ytd-app,\r\n        ytm-app,\r\n        ytd-page-manager,\r\n        #content.ytd-app,\r\n        #page-manager,\r\n        ytd-watch-flexy,\r\n        ytd-watch-flexy #columns {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n        }\r\n\r\n        html,\r\n        body,\r\n        ytd-app,\r\n        ytm-app,\r\n        ytd-page-manager,\r\n        #content.ytd-app,\r\n        #page-manager {\r\n          overflow-x: hidden !important;\r\n          overscroll-behavior-x: none !important;\r\n        }\r\n\r\n        @supports (overflow: clip) {\r\n          html,\r\n          body,\r\n          ytd-app,\r\n          ytm-app,\r\n          ytd-page-manager,\r\n          #content.ytd-app,\r\n          #page-manager {\r\n            overflow-x: clip !important;\r\n          }\r\n        }\r\n\r\n        /* Cap desktop shells that still paint wider than the phone viewport. */\r\n        ytd-browse,\r\n        ytd-search,\r\n        ytd-two-column-browse-results-renderer,\r\n        ytd-two-column-search-results-renderer,\r\n        #masthead-container,\r\n        ytd-masthead,\r\n        #columns,\r\n        #primary,\r\n        #secondary,\r\n        #primary-inner,\r\n        #secondary-inner {\r\n          box-sizing: border-box !important;\r\n          max-width: 100% !important;\r\n          min-width: 0 !important;\r\n        }\r\n\r\n        /* Watch must stack: player → title → FYP buttons (never side-by-side). */\r\n        ytd-watch-flexy {\r\n          --ytd-watch-flexy-height-for-player: auto !important;\r\n          --ytd-watch-flexy-max-player-height: none !important;\r\n        }\r\n\r\n        ytd-watch-flexy #columns {\r\n          display: flex !important;\r\n          flex-direction: column !important;\r\n          align-items: stretch !important;\r\n          gap: 0 !important;\r\n          row-gap: 0 !important;\r\n        }\r\n\r\n        ytd-watch-flexy #secondary,\r\n        ytd-watch-flexy #secondary-inner {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          min-height: 0 !important;\r\n          height: auto !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n        }\r\n\r\n        ytd-watch-flexy[is-single-column] #primary,\r\n        ytd-watch-flexy #primary {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          min-height: 0 !important;\r\n          margin: 0 !important;\r\n          padding: 0 12px !important;\r\n        }\r\n\r\n        /*\r\n         * Keep the player footprint tight to the video. Desktop theater /\r\n         * full-bleed CSS vars otherwise reserve a tall empty region under the\r\n         * video before title + transport controls. Only the active shell gets\r\n         * a 16:9 box — the unused sibling collapses to zero.\r\n         */\r\n        ytd-watch-flexy[full-bleed-player] #player-full-bleed-container,\r\n        ytd-watch-flexy:not([full-bleed-player]) #player,\r\n        ytd-watch-flexy:not([full-bleed-player]) #player-container-outer {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          height: auto !important;\r\n          min-height: 0 !important;\r\n          max-height: none !important;\r\n          margin: 0 !important;\r\n          aspect-ratio: 16 / 9 !important;\r\n          float: none !important;\r\n          clear: both !important;\r\n        }\r\n\r\n        ytd-watch-flexy #player-container-inner,\r\n        ytd-watch-flexy ytd-player {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          height: 100% !important;\r\n          min-height: 0 !important;\r\n          margin: 0 !important;\r\n          float: none !important;\r\n          clear: both !important;\r\n        }\r\n\r\n        /* Collapse whichever shell is not hosting the video. */\r\n        ytd-watch-flexy:not([full-bleed-player]) #player-full-bleed-container,\r\n        ytd-watch-flexy[full-bleed-player] #columns #player,\r\n        ytd-watch-flexy[theater] #columns #player {\r\n          height: 0 !important;\r\n          min-height: 0 !important;\r\n          max-height: 0 !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n          overflow: hidden !important;\r\n          border: 0 !important;\r\n          aspect-ratio: auto !important;\r\n        }\r\n\r\n        ytd-watch-flexy #primary-inner,\r\n        ytd-watch-flexy #below,\r\n        ytd-watch-flexy ytd-watch-metadata,\r\n        ytd-watch-flexy #panels {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          min-height: 0 !important;\r\n          margin-top: 0 !important;\r\n          float: none !important;\r\n          clear: both !important;\r\n        }\r\n\r\n        ytd-watch-flexy ytd-watch-metadata #title,\r\n        ytd-watch-flexy ytd-watch-metadata h1 {\r\n          display: block !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          margin-top: clamp(.35rem, 1.5vw, .55rem) !important;\r\n          margin-bottom: 0 !important;\r\n        }\r\n\r\n        ytd-watch-flexy ytd-menu-renderer,\r\n        ytd-watch-flexy #actions,\r\n        ytd-watch-flexy #actions-inner,\r\n        ytd-watch-flexy #menu {\r\n          max-width: 100% !important;\r\n        }\r\n\r\n        /*\r\n         * Native playlist panel lives in #secondary on desktop. After the\r\n         * phone stack moves it under the description, keep it full-width and\r\n         * cap the video list so it does not push comments off-screen.\r\n         */\r\n        ytd-watch-flexy #below ytd-playlist-panel-renderer,\r\n        ytd-watch-flexy #below #playlist {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          visibility: visible !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          height: auto !important;\r\n          margin: 8px 0 0 !important;\r\n          overflow: visible !important;\r\n        }\r\n\r\n        ytd-watch-flexy #below ytd-playlist-panel-renderer #items {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          max-height: min(42vh, 22rem) !important;\r\n          overflow-x: hidden !important;\r\n          overflow-y: auto !important;\r\n        }\r\n\r\n        /*\r\n         * Playlist browse pages keep a desktop sidebar header. Stack the\r\n         * header/description above the video list so the playlist does not\r\n         * leave the phone viewport.\r\n         */\r\n        ytd-browse[page-subtype='playlist'],\r\n        ytd-browse[page-subtype='playlist']\r\n          ytd-two-column-browse-results-renderer,\r\n        ytd-browse[page-subtype='playlist'] #primary,\r\n        ytd-browse[page-subtype='playlist'] #secondary,\r\n        ytd-browse[page-subtype='playlist'] ytd-playlist-header-renderer,\r\n        ytd-browse[page-subtype='playlist'] yt-page-header-renderer {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin-left: 0 !important;\r\n          margin-right: 0 !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='playlist'] ytd-playlist-header-renderer,\r\n        ytd-browse[page-subtype='playlist'] yt-page-header-renderer {\r\n          position: relative !important;\r\n          height: auto !important;\r\n        }\r\n\r\n        /*\r\n         * Search-only screenshot stack:\r\n         * channel → thumbnail → snippet → badges → views → title+menu → chapters.\r\n         * Flatten nested wrappers so those nodes can take named grid areas.\r\n         * Never target Home feed lockups.\r\n         */\r\n        ytd-search,\r\n        ytd-search ytd-two-column-search-results-renderer,\r\n        ytd-search #primary,\r\n        ytd-search #contents {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer,\r\n        ytd-search ytd-rich-item-renderer:has(a[href*='/watch']),\r\n        ytd-search yt-lockup-view-model:has(a[href*='/watch']) {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin: 0 0 14px !important;\r\n          padding: 0 !important;\r\n          max-height: none !important;\r\n          height: auto !important;\r\n          overflow: visible !important;\r\n          --ytd-thumbnail-width: 100% !important;\r\n          --ytd-thumbnail-max-width: 100% !important;\r\n          --yt-thumbnail-width: 100% !important;\r\n          --yt-thumbnail-max-width: 100% !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer #dismissible.ytd-video-renderer,\r\n        ytd-search ytd-video-renderer #dismissible,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          :is(\r\n            .yt-lockup-view-model,\r\n            .ytLockupViewModelHost,\r\n            .ytLockupViewModelHorizontal,\r\n            .yt-lockup-view-model-wiz\r\n          ) {\r\n          box-sizing: border-box !important;\r\n          display: grid !important;\r\n          grid-template-columns: minmax(0, 1fr) auto !important;\r\n          grid-template-areas:\r\n            \"channel channel\"\r\n            \"thumb thumb\"\r\n            \"snippet snippet\"\r\n            \"badges badges\"\r\n            \"views views\"\r\n            \"title menu\"\r\n            \"chapters chapters\" !important;\r\n          align-items: start !important;\r\n          justify-items: stretch !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          column-gap: 0 !important;\r\n          row-gap: 6px !important;\r\n          max-height: none !important;\r\n          height: auto !important;\r\n          overflow: visible !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer ytd-thumbnail.ytd-video-renderer,\r\n        ytd-search ytd-video-renderer ytd-thumbnail,\r\n        ytd-search ytd-rich-item-renderer ytd-thumbnail,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          ytd-thumbnail,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          yt-thumbnail-view-model,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          [class*='content-image' i],\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          [class*='ContentImage'] {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          position: relative !important;\r\n          grid-area: thumb !important;\r\n          flex: 0 0 auto !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          height: auto !important;\r\n          max-height: none !important;\r\n          min-height: 0 !important;\r\n          margin: 0 !important;\r\n          overflow: hidden !important;\r\n          border-radius: 12px !important;\r\n          aspect-ratio: 16 / 9 !important;\r\n          visibility: visible !important;\r\n          opacity: 1 !important;\r\n          inset: auto !important;\r\n          left: auto !important;\r\n          top: auto !important;\r\n          transform: none !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer ytd-thumbnail::before {\r\n          display: none !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer a#thumbnail {\r\n          position: absolute !important;\r\n          inset: 0 !important;\r\n          width: 100% !important;\r\n          height: 100% !important;\r\n          margin: 0 !important;\r\n          aspect-ratio: auto !important;\r\n          border-radius: inherit !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer ytd-thumbnail yt-image,\r\n        ytd-search ytd-video-renderer a#thumbnail yt-image,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          yt-thumbnail-view-model yt-image,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          [class*='content-image' i] yt-image {\r\n          position: absolute !important;\r\n          inset: 0 !important;\r\n          display: block !important;\r\n          width: 100% !important;\r\n          height: 100% !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer ytd-thumbnail img,\r\n        ytd-search ytd-video-renderer a#thumbnail img,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          yt-thumbnail-view-model img,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          [class*='content-image' i] img,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          [class*='ContentImage'] img {\r\n          position: absolute !important;\r\n          inset: 0 !important;\r\n          display: block !important;\r\n          width: 100% !important;\r\n          height: 100% !important;\r\n          max-width: none !important;\r\n          max-height: none !important;\r\n          object-fit: cover !important;\r\n          visibility: visible !important;\r\n          opacity: 1 !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer #details,\r\n        ytd-search ytd-video-renderer #meta,\r\n        ytd-search ytd-video-renderer ytd-video-meta-block,\r\n        ytd-search ytd-video-renderer #title-wrapper,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          yt-lockup-metadata-view-model,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          :is(\r\n            .yt-lockup-metadata-view-model,\r\n            .ytLockupMetadataViewModelHost,\r\n            .yt-content-metadata-view-model,\r\n            .ytContentMetadataViewModelHost\r\n          ) {\r\n          display: contents !important;\r\n        }\r\n\r\n        /*\r\n         * One channel row only. Desktop search keeps a byline name in\r\n         * addition to #channel-info; showing both duplicates the name.\r\n         */\r\n        ytd-search ytd-video-renderer ytd-video-meta-block #byline-container {\r\n          display: none !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer #channel-info,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          :is(\r\n            .yt-content-metadata-view-model__metadata-row,\r\n            .ytContentMetadataViewModelMetadataRow\r\n          ):first-of-type {\r\n          grid-area: channel !important;\r\n          display: flex !important;\r\n          visibility: visible !important;\r\n          align-items: center !important;\r\n          gap: 8px !important;\r\n          max-width: 100% !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n          overflow: visible !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer #channel-info yt-img-shadow,\r\n        ytd-search ytd-video-renderer #avatar,\r\n        ytd-search ytd-video-renderer #avatar-link,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          yt-decorated-avatar-view-model {\r\n          display: inline-flex !important;\r\n          flex: 0 0 24px !important;\r\n          align-self: center !important;\r\n          visibility: visible !important;\r\n          width: 24px !important;\r\n          height: 24px !important;\r\n          min-width: 24px !important;\r\n          min-height: 24px !important;\r\n          max-width: 24px !important;\r\n          max-height: 24px !important;\r\n          aspect-ratio: 1 / 1 !important;\r\n          overflow: hidden !important;\r\n          border-radius: 50% !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer #channel-info img,\r\n        ytd-search ytd-video-renderer #avatar img,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          yt-decorated-avatar-view-model img,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          yt-decorated-avatar-view-model yt-image {\r\n          position: static !important;\r\n          inset: auto !important;\r\n          display: block !important;\r\n          width: 100% !important;\r\n          height: 100% !important;\r\n          max-width: 24px !important;\r\n          max-height: 24px !important;\r\n          aspect-ratio: 1 / 1 !important;\r\n          object-fit: cover !important;\r\n          border-radius: 50% !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer #description-text,\r\n        ytd-search ytd-video-renderer .metadata-snippet-container,\r\n        ytd-search ytd-video-renderer #description-inner,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          :is(\r\n            .yt-lockup-metadata-view-model__description,\r\n            .ytLockupMetadataViewModelDescription\r\n          ) {\r\n          grid-area: snippet !important;\r\n          display: -webkit-box !important;\r\n          visibility: visible !important;\r\n          -webkit-line-clamp: 1 !important;\r\n          -webkit-box-orient: vertical !important;\r\n          max-width: 100% !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n          overflow: hidden !important;\r\n          font-size: 12px !important;\r\n          line-height: 1.35 !important;\r\n          opacity: 0.82 !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer ytd-badge-supported-renderer,\r\n        ytd-search ytd-video-renderer yt-badge-view-model,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          yt-badge-view-model {\r\n          grid-area: badges !important;\r\n          display: flex !important;\r\n          visibility: visible !important;\r\n          flex-wrap: wrap !important;\r\n          gap: 6px !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer #metadata-line,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          :is(\r\n            .yt-content-metadata-view-model__metadata-row,\r\n            .ytContentMetadataViewModelMetadataRow\r\n          ):not(:first-of-type) {\r\n          grid-area: views !important;\r\n          display: block !important;\r\n          visibility: visible !important;\r\n          max-width: 100% !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n          overflow: hidden !important;\r\n          font-size: 12px !important;\r\n          line-height: 1.3 !important;\r\n          opacity: 0.85 !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer h3 {\r\n          grid-area: title !important;\r\n          display: block !important;\r\n          max-height: none !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n          overflow: visible !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer #video-title,\r\n        ytd-search ytd-video-renderer h3 #video-title,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          :is(\r\n            .yt-lockup-metadata-view-model__title,\r\n            .ytLockupMetadataViewModelTitle\r\n          ) {\r\n          grid-area: title !important;\r\n          display: -webkit-box !important;\r\n          -webkit-line-clamp: 2 !important;\r\n          -webkit-box-orient: vertical !important;\r\n          max-height: none !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n          overflow: hidden !important;\r\n          white-space: normal !important;\r\n          text-overflow: ellipsis !important;\r\n          font-size: clamp(16px, 4.4vw, 18px) !important;\r\n          font-weight: 700 !important;\r\n          line-height: 1.25 !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer #menu {\r\n          grid-area: menu !important;\r\n          position: static !important;\r\n          align-self: start !important;\r\n          justify-self: end !important;\r\n          margin: 0 !important;\r\n        }\r\n\r\n        ytd-search ytd-video-renderer ytd-expandable-metadata-renderer,\r\n        ytd-search\r\n          yt-lockup-view-model:has(a[href*='/watch'])\r\n          ytd-expandable-metadata-renderer {\r\n          grid-area: chapters !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          margin: 2px 0 0 !important;\r\n        }\r\n\r\n        /* Kill AI Summary / Ask chips and preview panels. Keep chapters. */\r\n        ytd-search button[aria-label*='Summary' i],\r\n        ytd-search button[aria-label*='Ask' i],\r\n        ytd-search [aria-label*='AI summary' i],\r\n        ytd-search [aria-label*='AI overview' i],\r\n        ytd-search ytd-button-renderer:has([aria-label*='Summary' i]),\r\n        ytd-search ytd-button-renderer:has([aria-label*='Ask' i]),\r\n        ytd-search ytd-info-panel-container-renderer,\r\n        ytd-search ytd-clarification-renderer,\r\n        ytd-search\r\n          ytd-expandable-metadata-renderer:has([aria-label*='Summary' i]),\r\n        ytd-search\r\n          ytd-expandable-metadata-renderer:has([aria-label*='AI' i]) {\r\n          display: none !important;\r\n          visibility: hidden !important;\r\n          pointer-events: none !important;\r\n          height: 0 !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n          overflow: hidden !important;\r\n        }\r\n\r\n        ytd-rich-grid-renderer {\r\n          --ytd-rich-grid-items-per-row: 1 !important;\r\n          --ytd-rich-grid-posts-per-row: 1 !important;\r\n        }\r\n\r\n        ytd-rich-grid-row,\r\n        ytd-rich-item-renderer {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          margin-left: 0 !important;\r\n          margin-right: 0 !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='channels'],\r\n        ytd-browse[page-subtype='channels'] #primary,\r\n        ytd-browse[page-subtype='channels']\r\n          ytd-two-column-browse-results-renderer,\r\n        ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer,\r\n        ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer #contents {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin-right: 0 !important;\r\n          margin-left: 0 !important;\r\n          overflow-x: hidden !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer {\r\n          --ytd-rich-grid-items-per-row: 1 !important;\r\n          --ytd-rich-grid-posts-per-row: 1 !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='channels'] ytd-rich-grid-row,\r\n        ytd-browse[page-subtype='channels'] ytd-rich-item-renderer,\r\n        ytd-browse[page-subtype='channels'] ytd-grid-video-renderer,\r\n        ytd-browse[page-subtype='channels'] ytd-video-renderer,\r\n        ytd-browse[page-subtype='channels']\r\n          ytd-channel-video-player-renderer,\r\n        ytd-browse[page-subtype='channels'] yt-lockup-view-model,\r\n        ytd-browse[page-subtype='channels'] ytd-thumbnail {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin-right: 0 !important;\r\n          margin-left: 0 !important;\r\n        }\r\n\r\n        /*\r\n         * History: Home-like equal gutters, centered cards/chips, title under\r\n         * thumbnail, channel avatar restored, Clear/Pause/Manage/Search kept.\r\n         */\r\n        ytd-browse[page-subtype='history'],\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          overflow-x: hidden !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history']\r\n          ytd-two-column-browse-results-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          ytd-two-column-browse-results-renderer {\r\n          box-sizing: border-box !important;\r\n          display: flex !important;\r\n          flex-direction: column !important;\r\n          align-items: center !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin: 0 auto !important;\r\n          padding: 0 12px !important;\r\n          overflow-x: hidden !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history'] #primary,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #primary,\r\n        ytd-browse[page-subtype='history'] #secondary,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary,\r\n        ytd-browse[page-subtype='history'] #secondary-inner,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary-inner,\r\n        ytd-browse[page-subtype='history'] ytd-section-list-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-section-list-renderer,\r\n        ytd-browse[page-subtype='history'] ytd-item-section-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-item-section-renderer,\r\n        ytd-browse[page-subtype='history'] ytd-rich-grid-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-rich-grid-renderer,\r\n        ytd-browse[page-subtype='history'] ytd-rich-grid-renderer #contents,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          ytd-rich-grid-renderer #contents {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin-left: auto !important;\r\n          margin-right: auto !important;\r\n          padding-left: 0 !important;\r\n          padding-right: 0 !important;\r\n        }\r\n\r\n        /* Keep History tools above the list and centered. */\r\n        ytd-browse[page-subtype='history'] #secondary,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary,\r\n        ytd-browse[page-subtype='history'] #secondary-inner,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary-inner,\r\n        ytd-browse[page-subtype='history'] ytd-browse-feed-actions-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          ytd-browse-feed-actions-renderer {\r\n          display: flex !important;\r\n          visibility: visible !important;\r\n          flex-direction: column !important;\r\n          align-items: center !important;\r\n          order: -1 !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          position: static !important;\r\n          margin: 0 auto 8px !important;\r\n          padding: 0 !important;\r\n          text-align: center !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history'] #secondary input,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary input,\r\n        ytd-browse[page-subtype='history'] #secondary yt-searchbox,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary yt-searchbox,\r\n        ytd-browse[page-subtype='history'] #secondary ytd-searchbox,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary ytd-searchbox {\r\n          box-sizing: border-box !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          min-width: 0 !important;\r\n          font-size: 16px !important;\r\n        }\r\n\r\n        /* Center History filter chiplets. */\r\n        ytd-browse[page-subtype='history'] yt-chip-cloud-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-chip-cloud-renderer,\r\n        ytd-browse[page-subtype='history'] ytd-feed-filter-chip-bar-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          ytd-feed-filter-chip-bar-renderer,\r\n        ytd-browse[page-subtype='history'] #chips,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #chips,\r\n        ytd-browse[page-subtype='history'] #chips-wrapper,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #chips-wrapper,\r\n        ytd-browse[page-subtype='history'] iron-selector#chips,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] iron-selector#chips {\r\n          box-sizing: border-box !important;\r\n          display: flex !important;\r\n          flex-wrap: wrap !important;\r\n          justify-content: center !important;\r\n          align-items: center !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          margin: 0 auto 8px !important;\r\n          padding: 0 !important;\r\n          text-align: center !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history'] yt-chip-cloud-chip-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-chip-cloud-chip-renderer,\r\n        ytd-browse[page-subtype='history'] yt-chip-cloud-chip-renderer chip-shape,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          yt-chip-cloud-chip-renderer chip-shape {\r\n          margin-left: 4px !important;\r\n          margin-right: 4px !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history'] ytd-rich-grid-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-rich-grid-renderer {\r\n          --ytd-rich-grid-items-per-row: 1 !important;\r\n          --ytd-rich-grid-posts-per-row: 1 !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history'] ytd-video-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-video-renderer,\r\n        ytd-browse[page-subtype='history'] ytd-rich-item-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-rich-item-renderer,\r\n        ytd-browse[page-subtype='history'] ytd-grid-video-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-grid-video-renderer {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin: 0 auto 12px !important;\r\n          padding: 0 !important;\r\n          text-align: center !important;\r\n        }\r\n\r\n        /* Classic History rows: stack thumbnail above title. */\r\n        ytd-browse[page-subtype='history'] ytd-video-renderer #dismissible,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          ytd-video-renderer #dismissible {\r\n          display: flex !important;\r\n          flex-direction: column !important;\r\n          align-items: stretch !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n        }\r\n\r\n        /*\r\n         * Modern History lockups use a multi-column CSS grid (thumb | title).\r\n         * flex-direction on the custom element alone does nothing — collapse\r\n         * the grid to one column and cap the content-image width.\r\n         */\r\n        ytd-browse[page-subtype='history'] yt-lockup-view-model,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-lockup-view-model,\r\n        ytd-browse[page-subtype='history']\r\n          :is(\r\n            .yt-lockup-view-model,\r\n            .ytLockupViewModelHost,\r\n            .ytLockupViewModelVertical\r\n          ),\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          :is(\r\n            .yt-lockup-view-model,\r\n            .ytLockupViewModelHost,\r\n            .ytLockupViewModelVertical\r\n          ) {\r\n          box-sizing: border-box !important;\r\n          display: grid !important;\r\n          grid-template-columns: minmax(0, 1fr) !important;\r\n          grid-template-rows: auto !important;\r\n          grid-auto-flow: row !important;\r\n          align-items: stretch !important;\r\n          justify-items: stretch !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin: 0 auto 12px !important;\r\n          column-gap: 0 !important;\r\n          row-gap: 8px !important;\r\n          text-align: center !important;\r\n        }\r\n\r\n        /* Inner host div (when lockup wraps one) — same single-column stack. */\r\n        ytd-browse[page-subtype='history'] yt-lockup-view-model > div,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-lockup-view-model > div {\r\n          box-sizing: border-box !important;\r\n          display: grid !important;\r\n          grid-template-columns: minmax(0, 1fr) !important;\r\n          grid-auto-flow: row !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin: 0 !important;\r\n          column-gap: 0 !important;\r\n          row-gap: 8px !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history'] ytd-thumbnail,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-thumbnail,\r\n        ytd-browse[page-subtype='history'] a#thumbnail,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] a#thumbnail,\r\n        ytd-browse[page-subtype='history'] yt-thumbnail-view-model,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-thumbnail-view-model,\r\n        ytd-browse[page-subtype='history']\r\n          yt-lockup-view-model a[href*='/watch'],\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          yt-lockup-view-model a[href*='/watch'],\r\n        ytd-browse[page-subtype='history']\r\n          :is(\r\n            .yt-lockup-view-model__content-image,\r\n            .ytLockupViewModelContentImage\r\n          ),\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          :is(\r\n            .yt-lockup-view-model__content-image,\r\n            .ytLockupViewModelContentImage\r\n          ) {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          grid-column: 1 !important;\r\n          grid-row: auto !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin: 0 auto !important;\r\n          aspect-ratio: 16 / 9 !important;\r\n          height: auto !important;\r\n          overflow: hidden !important;\r\n          flex: none !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history'] ytd-thumbnail img,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-thumbnail img,\r\n        ytd-browse[page-subtype='history']\r\n          yt-lockup-view-model a[href*='/watch'] img,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          yt-lockup-view-model a[href*='/watch'] img,\r\n        ytd-browse[page-subtype='history']\r\n          :is(\r\n            .yt-lockup-view-model__content-image,\r\n            .ytLockupViewModelContentImage\r\n          )\r\n          img,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          :is(\r\n            .yt-lockup-view-model__content-image,\r\n            .ytLockupViewModelContentImage\r\n          )\r\n          img {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          height: 100% !important;\r\n          object-fit: cover !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history'] #details,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #details,\r\n        ytd-browse[page-subtype='history'] #meta,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #meta,\r\n        ytd-browse[page-subtype='history']\r\n          yt-lockup-metadata-view-model,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          yt-lockup-metadata-view-model,\r\n        ytd-browse[page-subtype='history']\r\n          :is(\r\n            .yt-lockup-view-model__metadata,\r\n            .ytLockupViewModelMetadata\r\n          ),\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          :is(\r\n            .yt-lockup-view-model__metadata,\r\n            .ytLockupViewModelMetadata\r\n          ),\r\n        ytd-browse[page-subtype='history'] h3,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] h3,\r\n        ytd-browse[page-subtype='history'] #video-title,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #video-title,\r\n        ytd-browse[page-subtype='history'] a#video-title,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] a#video-title {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          grid-column: 1 !important;\r\n          grid-row: auto !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n          margin-left: auto !important;\r\n          margin-right: auto !important;\r\n          overflow: visible !important;\r\n          text-align: center !important;\r\n          text-overflow: unset !important;\r\n          white-space: normal !important;\r\n          -webkit-line-clamp: unset !important;\r\n        }\r\n\r\n        /* Restore channel logo + center it with the channel name. */\r\n        ytd-browse[page-subtype='history'] #channel-info,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #channel-info,\r\n        ytd-browse[page-subtype='history'] #channel-name,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #channel-name {\r\n          box-sizing: border-box !important;\r\n          display: inline-flex !important;\r\n          visibility: visible !important;\r\n          flex-direction: row !important;\r\n          flex-wrap: wrap !important;\r\n          align-items: center !important;\r\n          justify-content: center !important;\r\n          gap: 8px !important;\r\n          width: auto !important;\r\n          max-width: 100% !important;\r\n          margin: 4px auto 0 !important;\r\n          text-align: center !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history'] #avatar-link,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #avatar-link,\r\n        ytd-browse[page-subtype='history'] yt-img-shadow#avatar,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-img-shadow#avatar,\r\n        ytd-browse[page-subtype='history'] yt-decorated-avatar-view-model,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          yt-decorated-avatar-view-model,\r\n        ytd-browse[page-subtype='history']\r\n          a[href^='/@'] yt-img-shadow,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          a[href^='/@'] yt-img-shadow,\r\n        ytd-browse[page-subtype='history']\r\n          a[href*='/channel/'] yt-img-shadow,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          a[href*='/channel/'] yt-img-shadow {\r\n          display: inline-flex !important;\r\n          visibility: visible !important;\r\n          opacity: 1 !important;\r\n          width: 36px !important;\r\n          min-width: 36px !important;\r\n          max-width: 36px !important;\r\n          height: 36px !important;\r\n          margin: 0 !important;\r\n          overflow: hidden !important;\r\n          border-radius: 50% !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history'] #avatar-link img,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #avatar-link img,\r\n        ytd-browse[page-subtype='history'] yt-img-shadow#avatar img,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-img-shadow#avatar img,\r\n        ytd-browse[page-subtype='history']\r\n          yt-decorated-avatar-view-model img,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          yt-decorated-avatar-view-model img {\r\n          display: block !important;\r\n          visibility: visible !important;\r\n          width: 36px !important;\r\n          height: 36px !important;\r\n          object-fit: cover !important;\r\n        }\r\n\r\n        ytd-browse[page-subtype='history']\r\n          ytd-item-section-header-renderer,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          ytd-item-section-header-renderer,\r\n        ytd-browse[page-subtype='history']\r\n          ytd-item-section-header-renderer #title,\r\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\r\n          ytd-item-section-header-renderer #title {\r\n          width: 100% !important;\r\n          max-width: 100% !important;\r\n          margin-left: auto !important;\r\n          margin-right: auto !important;\r\n          text-align: center !important;\r\n        }\r\n\r\n        /*\r\n         * 2.2.1: restore 2.1.2-style native masthead search. Keep the desktop\r\n         * search form, but present it as a phone-width overlay after the\r\n         * search icon is tapped. 16px input prevents WebKit keyboard zoom.\r\n         * Ask/voice/AI clutter stays hidden (critical style + below).\r\n         *\r\n         * 3.1.0 (iPhone 16): do not set width:auto on the overlay. WebKit\r\n         * shrink-to-fit then sizes #center to the collapsed search icon, so\r\n         * the field becomes a small block on the left and two search buttons\r\n         * show (header icon + form submit). Pin a viewport width, stretch\r\n         * yt-searchbox internals, and hide the header search icon while open.\r\n         */\r\n        ytd-masthead,\r\n        ytd-masthead #container,\r\n        ytd-masthead #start,\r\n        ytd-masthead #center,\r\n        ytd-masthead #end {\r\n          box-sizing: border-box !important;\r\n          min-width: 0 !important;\r\n          max-width: 100% !important;\r\n        }\r\n\r\n        ytd-masthead #voice-search-button,\r\n        ytd-masthead button[aria-label*='Search with your voice' i],\r\n        ytd-masthead button[aria-label*='Voice search' i],\r\n        ytd-masthead [aria-label*='Ask YouTube' i],\r\n        ytd-masthead [aria-label*='Ask Gemini' i],\r\n        #voice-search-button,\r\n        button[aria-label*='Search with your voice' i],\r\n        button[aria-label*='Voice search' i],\r\n        [aria-label*='Ask YouTube' i],\r\n        [aria-label*='Ask Gemini' i] {\r\n          display: none !important;\r\n          visibility: hidden !important;\r\n          pointer-events: none !important;\r\n        }\r\n\r\n        /* Mobile Search overlay */\r\n        #fyp-search-backdrop {\r\n          display: none;\r\n        }\r\n\r\n        body[data-fyp-search-active='true'] #fyp-search-backdrop,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ~ #fyp-search-backdrop {\r\n          display: block !important;\r\n          position: fixed !important;\r\n          top: 0 !important;\r\n          left: 0 !important;\r\n          right: 0 !important;\r\n          bottom: 0 !important;\r\n          width: 100vw !important;\r\n          height: 100vh !important;\r\n          z-index: 2147483645 !important;\r\n          background: rgba(0, 0, 0, .4) !important;\r\n          backdrop-filter: blur(2px) !important;\r\n          -webkit-backdrop-filter: blur(2px) !important;\r\n        }\r\n\r\n        html[data-fyp-search-active='true'] #start,\r\n        html[data-fyp-search-active='true'] #guide-button,\r\n        html[data-fyp-search-active='true'] #guide-button-icon,\r\n        html[data-fyp-search-active='true'] button[aria-label='Guide'],\r\n        html[data-fyp-search-active='true'] ytd-masthead #guide-button,\r\n        html[data-fyp-search-active='true'] ytd-masthead button[aria-label='Guide'],\r\n        html[data-fyp-search-active='true'] tp-yt-app-drawer#guide,\r\n        html[data-fyp-search-active='true'] #guide,\r\n        html[data-fyp-search-active='true'] ytd-mini-guide-renderer,\r\n        body[data-fyp-search-active='true'] #start,\r\n        body[data-fyp-search-active='true'] #guide-button,\r\n        body[data-fyp-search-active='true'] #guide-button-icon,\r\n        body[data-fyp-search-active='true'] button[aria-label='Guide'],\r\n        body[data-fyp-search-active='true'] ytd-masthead #guide-button,\r\n        body[data-fyp-search-active='true'] ytd-masthead button[aria-label='Guide'],\r\n        body[data-fyp-search-active='true'] tp-yt-app-drawer#guide,\r\n        body[data-fyp-search-active='true'] #guide,\r\n        body[data-fyp-search-active='true'] ytd-mini-guide-renderer,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #start,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #guide-button,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #guide-button-icon,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] button[aria-label='Guide'],\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] yt-icon-button#guide-button,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ~ #guide,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ~ tp-yt-app-drawer#guide,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ~ ytd-mini-guide-renderer {\r\n          display: none !important;\r\n          visibility: hidden !important;\r\n          opacity: 0 !important;\r\n          pointer-events: none !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center {\r\n          position: fixed !important;\r\n          top: calc(env(safe-area-inset-top, 0px) + 6px) !important;\r\n          right: 12px !important;\r\n          left: 12px !important;\r\n          z-index: 2147483646 !important;\r\n          box-sizing: border-box !important;\r\n          display: flex !important;\r\n          flex-direction: row !important;\r\n          flex-wrap: nowrap !important;\r\n          width: calc(100vw - 24px) !important;\r\n          min-width: calc(100vw - 24px) !important;\r\n          max-width: calc(100vw - 24px) !important;\r\n          height: 48px !important;\r\n          margin: 0 !important;\r\n          padding: 4px 6px !important;\r\n          align-items: center !important;\r\n          color: var(--yt-spec-text-primary, #0f0f0f) !important;\r\n          background: var(--yt-spec-base-background, #fff) !important;\r\n          border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .15)) !important;\r\n          border-radius: 24px !important;\r\n          box-shadow: 0 4px 20px rgba(0, 0, 0, .2) !important;\r\n          overflow: visible !important;\r\n        }\r\n\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center,\r\n        html[dark-theme] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center,\r\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center {\r\n          color: #f1f1f1 !important;\r\n          background: #212121 !important;\r\n          border: 1px solid rgba(255, 255, 255, .22) !important;\r\n          box-shadow: 0 4px 20px rgba(0, 0, 0, .5) !important;\r\n        }\r\n\r\n        #fyp-search-back-button,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #fyp-search-back-button {\r\n          display: none !important;\r\n          visibility: hidden !important;\r\n          pointer-events: none !important;\r\n          width: 0 !important;\r\n          height: 0 !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end #search-button,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end #search-button-narrow,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end #search-icon-legacy,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end button[aria-label='Search'],\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end [role='button'][aria-label='Search'],\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end yt-icon-button[aria-label='Search'] {\r\n          display: none !important;\r\n          visibility: hidden !important;\r\n          pointer-events: none !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ytd-searchbox,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] yt-searchbox,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentHost {\r\n          box-sizing: border-box !important;\r\n          display: flex !important;\r\n          flex: 1 1 auto !important;\r\n          min-width: 0 !important;\r\n          height: 100% !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n          align-items: center !important;\r\n          position: relative !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #search-form,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center form,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentSearchForm {\r\n          box-sizing: border-box !important;\r\n          display: flex !important;\r\n          flex: 1 1 auto !important;\r\n          flex-direction: row !important;\r\n          flex-wrap: nowrap !important;\r\n          min-width: 0 !important;\r\n          width: 100% !important;\r\n          height: 100% !important;\r\n          margin: 0 !important;\r\n          padding: 0 !important;\r\n          align-items: center !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #container,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #search-input,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentInputBox {\r\n          box-sizing: border-box !important;\r\n          display: flex !important;\r\n          flex: 1 1 auto !important;\r\n          flex-direction: row !important;\r\n          flex-wrap: nowrap !important;\r\n          min-width: 0 !important;\r\n          width: auto !important;\r\n          max-width: none !important;\r\n          height: 38px !important;\r\n          margin: 0 !important;\r\n          padding: 0 4px 0 14px !important;\r\n          align-items: center !important;\r\n          background: transparent !important;\r\n          border: none !important;\r\n          box-shadow: none !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center\r\n          .ytSearchboxComponentInnerSearchIcon,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center\r\n          #search-icon:not(#search-icon-legacy) {\r\n          display: none !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input#search,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input[name='search_query'],\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .yt-searchbox-input,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentInput {\r\n          box-sizing: border-box !important;\r\n          display: block !important;\r\n          flex: 1 1 auto !important;\r\n          width: 100% !important;\r\n          min-width: 0 !important;\r\n          height: 38px !important;\r\n          padding: 0 4px !important;\r\n          margin: 0 !important;\r\n          color: var(--yt-spec-text-primary, #0f0f0f) !important;\r\n          background: transparent !important;\r\n          border: none !important;\r\n          outline: none !important;\r\n          box-shadow: none !important;\r\n          font-size: 16px !important;\r\n          line-height: 38px !important;\r\n          opacity: 1 !important;\r\n          visibility: visible !important;\r\n          -webkit-appearance: none !important;\r\n        }\r\n\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input#search,\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input[name='search_query'],\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .yt-searchbox-input,\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentInput,\r\n        html[dark-theme] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input#search,\r\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input#search,\r\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input[name='search_query'],\r\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .yt-searchbox-input,\r\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentInput {\r\n          color: #fff !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input::placeholder {\r\n          color: var(--yt-spec-text-secondary, #717171) !important;\r\n          opacity: 1 !important;\r\n        }\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input::placeholder,\r\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input::placeholder {\r\n          color: #aaa !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentSearchButton {\r\n          box-sizing: border-box !important;\r\n          display: flex !important;\r\n          align-items: center !important;\r\n          justify-content: center !important;\r\n          flex: 0 0 38px !important;\r\n          width: 38px !important;\r\n          height: 38px !important;\r\n          min-width: 38px !important;\r\n          margin: 0 !important;\r\n          padding: 6px !important;\r\n          background: transparent !important;\r\n          border: none !important;\r\n          border-radius: 50% !important;\r\n          color: var(--yt-spec-text-primary, #0f0f0f) !important;\r\n          cursor: pointer !important;\r\n          visibility: visible !important;\r\n          opacity: 1 !important;\r\n          pointer-events: auto !important;\r\n        }\r\n\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy,\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentSearchButton,\r\n        html[dark-theme] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy,\r\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy {\r\n          color: #fff !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy yt-icon,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentSearchButton yt-icon,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy svg,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentSearchButton svg {\r\n          width: 22px !important;\r\n          height: 22px !important;\r\n          color: inherit !important;\r\n          fill: currentColor !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #clear-button,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentClearButton {\r\n          box-sizing: border-box !important;\r\n          display: flex !important;\r\n          align-items: center !important;\r\n          justify-content: center !important;\r\n          flex: 0 0 32px !important;\r\n          width: 32px !important;\r\n          height: 32px !important;\r\n          min-width: 32px !important;\r\n          margin: 0 !important;\r\n          padding: 4px !important;\r\n          background: transparent !important;\r\n          border: none !important;\r\n          cursor: pointer !important;\r\n          color: var(--yt-spec-text-secondary, #606060) !important;\r\n        }\r\n\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #clear-button,\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentClearButton,\r\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #clear-button {\r\n          color: #aaa !important;\r\n        }\r\n\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentSuggestionsContainer,\r\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .sbsb_a,\r\n        .sbdd_a {\r\n          position: fixed !important;\r\n          top: calc(env(safe-area-inset-top, 0px) + 56px) !important;\r\n          left: 12px !important;\r\n          right: 12px !important;\r\n          width: calc(100vw - 24px) !important;\r\n          max-width: calc(100vw - 24px) !important;\r\n          max-height: calc(100vh - env(safe-area-inset-top, 0px) - 120px) !important;\r\n          overflow-y: auto !important;\r\n          -webkit-overflow-scrolling: touch !important;\r\n          z-index: 2147483647 !important;\r\n          background: var(--yt-spec-base-background, #fff) !important;\r\n          border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .15)) !important;\r\n          border-radius: 16px !important;\r\n          box-shadow: 0 8px 24px rgba(0, 0, 0, .25) !important;\r\n        }\r\n\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentSuggestionsContainer,\r\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .sbsb_a,\r\n        html[dark] .sbdd_a,\r\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentSuggestionsContainer,\r\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .sbsb_a,\r\n        ytd-app[dark] .sbdd_a {\r\n          background: #212121 !important;\r\n          border: 1px solid rgba(255, 255, 255, .2) !important;\r\n          box-shadow: 0 8px 24px rgba(0, 0, 0, .5) !important;\r\n        }\r\n\r\n      }\r\n\r\n      ytd-comment-view-model[data-vm-comment-enhanced='true'],\r\n      ytd-comment-renderer[data-vm-comment-enhanced='true'] {\r\n        box-sizing: border-box;\r\n        width: 100%;\r\n        min-width: 0;\r\n        padding: clamp(.65rem, 2.8vw, 1rem) clamp(.6rem, 3vw, 1rem);\r\n        border-bottom: 1px solid rgba(127, 127, 127, .2);\r\n        touch-action: manipulation;\r\n      }\r\n\r\n      [data-vm-comment-enhanced='true'] > #toolbar,\r\n      [data-vm-comment-enhanced='true'] #toolbar.ytd-comment-view-model,\r\n      [data-vm-comment-enhanced='true'] #toolbar.ytd-comment-renderer {\r\n        display: none !important;\r\n      }\r\n\r\n      .vm-yt-comment-actions {\r\n        box-sizing: border-box;\r\n        display: flex;\r\n        width: 100%;\r\n        margin-top: clamp(.45rem, 2vw, .75rem);\r\n        gap: clamp(.4rem, 2vw, .75rem);\r\n      }\r\n\r\n      .vm-yt-comment-action {\r\n        appearance: none;\r\n        -webkit-appearance: none;\r\n        box-sizing: border-box;\r\n        display: inline-flex;\r\n        flex: 1 1 50%;\r\n        min-width: 0;\r\n        min-height: 44px;\r\n        padding: clamp(.55rem, 2.5vw, .75rem) clamp(.7rem, 3vw, 1rem);\r\n        align-items: center;\r\n        justify-content: center;\r\n        gap: .4rem;\r\n        color: inherit;\r\n        background: rgba(127, 127, 127, .12);\r\n        border: 1px solid rgba(127, 127, 127, .22);\r\n        border-radius: clamp(.6rem, 3vw, .9rem);\r\n        font: 600 clamp(.78rem, 3.2vw, .9rem)/1 Roboto, Arial, sans-serif;\r\n        touch-action: manipulation;\r\n      }\r\n\r\n      .vm-yt-comment-action[data-pressed='true'] {\r\n        color: #ff0033;\r\n        background: rgba(255, 0, 51, .1);\r\n        border-color: rgba(255, 0, 51, .32);\r\n      }\r\n\r\n      .vm-yt-comment-action svg {\r\n        width: 1.15rem;\r\n        height: 1.15rem;\r\n        fill: none;\r\n        stroke: currentColor;\r\n        stroke-linecap: round;\r\n        stroke-linejoin: round;\r\n        stroke-width: 1.8;\r\n      }\r\n\r\n      ytd-comment-simplebox-renderer #placeholder-area,\r\n      ytd-comment-simplebox-renderer #simplebox-placeholder {\r\n        box-sizing: border-box;\r\n        min-height: 44px;\r\n        padding: clamp(.7rem, 3vw, 1rem) !important;\r\n        touch-action: manipulation;\r\n      }\r\n\r\n      ytd-commentbox textarea,\r\n      ytd-commentbox input,\r\n      ytd-commentbox #contenteditable-root,\r\n      ytd-commentbox [contenteditable='true'],\r\n      ytd-comment-replies-renderer textarea,\r\n      ytd-comment-replies-renderer input,\r\n      ytd-comment-replies-renderer #contenteditable-root,\r\n      ytd-comment-replies-renderer [contenteditable='true'] {\r\n        font-size: 16px !important;\r\n      }\r\n\r\n      ytd-comments#comments,\r\n      ytd-comments {\r\n        width: 100% !important;\r\n        max-width: 100% !important;\r\n        margin: clamp(.35rem, 1.5vw, .75rem) 0 0 !important;\r\n        order: 3 !important;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} {\r\n        box-sizing: border-box;\r\n        position: relative;\r\n        z-index: 5;\r\n        display: flex !important;\r\n        visibility: visible !important;\r\n        opacity: 1 !important;\r\n        flex-wrap: wrap;\r\n        float: none !important;\r\n        clear: both !important;\r\n        width: 100% !important;\r\n        max-width: 100% !important;\r\n        min-width: 0;\r\n        margin: clamp(.25rem, 1.2vw, .45rem) 0 clamp(.5rem, 2.4vw, .8rem) !important;\r\n        padding: clamp(.45rem, 2vw, .7rem);\r\n        gap: clamp(.35rem, 1.8vw, .65rem);\r\n        justify-content: center;\r\n        align-items: center;\r\n        color: var(--yt-spec-text-primary, #0f0f0f);\r\n        border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .12));\r\n        border-radius: clamp(.85rem, 4vw, 1.2rem);\r\n        background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, .06));\r\n        backdrop-filter: blur(12px);\r\n        -webkit-backdrop-filter: blur(12px);\r\n        overflow: visible;\r\n      }\r\n\r\n      html[dark] #${PLAYER_CONTROLS_TOOLBAR_ID},\r\n      html[dark-theme] #${PLAYER_CONTROLS_TOOLBAR_ID},\r\n      ytd-app[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} {\r\n        color: #fff;\r\n        border: 1px solid rgba(255, 255, 255, .14);\r\n        background: rgba(255, 255, 255, .08);\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control {\r\n        appearance: none;\r\n        box-sizing: border-box;\r\n        display: inline-flex !important;\r\n        visibility: visible !important;\r\n        opacity: 1 !important;\r\n        flex: 0 0 auto;\r\n        width: clamp(2.9rem, 13vw, 3.45rem);\r\n        min-width: 2.9rem;\r\n        height: clamp(2.75rem, 12vw, 3.25rem);\r\n        margin: 0;\r\n        padding: clamp(.62rem, 2.6vw, .85rem);\r\n        align-items: center;\r\n        justify-content: center;\r\n        color: var(--yt-spec-text-primary, #0f0f0f);\r\n        background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, .08));\r\n        border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .12));\r\n        border-radius: 999px;\r\n        cursor: pointer;\r\n        touch-action: manipulation;\r\n      }\r\n\r\n      html[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control,\r\n      html[dark-theme] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control,\r\n      ytd-app[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control {\r\n        color: #fff;\r\n        background: rgba(255, 255, 255, .12);\r\n        border: 1px solid rgba(255, 255, 255, .12);\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID}\r\n        .fyp-player-control[data-fyp-player-action='play-pause'] {\r\n        color: #fff;\r\n        background: #0f0f0f;\r\n        border-color: #0f0f0f;\r\n      }\r\n\r\n      html[dark] #${PLAYER_CONTROLS_TOOLBAR_ID}\r\n        .fyp-player-control[data-fyp-player-action='play-pause'],\r\n      html[dark-theme] #${PLAYER_CONTROLS_TOOLBAR_ID}\r\n        .fyp-player-control[data-fyp-player-action='play-pause'],\r\n      ytd-app[dark] #${PLAYER_CONTROLS_TOOLBAR_ID}\r\n        .fyp-player-control[data-fyp-player-action='play-pause'] {\r\n        color: #0f0f0f;\r\n        background: #fff;\r\n        border-color: #fff;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID}\r\n        .fyp-player-control[aria-pressed='true']:not(\r\n          [data-fyp-player-action='play-pause']\r\n        ) {\r\n        color: #fff;\r\n        background: #ff0033;\r\n        border-color: #ff0033;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:active {\r\n        transform: scale(.92);\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:focus-visible {\r\n        outline: 2px solid var(--yt-spec-text-primary, #0f0f0f);\r\n        outline-offset: 2px;\r\n      }\r\n\r\n      html[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:focus-visible,\r\n      html[dark-theme] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:focus-visible,\r\n      ytd-app[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:focus-visible {\r\n        outline-color: #fff;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg {\r\n        display: block;\r\n        width: 100%;\r\n        height: 100%;\r\n        max-width: clamp(1.25rem, 5.6vw, 1.6rem);\r\n        max-height: clamp(1.25rem, 5.6vw, 1.6rem);\r\n        fill: none;\r\n        stroke: currentColor;\r\n        stroke-width: 2;\r\n        stroke-linecap: round;\r\n        stroke-linejoin: round;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID}\r\n        .fyp-player-control[data-fyp-player-action='play-pause'] svg {\r\n        fill: currentColor;\r\n        stroke: none;\r\n      }\r\n\r\n      /* Native settings gear stays available; overflow/more clutter stays hidden. */\r\n      #movie_player .ytp-overflow-button,\r\n      .html5-video-player .ytp-overflow-button,\r\n      #movie_player .ytp-more-button,\r\n      .html5-video-player .ytp-more-button {\r\n        display: none !important;\r\n      }\r\n\r\n      #movie_player .ytp-settings-button,\r\n      .html5-video-player .ytp-settings-button {\r\n        display: inline-flex !important;\r\n        visibility: visible !important;\r\n        opacity: 1 !important;\r\n        pointer-events: auto !important;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu {\r\n        box-sizing: border-box;\r\n        flex: 1 0 100%;\r\n        display: flex;\r\n        flex-direction: column;\r\n        width: min(100vw - 24px, 22rem);\r\n        min-width: 0;\r\n        max-height: min(42svh, 18rem);\r\n        margin-top: clamp(.15rem, .8vw, .3rem);\r\n        padding: clamp(.4rem, 2vw, .65rem);\r\n        gap: clamp(.25rem, 1vw, .4rem);\r\n        color: var(--yt-spec-text-primary, #0f0f0f);\r\n        background: var(--yt-spec-menu-background, rgba(255, 255, 255, .98));\r\n        border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .12));\r\n        border-radius: clamp(.75rem, 3vw, 1rem);\r\n        box-shadow: 0 .75rem 2rem rgba(0, 0, 0, .18);\r\n        overflow-x: hidden;\r\n        overflow-y: auto;\r\n        -webkit-overflow-scrolling: touch;\r\n        overscroll-behavior: contain;\r\n        touch-action: pan-y;\r\n      }\r\n\r\n      html[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu,\r\n      html[dark-theme] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu,\r\n      ytd-app[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu {\r\n        color: #fff;\r\n        background: rgba(15, 15, 15, .97);\r\n        border: 1px solid rgba(255, 255, 255, .16);\r\n        box-shadow: 0 .75rem 2rem rgba(0, 0, 0, .45);\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-collapse {\r\n        appearance: none;\r\n        box-sizing: border-box;\r\n        align-self: center;\r\n        display: inline-flex;\r\n        align-items: center;\r\n        justify-content: center;\r\n        width: clamp(2.6rem, 12vw, 3.1rem);\r\n        min-height: clamp(1.7rem, 7vw, 2rem);\r\n        margin: 0;\r\n        padding: 0;\r\n        color: rgba(255, 255, 255, .88);\r\n        background: rgba(255, 255, 255, .08);\r\n        border: 1px solid rgba(255, 255, 255, .14);\r\n        border-radius: 999px;\r\n        touch-action: manipulation;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-collapse svg {\r\n        display: block;\r\n        width: clamp(1.05rem, 4.5vw, 1.25rem);\r\n        height: clamp(1.05rem, 4.5vw, 1.25rem);\r\n        fill: none;\r\n        stroke: currentColor;\r\n        stroke-width: 2;\r\n        stroke-linecap: round;\r\n        stroke-linejoin: round;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-title {\r\n        padding: clamp(.25rem, 1vw, .4rem) clamp(.7rem, 3vw, .95rem);\r\n        color: rgba(255, 255, 255, .72);\r\n        font: 700 clamp(.78rem, 3.2vw, .9rem)/1.2 Roboto, Arial, sans-serif;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option {\r\n        appearance: none;\r\n        box-sizing: border-box;\r\n        width: 100%;\r\n        min-height: clamp(2.45rem, 10vw, 2.9rem);\r\n        margin: 0;\r\n        padding: 0 clamp(.75rem, 3vw, 1rem);\r\n        color: #fff;\r\n        background: rgba(255, 255, 255, .09);\r\n        border: 1px solid transparent;\r\n        border-radius: clamp(.6rem, 2.5vw, .8rem);\r\n        text-align: left;\r\n        font: 600 clamp(.8rem, 3.4vw, .95rem)/1.25 Roboto, Arial, sans-serif;\r\n        touch-action: pan-y;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID}\r\n        .fyp-player-menu-option[aria-checked='true'] {\r\n        background: #ff0033;\r\n        border-color: #ff0033;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option:disabled {\r\n        opacity: .55;\r\n      }\r\n\r\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option:focus-visible {\r\n        outline: 2px solid #fff;\r\n        outline-offset: -2px;\r\n      }\r\n\r\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-bottom,\r\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-top,\r\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-bottom,\r\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-top {\r\n        visibility: visible !important;\r\n        opacity: 1 !important;\r\n        transform: translateY(0) !important;\r\n      }\r\n\r\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-bottom,\r\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-top {\r\n        pointer-events: auto !important;\r\n      }\r\n\r\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-bottom,\r\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-top {\r\n        pointer-events: none !important;\r\n      }\r\n\r\n      /*\r\n       * Orion/WebKit may render the native WebVTT cue at the same time as\r\n       * YouTube's custom caption DOM. Hide the native cue only while custom\r\n       * segments exist — never on CC-button alone — so a starved custom module\r\n       * cannot leave the screen with zero caption text.\r\n       */\r\n      .html5-video-player:has(\r\n        .ytp-caption-window-container .ytp-caption-segment\r\n      ) video::cue,\r\n      video[data-fyp-native-captions-hidden='true']::cue {\r\n        visibility: hidden !important;\r\n        opacity: 0 !important;\r\n        color: transparent !important;\r\n        background: transparent !important;\r\n        text-shadow: none !important;\r\n      }\r\n\r\n      .html5-video-player:has(\r\n        .ytp-caption-window-container .ytp-caption-segment\r\n      ) video::-webkit-media-text-track-container,\r\n      .html5-video-player:has(\r\n        .ytp-caption-window-container .ytp-caption-segment\r\n      ) video::-webkit-media-text-track-display,\r\n      video[data-fyp-native-captions-hidden='true']::-webkit-media-text-track-container,\r\n      video[data-fyp-native-captions-hidden='true']::-webkit-media-text-track-display {\r\n        display: none !important;\r\n        visibility: hidden !important;\r\n        opacity: 0 !important;\r\n      }\r\n\r\n      @media (hover: none) {\r\n        tp-yt-paper-tooltip,\r\n        yt-tooltip-renderer {\r\n          display: none !important;\r\n          pointer-events: none !important;\r\n        }\r\n      }\r\n\r\n      /* Floating pill removed — navigation is burger/guide only. */\r\n      #${NAV_ID} {\r\n        display: none !important;\r\n        visibility: hidden !important;\r\n        pointer-events: none !important;\r\n      }\r\n\r\n      ytd-app,\r\n      ytm-app {\r\n        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 4.75rem) !important;\r\n      }\r\n\r\n      #${WELCOME_ID} {\r\n        box-sizing: border-box;\r\n        position: fixed;\r\n        top: calc(env(safe-area-inset-top, 0px) + clamp(3.5rem, 10svh, 5rem));\r\n        left: 50%;\r\n        z-index: 2147483647;\r\n        width: min(calc(100% - 2rem), 22rem);\r\n        padding: clamp(.75rem, 2.8vw, 1rem) clamp(1rem, 4vw, 1.35rem);\r\n        color: #fff;\r\n        background: rgba(15, 15, 15, .96);\r\n        border: 1px solid rgba(255, 255, 255, .18);\r\n        border-radius: clamp(.65rem, 3vw, 1rem);\r\n        box-shadow: 0 .5rem 1.5rem rgba(0, 0, 0, .28);\r\n        font: 600 clamp(.9rem, 3.8vw, 1.05rem)/1.3 Roboto, Arial, sans-serif;\r\n        text-align: center;\r\n        transform: translateX(-50%);\r\n        opacity: 1;\r\n        transition: opacity .22s ease, transform .22s ease;\r\n      }\r\n\r\n      #${WELCOME_ID}[data-hiding='true'] {\r\n        opacity: 0;\r\n        transform: translate(-50%, -.45rem);\r\n        pointer-events: none;\r\n      }\r\n\r\n      /* Only the action to subscribe is red; an already-subscribed button is untouched. */\r\n      button[data-vm-subscribe-action='true'],\r\n      [role='button'][data-vm-subscribe-action='true'] {\r\n        color: #fff !important;\r\n        background-color: #ff0033 !important;\r\n        background-image: none !important;\r\n        border-color: #ff0033 !important;\r\n        box-shadow: none !important;\r\n      }\r\n\r\n      [data-vm-subscribe-action='true'] .yt-spec-button-shape-next__button-text-content {\r\n        color: #fff !important;\r\n      }\r\n\r\n      .ytp-fullscreen-quick-actions button[aria-label^='Ask'],\r\n      #movie_player button[aria-label*='Ask Gemini'],\r\n      ytd-watch-metadata button[aria-label^='Ask'],\r\n      ytd-watch-metadata [title^='Ask Gemini'] {\r\n        display: none !important;\r\n        visibility: hidden !important;\r\n        pointer-events: none !important;\r\n      }\r\n\r\n    `;\r\n  }\r\n\r\n  /* Lucide icon paths — Home, ListVideo, CircleUser. Shorts + Create omitted. */\r\n  const MOBILE_NAV_ITEMS = [\r\n    {\r\n      id: 'home',\r\n      label: 'Home',\r\n      href: '/',\r\n      active: (path) => path === '/' || path === '',\r\n      icon: '<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>',\r\n    },\r\n    {\r\n      id: 'subscriptions',\r\n      label: 'Subs',\r\n      href: '/feed/subscriptions',\r\n      active: (path) => path.startsWith('/feed/subscriptions'),\r\n      icon: '<path d=\"M12 12H3\"/><path d=\"M16 6H3\"/><path d=\"M12 18H3\"/><path d=\"m16 12 5 3-5 3v-6Z\"/>',\r\n    },\r\n    {\r\n      id: 'you',\r\n      label: 'You',\r\n      href: '/feed/you',\r\n      active: (path) =>\r\n        path.startsWith('/feed/you') ||\r\n        path.startsWith('/feed/library') ||\r\n        path.startsWith('/account'),\r\n      icon: '<circle cx=\"12\" cy=\"12\" r=\"10\"/><circle cx=\"12\" cy=\"10\" r=\"3\"/><path d=\"M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662\"/>',\r\n    },\r\n  ];\r\n\r\n  function setImportantStyles(element, declarations) {\r\n    if (!element) return;\r\n    for (const [property, value] of Object.entries(declarations)) {\r\n      element.style.setProperty(property, value, 'important');\r\n    }\r\n  }\r\n\r\n  function isDarkTheme() {\r\n    return Boolean(\r\n      document.documentElement.hasAttribute('dark') ||\r\n      document.documentElement.hasAttribute('dark-theme') ||\r\n      document.body?.hasAttribute('dark') ||\r\n      document.querySelector('ytd-app[dark], ytm-app[dark]') ||\r\n      window.matchMedia?.('(prefers-color-scheme: dark)').matches\r\n    );\r\n  }\r\n\r\n  function applyCriticalNavigationLayout(nav) {\r\n    const dark = isDarkTheme();\r\n    // Orion iOS: browser chrome is outside the webview — keep a tight safe-area gap.\r\n    const clearance = `calc(env(safe-area-inset-bottom, 0px) + ${ORION_NAV_GAP})`;\r\n    setImportantStyles(nav, {\r\n      'box-sizing': 'border-box',\r\n      position: 'fixed',\r\n      top: 'auto',\r\n      right: 'auto',\r\n      bottom: clearance,\r\n      left: '50%',\r\n      'z-index': '2147483646',\r\n      display: 'flex',\r\n      'flex-direction': 'row',\r\n      width: 'min(calc(100% - 28px), 352px)',\r\n      height: 'auto',\r\n      'min-height': '56px',\r\n      margin: '0',\r\n      'padding-top': '5px',\r\n      'padding-right': '6px',\r\n      'padding-bottom': '5px',\r\n      'padding-left': '6px',\r\n      'align-items': 'stretch',\r\n      'justify-content': 'space-around',\r\n      gap: '2px',\r\n      color: dark ? '#f1f1f1' : '#0f0f0f',\r\n      background: dark ? 'rgba(28, 28, 28, .9)' : 'rgba(255, 255, 255, .9)',\r\n      border: dark\r\n        ? '1px solid rgba(255, 255, 255, .12)'\r\n        : '1px solid rgba(0, 0, 0, .1)',\r\n      'border-radius': '999px',\r\n      'box-shadow': dark\r\n        ? '0 6px 22px rgba(0, 0, 0, .45)'\r\n        : '0 6px 20px rgba(0, 0, 0, .18)',\r\n      'font-family': '\"SF Pro Text\", Roboto, system-ui, sans-serif',\r\n      overflow: 'hidden',\r\n      'pointer-events': 'auto',\r\n      transform: 'translate3d(-50%, 0, 0)',\r\n      '-webkit-transform': 'translate3d(-50%, 0, 0)',\r\n      '-webkit-backdrop-filter': 'saturate(1.4) blur(18px)',\r\n      'backdrop-filter': 'saturate(1.4) blur(18px)',\r\n      '-webkit-user-select': 'none',\r\n      'user-select': 'none',\r\n    });\r\n\r\n    for (const link of nav.querySelectorAll('.vm-yt-nav-item')) {\r\n      setImportantStyles(link, {\r\n        'box-sizing': 'border-box',\r\n        display: 'flex',\r\n        flex: '1 1 33%',\r\n        'flex-direction': 'column',\r\n        'min-width': '0',\r\n        'min-height': '48px',\r\n        margin: '0',\r\n        padding: '4px 2px',\r\n        'align-items': 'center',\r\n        'justify-content': 'center',\r\n        gap: '3px',\r\n        background: 'transparent',\r\n        border: '0',\r\n        'border-radius': '999px',\r\n        'text-decoration': 'none',\r\n        cursor: 'pointer',\r\n      });\r\n\r\n      const iconWrap = link.querySelector('.vm-yt-nav-icon-wrap');\r\n      if (iconWrap) {\r\n        setImportantStyles(iconWrap, {\r\n          display: 'flex',\r\n          width: 'auto',\r\n          height: 'auto',\r\n          'align-items': 'center',\r\n          'justify-content': 'center',\r\n          color: 'inherit',\r\n          background: 'transparent',\r\n          'border-radius': '999px',\r\n        });\r\n      }\r\n\r\n      setImportantStyles(link.querySelector('.vm-yt-nav-icon'), {\r\n        display: 'block',\r\n        width: '22px',\r\n        height: '22px',\r\n        flex: '0 0 auto',\r\n        fill: 'none',\r\n        stroke: 'currentColor',\r\n        'stroke-linecap': 'round',\r\n        'stroke-linejoin': 'round',\r\n        'stroke-width': '2',\r\n      });\r\n\r\n      const label = link.querySelector('.vm-yt-nav-label');\r\n      if (label) {\r\n        setImportantStyles(label, {\r\n          display: 'block',\r\n          'max-width': '100%',\r\n          overflow: 'hidden',\r\n          'font-size': '10px',\r\n          'font-weight': '500',\r\n          'line-height': '1.1',\r\n          'text-overflow': 'ellipsis',\r\n          'white-space': 'nowrap',\r\n        });\r\n      }\r\n    }\r\n\r\n    for (const app of document.querySelectorAll('ytd-app, ytm-app')) {\r\n      setImportantStyles(app, {\r\n        width: '100%',\r\n        'min-width': '0',\r\n        'padding-bottom': `calc(${clearance} + 64px)`,\r\n      });\r\n    }\r\n  }\r\n\r\n  function hideShortsGuideEntries(root = document) {\r\n    const entries = root.querySelectorAll?.(\r\n      'ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ytm-pivot-bar-item-renderer, ' +\r\n        'tp-yt-paper-item, yt-list-item-view-model'\r\n    ) || [];\r\n\r\n    for (const entry of entries) {\r\n      const href = [\r\n        entry.querySelector?.('a#endpoint')?.getAttribute('href'),\r\n        entry.querySelector?.('a')?.getAttribute('href'),\r\n        entry.getAttribute?.('href'),\r\n      ]\r\n        .filter(Boolean)\r\n        .join(' ');\r\n      const label = [\r\n        entry.getAttribute?.('title'),\r\n        entry.querySelector?.('[title]')?.getAttribute('title'),\r\n        entry.querySelector?.('a#endpoint')?.getAttribute('title'),\r\n        entry.querySelector?.('yt-formatted-string')?.textContent,\r\n        entry.querySelector?.('.title')?.textContent,\r\n        entry.getAttribute?.('aria-label'),\r\n        entry.querySelector?.('[aria-label]')?.getAttribute('aria-label'),\r\n        entry.textContent,\r\n      ]\r\n        .filter(Boolean)\r\n        .join(' ')\r\n        .replace(/\\s+/g, ' ')\r\n        .trim();\r\n\r\n      const isShorts =\r\n        /\\/shorts\\b|\\/playables\\b/i.test(href) ||\r\n        /^(shorts|playables)\\b/i.test(label) ||\r\n        (/(\\bshorts\\b|\\bplayables\\b|mini[\\s-]?games)/i.test(label) && label.length < 48) ||\r\n        /tab_shorts|shorts_fill|shorts_outline/i.test(\r\n          entry.innerHTML?.slice?.(0, 500) || ''\r\n        );\r\n\r\n      if (!isShorts) continue;\r\n\r\n      setImportantStyles(entry, {\r\n        display: 'none',\r\n        visibility: 'hidden',\r\n        'pointer-events': 'none',\r\n        height: '0',\r\n        margin: '0',\r\n        padding: '0',\r\n        overflow: 'hidden',\r\n      });\r\n      entry.setAttribute('aria-hidden', 'true');\r\n      entry.hidden = true;\r\n      entry.dataset.vmShortsHidden = 'true';\r\n    }\r\n  }\r\n\r\n  function hideNativeNavigationAndShorts() {\r\n    for (const element of document.querySelectorAll(\r\n      [\r\n        'ytm-pivot-bar-renderer',\r\n        'ytd-mini-guide-renderer',\r\n        'ytd-mini-guide-entry-renderer',\r\n        'ytd-reel-shelf-renderer',\r\n        'ytm-reel-shelf-renderer',\r\n        'ytm-shorts-lockup-view-model',\r\n        'ytm-shorts-lockup-view-model-v2',\r\n        'ytd-reel-item-renderer',\r\n        'ytm-reel-item-renderer',\r\n        'yt-playable-game-renderer',\r\n        'ytd-game-card-renderer',\r\n        'ytd-playable-renderer',\r\n        'ytd-playables-shelf-renderer',\r\n        'yt-playables-shelf-renderer',\r\n      ].join(',')\r\n    )) {\r\n      setImportantStyles(element, {\r\n        display: 'none',\r\n        visibility: 'hidden',\r\n        'pointer-events': 'none',\r\n      });\r\n      element.setAttribute('aria-hidden', 'true');\r\n      element.hidden = true;\r\n    }\r\n\r\n    for (const element of document.querySelectorAll(\r\n      'ytd-rich-shelf-renderer, ytd-rich-section-renderer, grid-shelf-view-model'\r\n    )) {\r\n      const titleText = (\r\n        element.querySelector?.('#title, .title, #title-text, yt-formatted-string, h2, [id*=\"title\"]')\r\n          ?.textContent || ''\r\n      ).trim();\r\n      const ariaLabel = element.getAttribute?.('aria-label') || '';\r\n      const isShortsShelf =\r\n        Boolean(element.querySelector?.('a[href*=\"/shorts\"], a[href*=\"/playables\"]')) ||\r\n        /shorts|playables|mini[\\s-]?games/i.test(titleText) ||\r\n        /shorts|playables|mini[\\s-]?games/i.test(ariaLabel);\r\n      if (!isShortsShelf) continue;\r\n      setImportantStyles(element, {\r\n        display: 'none',\r\n        visibility: 'hidden',\r\n        'pointer-events': 'none',\r\n        height: '0',\r\n        margin: '0',\r\n        padding: '0',\r\n        overflow: 'hidden',\r\n      });\r\n      element.setAttribute('aria-hidden', 'true');\r\n      element.hidden = true;\r\n      const section = element.closest('ytd-rich-section-renderer');\r\n      if (section && section !== element) {\r\n        setImportantStyles(section, {\r\n          display: 'none',\r\n          visibility: 'hidden',\r\n          'pointer-events': 'none',\r\n          height: '0',\r\n          margin: '0',\r\n          padding: '0',\r\n          overflow: 'hidden',\r\n        });\r\n        section.setAttribute('aria-hidden', 'true');\r\n        section.hidden = true;\r\n      }\r\n    }\r\n\r\n    const possibleShortsControls = document.querySelectorAll([\r\n      '.pivot-shorts',\r\n      'a[href^=\"/shorts\"]',\r\n      'a[href*=\"/shorts\"]',\r\n      'a[href*=\"youtube.com/shorts\"]',\r\n      'a[href^=\"/playables\"]',\r\n      'a[href*=\"/playables\"]',\r\n      'a[href*=\"youtube.com/playables\"]',\r\n      '[aria-label=\"Shorts\"]',\r\n      '[title=\"Shorts\"]',\r\n      '[aria-label*=\"Playables\" i]',\r\n      '[title*=\"Playables\" i]',\r\n      '[is-shorts]',\r\n      '[is-playables]',\r\n      '[is-playable]',\r\n    ].join(','));\r\n\r\n    for (const control of possibleShortsControls) {\r\n      const item =\r\n        control.closest(\r\n          'ytm-pivot-bar-item-renderer, ytd-guide-entry-renderer, ' +\r\n            'ytd-mini-guide-entry-renderer, yt-tab-shape, [role=\"tab\"], ' +\r\n            'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ' +\r\n            'ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-rich-section-renderer, ' +\r\n            'ytd-reel-item-renderer, ytm-reel-item-renderer, ' +\r\n            'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ' +\r\n            'yt-lockup-view-model, tp-yt-paper-item, grid-shelf-view-model'\r\n        ) || control;\r\n      setImportantStyles(item, {\r\n        display: 'none',\r\n        visibility: 'hidden',\r\n        'pointer-events': 'none',\r\n        height: '0',\r\n        margin: '0',\r\n        padding: '0',\r\n        overflow: 'hidden',\r\n      });\r\n      item.setAttribute('aria-hidden', 'true');\r\n      item.hidden = true;\r\n      const section = item.closest('ytd-rich-section-renderer');\r\n      if (section && section !== item) {\r\n        setImportantStyles(section, {\r\n          display: 'none',\r\n          visibility: 'hidden',\r\n          'pointer-events': 'none',\r\n          height: '0',\r\n          margin: '0',\r\n          padding: '0',\r\n          overflow: 'hidden',\r\n        });\r\n        section.setAttribute('aria-hidden', 'true');\r\n        section.hidden = true;\r\n      }\r\n    }\r\n\r\n    for (const chip of document.querySelectorAll('yt-chip-cloud-chip-renderer')) {\r\n      if (/playables|mini[\\s-]?games/i.test(chip.textContent.trim())) {\r\n        setImportantStyles(chip, {\r\n          display: 'none',\r\n          visibility: 'hidden',\r\n          'pointer-events': 'none',\r\n        });\r\n        chip.hidden = true;\r\n      }\r\n    }\r\n\r\n    hideShortsGuideEntries(document);\r\n  }\r\n\r\n  function blockShortsNavigation(event) {\r\n    const target = event.target;\r\n    if (!(target instanceof Element)) return;\r\n    const link = target.closest('a[href*=\"/shorts\"], a[href*=\"/playables\"]');\r\n    if (!link) return;\r\n    event.preventDefault();\r\n    event.stopImmediatePropagation();\r\n    location.assign(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);\r\n  }\r\n\r\n  function isSearchField(element) {\n    return (\n      (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement) ||\n      (typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement)\n    );\n  }\n\n  function findNativeSearchInput(masthead = document.querySelector('ytd-masthead')) {\n    const input = masthead?.querySelector(\n      'input#search, input[name=\"search_query\"], textarea[name=\"search_query\"], ' +\n        '.yt-searchbox-input, .ytSearchboxComponentInput'\n    );\n    return isSearchField(input) ? input : null;\n  }\n\n  function ensureMobileSearchElements() {\n    const existing = document.getElementById(SEARCH_OVERLAY_ID);\n    if (existing) return existing;\n\n    const host = document.body || document.documentElement;\n    if (!host) return null;\n\n    const overlay = document.createElement('div');\n    overlay.id = SEARCH_OVERLAY_ID;\n    overlay.hidden = true;\n    overlay.setAttribute('aria-hidden', 'true');\n    overlay.setAttribute('role', 'dialog');\n    overlay.setAttribute('aria-modal', 'true');\n\n    const dialog = document.createElement('div');\n    dialog.setAttribute('data-fyp-search-dialog', 'true');\n\n    const form = document.createElement('form');\n    form.id = SEARCH_OVERLAY_FORM_ID;\n    form.setAttribute('role', 'search');\n\n    const input = document.createElement('input');\n    input.id = SEARCH_OVERLAY_INPUT_ID;\n    input.type = 'search';\n    input.name = 'search_query';\n    input.autocomplete = 'off';\n    input.spellcheck = false;\n    input.placeholder = 'Search YouTube';\n    input.setAttribute('aria-label', 'Search YouTube');\n    input.setAttribute('enterkeyhint', 'search');\n\n    const submit = document.createElement('button');\n    submit.type = 'submit';\n    submit.setAttribute('aria-label', 'Search');\n    submit.textContent = 'Search';\n\n    form.append(input, submit);\n    dialog.append(form);\n    overlay.append(dialog);\n    host.append(overlay);\n\n    const dismiss = (event) => {\n      if (event.target !== overlay) return;\n      event.preventDefault();\n      event.stopImmediatePropagation();\n      closeMobileSearch();\n    };\n    overlay.addEventListener('click', dismiss, true);\n    overlay.addEventListener('touchstart', dismiss, { capture: true, passive: false });\n    form.addEventListener(\n      'submit',\n      (event) => {\n        event.preventDefault();\n        event.stopPropagation();\n        submitMobileSearch(input.value);\n      },\n      true\n    );\n    input.addEventListener(\n      'keydown',\n      (event) => {\n        if (event.key !== 'Enter') return;\n        event.preventDefault();\n        event.stopPropagation();\n        submitMobileSearch(input.value);\n      },\n      true\n    );\n    return overlay;\n  }\n\n  function buildYouTubeSearchUrl(query) {\n    const url = new URL(`https://${BACKEND_HOST}/results`);\n    url.search = new URLSearchParams({ search_query: query }).toString();\n    return url.href;\n  }\n\n  function submitMobileSearch(rawQuery) {\n    const query = String(rawQuery || '').replace(/\\s+/g, ' ').trim();\n    const input = document.getElementById(SEARCH_OVERLAY_INPUT_ID);\n    if (!query) {\n      if (isSearchField(input)) input.focus();\n      return;\n    }\n    closeMobileSearch();\n    location.assign(buildYouTubeSearchUrl(query));\n  }\n\n  function closeMobileSearch() {\n    const masthead = document.querySelector('ytd-masthead');\n    if (masthead) {\n      masthead.removeAttribute(MOBILE_SEARCH_OPEN_ATTR);\n      masthead\n        .querySelectorAll(\n          '#search-button, #search-button-narrow, #search-icon-legacy, button[aria-label=\"Search\"], ' +\n            '[role=\"button\"][aria-label=\"Search\"], yt-icon-button[aria-label=\"Search\"]'\n        )\n        .forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));\n    }\n    document.documentElement?.removeAttribute('data-fyp-search-active');\n    document.body?.removeAttribute('data-fyp-search-active');\n\n    const overlay = document.getElementById(SEARCH_OVERLAY_ID);\n    if (overlay) {\n      overlay.hidden = true;\n      overlay.removeAttribute('data-open');\n      overlay.setAttribute('aria-hidden', 'true');\n      const input = overlay.querySelector(`#${SEARCH_OVERLAY_INPUT_ID}`);\n      if (isSearchField(input)) {\n        try { input.blur(); } catch {}\n      }\n    }\n    const nativeInput = findNativeSearchInput(masthead);\n    if (nativeInput) {\n      try { nativeInput.blur(); } catch {}\n    }\n    ensureGuideButtonVisible();\n  }\n\n  /*\n   * The YouTube masthead is only the trigger. FYP owns a separate, stable\n   * overlay so YouTube can switch between input and textarea implementations\n   * without breaking focus or submit behavior. Synchronous focus keeps the\n   * virtual keyboard eligible on iOS/WebKit.\n   */\n  function handleMobileSearchClick(event) {\n    const target = event.target;\n    if (!(target instanceof Element)) return;\n    if (target.closest(`#${SEARCH_OVERLAY_ID}`)) return;\n\n    const masthead = target.closest('ytd-masthead') || document.querySelector('ytd-masthead');\n    if (!masthead) return;\n\n    const alreadyOpen =\n      document.documentElement?.getAttribute('data-fyp-search-active') === 'true';\n    if (alreadyOpen) return;\n\n    const trigger = target.closest(MOBILE_SEARCH_TRIGGER_SELECTOR);\n    if (!trigger) return;\n\n    event.preventDefault();\n    event.stopImmediatePropagation();\n\n    // Close any open guide drawer so it never peeks/show through the overlay.\n    for (const drawer of document.querySelectorAll('tp-yt-app-drawer#guide, #guide')) {\n      if (typeof drawer.close === 'function') {\n        try { drawer.close(); } catch {}\n      }\n    }\n\n    const overlay = ensureMobileSearchElements();\n    const input = overlay?.querySelector(`#${SEARCH_OVERLAY_INPUT_ID}`);\n    if (!overlay || !isSearchField(input)) return;\n\n    const nativeInput = findNativeSearchInput(masthead);\n    input.value = nativeInput?.value || '';\n    try { nativeInput?.blur(); } catch {}\n\n    masthead.setAttribute(MOBILE_SEARCH_OPEN_ATTR, 'true');\n    document.documentElement?.setAttribute('data-fyp-search-active', 'true');\n    document.body?.setAttribute('data-fyp-search-active', 'true');\n    overlay.hidden = false;\n    overlay.setAttribute('data-open', 'true');\n    overlay.setAttribute('aria-hidden', 'false');\n    trigger.setAttribute('aria-expanded', 'true');\n    hideAskGeminiControls();\n    ensureGuideButtonVisible();\n\n    // Force-hide hamburger menu elements immediately while the overlay is open.\n    for (const btn of document.querySelectorAll(\n      '#guide-button, ytd-masthead #guide-button, button[aria-label=\"Guide\"], ytd-masthead #start, #start'\n    )) {\n      setImportantStyles(btn, {\n        display: 'none',\n        visibility: 'hidden',\n        opacity: '0',\n        'pointer-events': 'none',\n      });\n      btn.setAttribute('aria-hidden', 'true');\n    }\n\n    // Focus the FYP-owned field synchronously inside the user gesture.\n    try {\n      input.focus({ preventScroll: true });\n    } catch {\n      input.focus();\n    }\n    const end = input.value.length;\n    input.setSelectionRange?.(end, end);\n\n    requestAnimationFrame(() => {\n      if (document.documentElement?.getAttribute('data-fyp-search-active') !== 'true') return;\n      try {\n        input.focus({ preventScroll: true });\n      } catch {\n        // ignore\n      }\n      input.setSelectionRange?.(input.value.length, input.value.length);\n    });\n  }\n\r\n  function dismissMiniplayer() {\r\n    const app = document.querySelector('ytd-app');\r\n    if (app) {\r\n      app.removeAttribute('miniplayer-active_');\r\n      app.removeAttribute('miniplayer-active');\r\n      try {\r\n        if ('miniplayerActive_' in app) app.miniplayerActive_ = false;\r\n        if ('miniplayerActive' in app) app.miniplayerActive = false;\r\n      } catch {\r\n        // ignore\r\n      }\r\n    }\r\n\r\n    for (const mini of document.querySelectorAll(\r\n      'ytd-miniplayer, #miniplayer, #miniplayer-container'\r\n    )) {\r\n      setImportantStyles(mini, {\r\n        display: 'none',\r\n        visibility: 'hidden',\r\n        'pointer-events': 'none',\r\n        opacity: '0',\r\n        width: '0',\r\n        height: '0',\r\n      });\r\n      mini.removeAttribute('active');\r\n      mini.removeAttribute('enabled');\r\n      try {\r\n        if (typeof mini.minimize === 'function') {\r\n          // no-op path\r\n        }\r\n        if ('active' in mini) mini.active = false;\r\n      } catch {\r\n        // ignore\r\n      }\r\n    }\r\n\r\n    document\r\n      .querySelectorAll(\r\n        '.ytp-miniplayer-close-button, ytd-miniplayer button[aria-label*=\"Close\"], ' +\r\n          '#miniplayer button[aria-label*=\"Close\"]'\r\n      )\r\n      .forEach((button) => {\r\n        if (button instanceof HTMLElement) {\r\n          try {\r\n            button.click();\r\n          } catch {\r\n            // ignore\r\n          }\r\n        }\r\n      });\r\n  }\r\n\r\n  function removeFloatingPillNav() {\r\n    const nav = document.getElementById(NAV_ID);\r\n    if (nav) nav.remove();\r\n  }\r\n\r\n  function applySafeBottomSpacing() {\r\n    for (const app of document.querySelectorAll('ytd-app, ytm-app')) {\r\n      setImportantStyles(app, {\r\n        'padding-bottom': 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)',\r\n        '--ytd-mini-guide-width': '0px',\r\n        '--ytd-mini-guide-width-min': '0px',\r\n      });\r\n    }\r\n  }\r\n\r\n  function disableGuideSwipe(drawer) {\r\n    if (!(drawer instanceof HTMLElement)) return;\r\n    if (!drawer.hasAttribute('disable-swipe')) {\r\n      drawer.setAttribute('disable-swipe', '');\r\n    }\r\n    try {\r\n      drawer.disableSwipe = true;\r\n    } catch {}\r\n  }\r\n\r\n  function lockGuideToTapOnly() {\r\n    for (const mini of document.querySelectorAll('ytd-mini-guide-renderer')) {\r\n      setImportantStyles(mini, {\r\n        display: 'none',\r\n        visibility: 'hidden',\r\n        'pointer-events': 'none',\r\n      });\r\n    }\r\n\r\n    for (const app of document.querySelectorAll('ytd-app')) {\r\n      setImportantStyles(app, {\r\n        '--ytd-mini-guide-width': '0px',\r\n        '--ytd-mini-guide-width-min': '0px',\r\n      });\r\n    }\r\n\r\n    for (const drawer of document.querySelectorAll('tp-yt-app-drawer#guide, #guide')) {\r\n      disableGuideSwipe(drawer);\r\n      hideShortsGuideEntries(drawer);\r\n    }\r\n\r\n    hideShortsGuideEntries(document);\r\n    restoreScrollAfterGuideClose();\r\n  }\r\n\r\n  function ensureGuideButtonVisible() {\r\n    const candidates = document.querySelectorAll([\r\n      '#guide-button',\r\n      'ytd-masthead #guide-button',\r\n      'ytd-masthead button[aria-label=\"Guide\"]',\r\n      'ytd-masthead button[aria-label*=\"Guide\"]',\r\n      'ytd-masthead yt-icon-button#guide-button',\r\n      'button[aria-label=\"Guide\"]',\r\n      'button[aria-label*=\"Guide\"]',\r\n    ].join(','));\r\n\r\n    const isSearchActive =\r\n      document.body?.getAttribute('data-fyp-search-active') === 'true' ||\r\n      document.querySelector(`ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}=\"true\"]`);\r\n\r\n    if (isSearchActive) {\r\n      for (const button of candidates) {\r\n        button.setAttribute('aria-hidden', 'true');\r\n        setImportantStyles(button, {\r\n          display: 'none',\r\n          visibility: 'hidden',\r\n          opacity: '0',\r\n          'pointer-events': 'none',\r\n        });\r\n      }\r\n      return;\r\n    }\r\n\r\n    for (const button of candidates) {\r\n      button.removeAttribute('hidden');\r\n      button.setAttribute('aria-hidden', 'false');\r\n      setImportantStyles(button, {\r\n        display: 'inline-flex',\r\n        visibility: 'visible',\r\n        opacity: '1',\r\n        'pointer-events': 'auto',\r\n        width: '40px',\r\n        'min-width': '40px',\r\n        height: '40px',\r\n      });\r\n      const icon = button.querySelector('yt-icon, .yt-icon-button, svg');\r\n      if (icon) {\r\n        setImportantStyles(icon, {\r\n          display: 'block',\r\n          visibility: 'visible',\r\n          opacity: '1',\r\n        });\r\n      }\r\n    }\r\n\r\n    lockGuideToTapOnly();\r\n  }\r\n\r\n  function hideUploadControls(root = document) {\r\n    const selectors = [\r\n      'ytd-masthead a[href=\"/upload\"]',\r\n      'ytd-masthead a[href*=\"upload?\"]',\r\n      'ytd-masthead a[href*=\"/upload\"]',\r\n      'ytd-masthead button[aria-label=\"Create\"]',\r\n      'ytd-masthead button[aria-label*=\"Create a video\"]',\r\n      'ytd-masthead button[aria-label=\"Upload\"]',\r\n      'ytd-masthead button[aria-label=\"Upload video\"]',\r\n      'ytd-masthead [aria-label=\"Create\"]',\r\n      'ytd-masthead [aria-label=\"Upload video\"]',\r\n      '#masthead-upload-button',\r\n      'ytm-mobile-topbar-renderer button[aria-label*=\"Upload\"]',\r\n      'ytm-mobile-topbar-renderer button[aria-label*=\"Create\"]',\r\n      'ytm-mobile-topbar-renderer a[href*=\"upload\"]',\r\n    ].join(',');\r\n\r\n    for (const control of root.querySelectorAll?.(selectors) || []) {\r\n      const host =\r\n        control.closest(\r\n          'ytd-topbar-menu-button-renderer, ytd-button-renderer, ' +\r\n            'ytm-topbar-menu-button-renderer, yt-icon-button, button-view-model'\r\n        ) || control;\r\n      setImportantStyles(host, {\r\n        display: 'none',\r\n        visibility: 'hidden',\r\n        'pointer-events': 'none',\r\n        width: '0',\r\n        'min-width': '0',\r\n        margin: '0',\r\n        padding: '0',\r\n        overflow: 'hidden',\r\n      });\r\n      host.setAttribute('aria-hidden', 'true');\r\n      host.hidden = true;\r\n    }\r\n\r\n    // Fallback: match by label text when YouTube changes aria attributes.\r\n    for (const candidate of root.querySelectorAll?.(\r\n      'ytd-masthead button, ytd-masthead a, ytm-mobile-topbar-renderer button, ytm-mobile-topbar-renderer a'\r\n    ) || []) {\r\n      const label = [\r\n        candidate.getAttribute('aria-label'),\r\n        candidate.getAttribute('title'),\r\n        candidate.textContent,\r\n      ]\r\n        .filter(Boolean)\r\n        .join(' ')\r\n        .replace(/\\s+/g, ' ')\r\n        .trim()\r\n        .toLowerCase();\r\n      if (!label) continue;\r\n      if (\r\n        !/^(create|upload)(\\b|$)/.test(label) &&\r\n        !label.includes('upload video') &&\r\n        !label.includes('create a video') &&\r\n        !label.includes('create video or post')\r\n      ) {\r\n        continue;\r\n      }\r\n      const host =\r\n        candidate.closest(\r\n          'ytd-topbar-menu-button-renderer, ytd-button-renderer, ' +\r\n            'ytm-topbar-menu-button-renderer, yt-icon-button, button-view-model'\r\n        ) || candidate;\r\n      setImportantStyles(host, {\r\n        display: 'none',\r\n        visibility: 'hidden',\r\n        'pointer-events': 'none',\r\n      });\r\n      host.hidden = true;\r\n    }\r\n  }\r\n\r\n  function markHistoryFeedBrowse() {\r\n    const browse = document.querySelector('ytd-browse');\r\n    if (!(browse instanceof HTMLElement)) return;\r\n    if (location.pathname.startsWith('/feed/history')) {\r\n      browse.setAttribute(HISTORY_FEED_ATTR, 'history');\r\n    } else if (browse.getAttribute(HISTORY_FEED_ATTR) === 'history') {\r\n      browse.removeAttribute(HISTORY_FEED_ATTR);\r\n    }\r\n  }\r\n\r\n  function applyMobileShell() {\n    hideNativeNavigationAndShorts();\n    ensureGuideButtonVisible();\n    ensureMobileSearchElements();\n    hideAskGeminiControls();\n    hideUploadControls();\n    dismissMiniplayer();\r\n    removeFloatingPillNav();\r\n    applySafeBottomSpacing();\r\n    markHistoryFeedBrowse();\r\n\r\n    for (const video of document.querySelectorAll('video')) {\r\n      enforceInlinePlayback(video);\r\n    }\r\n  }\r\n\r\n  function findCommentsRoot() {\r\n    const watch = document.querySelector('ytd-watch-flexy');\r\n    return (\r\n      watch?.querySelector('ytd-comments#comments') ||\r\n      watch?.querySelector('#comments ytd-comments') ||\r\n      watch?.querySelector('ytd-comments') ||\r\n      document.querySelector('ytd-comments#comments') ||\r\n      document.querySelector('#comments') ||\r\n      document.querySelector('ytd-comments')\r\n    );\r\n  }\r\n\r\n  function findWatchPlaylistHost(watch) {\r\n    if (!(watch instanceof Element)) return null;\r\n    const hasListParam = new URLSearchParams(location.search).has('list');\r\n    const watchHasPlaylist =\r\n      watch.hasAttribute('playlist') || watch.hasAttribute('has-playlist');\r\n    if (!hasListParam && !watchHasPlaylist) return null;\r\n\r\n    const renderer = [...watch.querySelectorAll('ytd-playlist-panel-renderer')].find(\r\n      (element) =>\r\n        !element.closest('ytd-miniplayer') && !element.hasAttribute('hidden')\r\n    );\r\n    if (renderer instanceof HTMLElement) {\r\n      const wrapper = renderer.parentElement;\r\n      if (\r\n        wrapper instanceof HTMLElement &&\r\n        wrapper.id === 'playlist' &&\r\n        wrapper !== watch.querySelector('#secondary') &&\r\n        wrapper !== watch.querySelector('#secondary-inner') &&\r\n        wrapper !== watch.querySelector('#below')\r\n      ) {\r\n        return wrapper;\r\n      }\r\n      return renderer;\r\n    }\r\n\r\n    const playlist = watch.querySelector('#playlist');\r\n    if (\r\n      playlist instanceof HTMLElement &&\r\n      playlist.id === 'playlist' &&\r\n      !playlist.closest('ytd-miniplayer') &&\r\n      playlist !== watch.querySelector('#secondary')\r\n    ) {\r\n      return playlist;\r\n    }\r\n    return null;\r\n  }\r\n\r\n  function positionCommentsAfterRecommendations() {\r\n    if (location.pathname !== '/watch') return;\r\n\r\n    const watch = document.querySelector('ytd-watch-flexy');\r\n    if (!watch) return;\r\n\r\n    let below = watch.querySelector('#below');\r\n    const primary = watch.querySelector('#primary-inner, #primary');\r\n    if (!below && primary) {\r\n      below = primary.querySelector('#below');\r\n    }\r\n    if (!below && primary) {\r\n      below = document.createElement('div');\r\n      below.id = 'below';\r\n      primary.appendChild(below);\r\n    }\r\n    if (!below) return;\r\n\r\n    const descriptionBlock =\r\n      [...below.children].find((element) =>\r\n        element.matches(\r\n          'ytd-watch-metadata, ytd-video-primary-info-renderer, ytd-video-secondary-info-renderer'\r\n        )\r\n      ) ||\r\n      watch.querySelector(\r\n        'ytd-watch-metadata, ytd-video-primary-info-renderer, ytd-video-secondary-info-renderer'\r\n      );\r\n\r\n    const comments = findCommentsRoot();\r\n    const playlist = findWatchPlaylistHost(watch);\r\n    const recommendationsCandidate =\r\n      watch.querySelector('ytd-watch-next-secondary-results-renderer') ||\r\n      watch.querySelector('#related');\r\n    const recommendations =\r\n      recommendationsCandidate instanceof HTMLElement &&\r\n      (!playlist || !playlist.contains(recommendationsCandidate))\r\n        ? recommendationsCandidate\r\n        : null;\r\n    if (!descriptionBlock || (!playlist && !recommendations && !comments)) {\r\n      return;\r\n    }\r\n\r\n    if (descriptionBlock.parentElement !== below) {\r\n      below.insertAdjacentElement('afterbegin', descriptionBlock);\r\n    }\r\n\r\n    setImportantStyles(below, {\r\n      display: 'flex',\r\n      'flex-direction': 'column',\r\n      width: '100%',\r\n      'min-width': '0',\r\n    });\r\n    setImportantStyles(descriptionBlock, { order: '1' });\r\n\r\n    /*\r\n     * Watch order: description (title + inline buttons) → playlist →\r\n     * recommendations → comments. Do not move #secondary as a whole; that\r\n     * either buries the playlist after comments or treats it as related.\r\n     */\r\n    let insertionAnchor = descriptionBlock;\r\n    if (playlist) {\r\n      setImportantStyles(playlist, {\r\n        order: '2',\r\n        display: 'block',\r\n        width: '100%',\r\n        'min-width': '0',\r\n        'max-width': '100%',\r\n        'margin-left': '0',\r\n      });\r\n      playlist.removeAttribute('hidden');\r\n      if (\r\n        playlist.parentElement !== below ||\r\n        descriptionBlock.nextElementSibling !== playlist\r\n      ) {\r\n        descriptionBlock.insertAdjacentElement('afterend', playlist);\r\n      }\r\n      insertionAnchor = playlist;\r\n    }\r\n\r\n    if (recommendations && !recommendations.contains(comments)) {\r\n      setImportantStyles(recommendations, {\r\n        order: '3',\r\n        width: '100%',\r\n        'max-width': '100%',\r\n        'margin-left': '0',\r\n      });\r\n      if (\r\n        recommendations.parentElement !== below ||\r\n        insertionAnchor.nextElementSibling !== recommendations\r\n      ) {\r\n        insertionAnchor.insertAdjacentElement('afterend', recommendations);\r\n      }\r\n      insertionAnchor = recommendations;\r\n    }\r\n\r\n    if (comments) {\r\n      setImportantStyles(comments, {\r\n        order: '4',\r\n        width: '100%',\r\n        'min-width': '0',\r\n        'max-width': '100%',\r\n        margin: '8px 0 0',\r\n      });\r\n      if (\r\n        comments.parentElement !== below ||\r\n        insertionAnchor.nextElementSibling !== comments\r\n      ) {\r\n        insertionAnchor.insertAdjacentElement('afterend', comments);\r\n      }\r\n    }\r\n\r\n    /*\r\n     * Keep the transport strip above the playlist. If it ever lands as a\r\n     * #below sibling (title mount race), pin it with the metadata block\r\n     * instead of after playlist/recommendations/comments.\r\n     */\r\n    const toolbar = document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID);\r\n    if (toolbar instanceof HTMLElement) {\r\n      const titleInMeta = descriptionBlock.querySelector('#title, h1');\r\n      if (titleInMeta instanceof Element && isUsableWatchMount(titleInMeta)) {\r\n        if (titleInMeta.nextElementSibling !== toolbar) {\r\n          titleInMeta.insertAdjacentElement('afterend', toolbar);\r\n        }\r\n      } else if (\r\n        isUsableWatchMount(descriptionBlock) &&\r\n        descriptionBlock.firstElementChild !== toolbar\r\n      ) {\r\n        descriptionBlock.insertAdjacentElement('afterbegin', toolbar);\r\n      }\r\n    }\r\n\r\n    for (const sibling of below.children) {\r\n      if (\r\n        sibling === descriptionBlock ||\r\n        sibling === playlist ||\r\n        sibling === recommendations ||\r\n        (comments && sibling === comments) ||\r\n        sibling.id === PLAYER_CONTROLS_TOOLBAR_ID\r\n      ) {\r\n        continue;\r\n      }\r\n      setImportantStyles(sibling, { order: '5' });\r\n    }\r\n  }\r\n\r\n  function removeLegacyCommentPagination() {\r\n    document.getElementById(`${SCRIPT_ID}-load-more-comments`)?.remove();\r\n    document.getElementById(`${SCRIPT_ID}-load-less-comments`)?.remove();\r\n    document\r\n      .querySelectorAll('[data-vm-comment-hidden=\"true\"]')\r\n      .forEach((thread) => {\r\n        delete thread.dataset.vmCommentHidden;\r\n        thread.style.removeProperty('display');\r\n      });\r\n    document\r\n      .querySelectorAll('[data-vm-continuation-hidden=\"true\"]')\r\n      .forEach((continuation) => {\r\n        delete continuation.dataset.vmContinuationHidden;\r\n        continuation.style.removeProperty('display');\r\n      });\r\n  }\r\n\r\n  function arrangeWatchComments() {\r\n    positionCommentsAfterRecommendations();\r\n    removeLegacyCommentPagination();\r\n  }\r\n\r\n  function hideAskGeminiControls() {\r\n    const roots = document.querySelectorAll(\r\n      '#movie_player, ytd-player, ytd-watch-metadata, ytd-masthead, ytd-app'\r\n    );\r\n    for (const root of roots) {\r\n      const candidates = root.querySelectorAll(\r\n        'button, [role=\"button\"], yt-button-view-model, button-view-model, a'\r\n      );\r\n      for (const candidate of candidates) {\r\n        const label = [\r\n          candidate.getAttribute('aria-label'),\r\n          candidate.getAttribute('title'),\r\n          candidate.textContent,\r\n        ]\r\n          .filter(Boolean)\r\n          .join(' ')\r\n          .replace(/\\s+/g, ' ')\r\n          .trim();\r\n        if (\r\n          !/ask(?:\\s+gemini|\\s+youtube|\\s+about|\\s*$)/i.test(label) &&\r\n          !/search with your voice|voice search/i.test(label)\r\n        ) {\r\n          continue;\r\n        }\r\n\r\n        const control =\r\n          candidate.closest(\r\n            '.ytp-fullscreen-quick-action, yt-button-view-model, button-view-model, #voice-search-button'\r\n          ) || candidate;\r\n        setImportantStyles(control, {\r\n          display: 'none',\r\n          visibility: 'hidden',\r\n          'pointer-events': 'none',\r\n        });\r\n        control.setAttribute('aria-hidden', 'true');\r\n        control.hidden = true;\r\n      }\r\n    }\r\n  }\r\n\r\n  function showWelcomeOnce() {\r\n    if (!document.body || document.getElementById(WELCOME_ID)) return;\r\n\r\n    const memoryFlag = '__vmYtWelcomeShown';\r\n    try {\r\n      if (localStorage.getItem(WELCOME_KEY) === '1') return;\r\n      localStorage.setItem(WELCOME_KEY, '1');\r\n    } catch {\r\n      if (window[memoryFlag]) return;\r\n      window[memoryFlag] = true;\r\n    }\r\n\r\n    const welcome = document.createElement('div');\r\n    welcome.id = WELCOME_ID;\r\n    welcome.setAttribute('role', 'status');\r\n    welcome.setAttribute('aria-live', 'polite');\r\n    welcome.textContent = 'Welcome to Fyoutube';\r\n    setImportantStyles(welcome, {\r\n      'box-sizing': 'border-box',\r\n      position: 'fixed',\r\n      top: 'calc(env(safe-area-inset-top, 0px) + 64px)',\r\n      left: '50%',\r\n      'z-index': '2147483647',\r\n      width: 'min(calc(100% - 32px), 352px)',\r\n      margin: '0',\r\n      padding: '14px 18px',\r\n      color: '#ffffff',\r\n      background: 'rgba(15, 15, 15, .96)',\r\n      border: '1px solid rgba(255, 255, 255, .18)',\r\n      'border-radius': '14px',\r\n      'box-shadow': '0 8px 24px rgba(0, 0, 0, .28)',\r\n      'font-family': 'Roboto, Arial, sans-serif',\r\n      'font-size': '16px',\r\n      'font-weight': '600',\r\n      'line-height': '1.3',\r\n      'text-align': 'center',\r\n      transform: 'translateX(-50%)',\r\n      opacity: '1',\r\n    });\r\n    document.body.appendChild(welcome);\r\n\r\n    let dismissed = false;\r\n    const dismiss = () => {\r\n      if (dismissed) return;\r\n      dismissed = true;\r\n      welcome.dataset.hiding = 'true';\r\n      welcome.style.setProperty('opacity', '0', 'important');\r\n      welcome.style.setProperty(\r\n        'transform',\r\n        'translate(-50%, -8px)',\r\n        'important'\r\n      );\r\n      setTimeout(() => welcome.remove(), 240);\r\n    };\r\n    welcome.addEventListener('click', dismiss, { once: true });\r\n    setTimeout(dismiss, 4200);\r\n  }\r\n\r\n  function updateMobileNavigation() {\r\n    const nav = document.getElementById(NAV_ID);\r\n    if (!nav) return;\r\n    applyCriticalNavigationLayout(nav);\r\n    const inactiveColor = isDarkTheme() ? '#f1f1f1' : '#0f0f0f';\r\n    for (const link of nav.querySelectorAll('.vm-yt-nav-item')) {\r\n      const item = MOBILE_NAV_ITEMS[Number(link.dataset.index)];\r\n      const isActive = Boolean(item?.active(location.pathname));\r\n      const isCreate = item?.create === true;\r\n      link.dataset.active = String(isActive);\r\n      link.style.setProperty(\r\n        'color',\r\n        isActive && !isCreate ? '#ff0033' : inactiveColor,\r\n        'important'\r\n      );\r\n      link.style.setProperty('background', 'transparent', 'important');\r\n      if (item) {\r\n        if (isActive) link.setAttribute('aria-current', 'page');\r\n        else link.removeAttribute('aria-current');\r\n      }\r\n    }\r\n  }\r\n\r\n  function buildNavItem(item, index) {\r\n    const link = document.createElement('a');\r\n    link.className = 'vm-yt-nav-item';\r\n    link.href = item.href;\r\n    link.dataset.index = String(index);\r\n    link.dataset.id = item.id;\r\n    if (item.create) link.dataset.create = 'true';\r\n    link.setAttribute('aria-label', item.label);\r\n    link.innerHTML = `\r\n      <span class=\"vm-yt-nav-icon-wrap\">\r\n        <svg class=\"vm-yt-nav-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\">\r\n          ${item.icon}\r\n        </svg>\r\n      </span>\r\n      <span class=\"vm-yt-nav-label\">${item.label}</span>\r\n    `;\r\n    return link;\r\n  }\r\n\r\n  function ensureMobileNavigation() {\r\n    // Burger / guide drawer is the only nav — never reinject the floating pill.\r\n    removeFloatingPillNav();\r\n  }\r\n\r\n  function markSubscribeButtons(root = document) {\r\n    const candidates = root.querySelectorAll?.([\r\n      'ytm-subscribe-button-renderer button',\r\n      'yt-subscribe-button-view-model button',\r\n      'ytd-subscribe-button-renderer button',\r\n      'ytd-subscribe-button-renderer tp-yt-paper-button',\r\n      'ytd-subscribe-button-renderer [role=\"button\"]',\r\n      'button[aria-label*=\"Subscribe\"]',\r\n      'button[aria-label*=\"subscribe\"]',\r\n      '[role=\"button\"][aria-label*=\"Subscribe\"]',\r\n      '[role=\"button\"][aria-label*=\"subscribe\"]',\r\n    ].join(',')) || [];\r\n\r\n    for (const button of candidates) {\r\n      const owner = button.closest(\r\n        'ytm-subscribe-button-renderer, yt-subscribe-button-view-model, ' +\r\n          'ytd-subscribe-button-renderer'\r\n      );\r\n      const label = [\r\n        button.getAttribute('aria-label'),\r\n        button.textContent,\r\n        owner?.getAttribute('aria-label'),\r\n        owner?.textContent,\r\n      ]\r\n        .filter(Boolean)\r\n        .join(' ')\r\n        .replace(/\\s+/g, ' ')\r\n        .trim()\r\n        .toLowerCase();\r\n      const alreadySubscribed =\r\n        button.getAttribute('aria-pressed') === 'true' ||\r\n        owner?.hasAttribute('subscribed') ||\r\n        owner?.getAttribute('subscribed') === 'true' ||\r\n        label.includes('subscribed') ||\r\n        label.includes('unsubscribe');\r\n      const isSubscribeAction =\r\n        !alreadySubscribed &&\r\n        /(^|\\s)subscribe(?:\\s|$| to )/.test(label);\r\n\r\n      if (isSubscribeAction) {\r\n        if (!button.dataset.vmSubscribeOriginalStyle) {\r\n          button.dataset.vmSubscribeOriginalStyle = JSON.stringify(\r\n            [\r\n              'color',\r\n              'background',\r\n              'background-color',\r\n              'background-image',\r\n              'border',\r\n              'border-color',\r\n              'box-shadow',\r\n              '--yt-spec-brand-button-background',\r\n              '--yt-spec-static-brand-red',\r\n            ].map((property) => [\r\n              property,\r\n              button.style.getPropertyValue(property),\r\n              button.style.getPropertyPriority(property),\r\n            ])\r\n          );\r\n        }\r\n        button.dataset.vmSubscribeAction = 'true';\r\n        owner?.setAttribute('data-vm-subscribe-action', 'true');\r\n        setImportantStyles(button, {\r\n          color: '#ffffff',\r\n          background: '#ff0033',\r\n          'background-color': '#ff0033',\r\n          'background-image': 'none',\r\n          border: '1px solid #ff0033',\r\n          'border-color': '#ff0033',\r\n          'box-shadow': 'none',\r\n          '--yt-spec-brand-button-background': '#ff0033',\r\n          '--yt-spec-static-brand-red': '#ff0033',\r\n        });\r\n        for (const child of button.querySelectorAll(\r\n          'span, .yt-spec-button-shape-next__button-text-content'\r\n        )) {\r\n          child.style.setProperty('color', '#ffffff', 'important');\r\n        }\r\n      } else {\r\n        delete button.dataset.vmSubscribeAction;\r\n        owner?.removeAttribute('data-vm-subscribe-action');\r\n        for (const child of button.querySelectorAll(\r\n          'span, .yt-spec-button-shape-next__button-text-content'\r\n        )) {\r\n          child.style.removeProperty('color');\r\n        }\r\n        if (button.dataset.vmSubscribeOriginalStyle) {\r\n          try {\r\n            const originalStyles = JSON.parse(\r\n              button.dataset.vmSubscribeOriginalStyle\r\n            );\r\n            for (const [property, value, priority] of originalStyles) {\r\n              if (value) button.style.setProperty(property, value, priority);\r\n              else button.style.removeProperty(property);\r\n            }\r\n          } catch {\r\n            // A YouTube rerender will restore the native style.\r\n          }\r\n          delete button.dataset.vmSubscribeOriginalStyle;\r\n        }\r\n      }\r\n    }\r\n  }\r\n\r\n  function findNativeCommentAction(comment, selectors) {\r\n    return [...comment.querySelectorAll(selectors)].find(\r\n      (element) => !element.closest('.vm-yt-comment-actions')\r\n    );\r\n  }\r\n\r\n  function enhanceComments(root = document) {\r\n    const comments = [\r\n      ...root.querySelectorAll?.('ytd-comment-view-model') || [],\r\n      ...[...root.querySelectorAll?.('ytd-comment-renderer') || []].filter(\r\n        (comment) => !comment.querySelector('ytd-comment-view-model')\r\n      ),\r\n    ];\r\n\r\n    for (const comment of comments) {\r\n      if (comment.dataset.vmCommentEnhanced === 'true') continue;\r\n\r\n      const likeSelectors = [\r\n        '#like-button button',\r\n        'like-button-view-model button',\r\n        'button[aria-label^=\"Like\"]',\r\n        '[role=\"button\"][aria-label^=\"Like\"]',\r\n      ].join(',');\r\n      const replySelectors = [\r\n        '#reply-button-end button',\r\n        'ytd-button-renderer#reply-button button',\r\n        'button[aria-label^=\"Reply\"]',\r\n        '[role=\"button\"][aria-label^=\"Reply\"]',\r\n      ].join(',');\r\n      if (\r\n        !findNativeCommentAction(comment, likeSelectors) &&\r\n        !findNativeCommentAction(comment, replySelectors)\r\n      ) {\r\n        continue;\r\n      }\r\n\r\n      comment.dataset.vmCommentEnhanced = 'true';\r\n      setImportantStyles(comment, {\r\n        'box-sizing': 'border-box',\r\n        width: '100%',\r\n        'min-width': '0',\r\n        'max-width': '100%',\r\n        padding: '12px 10px',\r\n        'border-bottom': '1px solid rgba(127, 127, 127, .2)',\r\n        'touch-action': 'manipulation',\r\n      });\r\n\r\n      for (const toolbar of comment.querySelectorAll('#toolbar')) {\r\n        setImportantStyles(toolbar, {\r\n          display: 'none',\r\n          visibility: 'hidden',\r\n        });\r\n      }\r\n\r\n      const actions = document.createElement('div');\r\n      actions.className = 'vm-yt-comment-actions';\r\n      setImportantStyles(actions, {\r\n        'box-sizing': 'border-box',\r\n        display: 'flex',\r\n        width: '100%',\r\n        'margin-top': '8px',\r\n        gap: '8px',\r\n      });\r\n\r\n      const createAction = (label, icon) => {\r\n        const button = document.createElement('button');\r\n        button.type = 'button';\r\n        button.className = 'vm-yt-comment-action';\r\n        button.setAttribute('aria-label', `${label} this comment`);\r\n        button.innerHTML = `\r\n          <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">${icon}</svg>\r\n          <span>${label}</span>\r\n        `;\r\n        setImportantStyles(button, {\r\n          appearance: 'none',\r\n          display: 'inline-flex',\r\n          flex: '1 1 50%',\r\n          'min-width': '0',\r\n          'min-height': '44px',\r\n          padding: '10px 12px',\r\n          'align-items': 'center',\r\n          'justify-content': 'center',\r\n          gap: '6px',\r\n          color: 'inherit',\r\n          background: 'rgba(127, 127, 127, .12)',\r\n          border: '1px solid rgba(127, 127, 127, .22)',\r\n          'border-radius': '12px',\r\n          'font-family': 'Roboto, Arial, sans-serif',\r\n          'font-size': '14px',\r\n          'font-weight': '600',\r\n          'line-height': '1',\r\n          'touch-action': 'manipulation',\r\n        });\r\n        return button;\r\n      };\r\n\r\n      const like = createAction(\r\n        'Like',\r\n        '<path d=\"M7 10v11H3V10h4Zm0 9h10.2a2 2 0 0 0 1.9-1.4l1.7-5.5A2 2 0 0 0 18.9 9H14l.7-3.2A2.8 2.8 0 0 0 12 2.5L7 10Z\"/>'\r\n      );\r\n      const reply = createAction(\r\n        'Reply',\r\n        '<path d=\"M9 17 4 12l5-5v3h5a6 6 0 0 1 6 6v3a7 7 0 0 0-6-6H9v4Z\"/>'\r\n      );\r\n\r\n      const syncLikeState = () => {\r\n        const nativeLike = findNativeCommentAction(comment, likeSelectors);\r\n        const pressed = Boolean(\r\n          nativeLike?.getAttribute('aria-pressed') === 'true' ||\r\n          nativeLike?.closest('[aria-pressed=\"true\"]')\r\n        );\r\n        like.dataset.pressed = String(pressed);\r\n        like.querySelector('span').textContent = pressed ? 'Liked' : 'Like';\r\n        like.style.setProperty(\r\n          'color',\r\n          pressed ? '#ff0033' : 'inherit',\r\n          'important'\r\n        );\r\n      };\r\n\r\n      like.addEventListener('click', (event) => {\r\n        event.preventDefault();\r\n        event.stopPropagation();\r\n        findNativeCommentAction(comment, likeSelectors)?.click();\r\n        setTimeout(syncLikeState, 50);\r\n        setTimeout(syncLikeState, 350);\r\n      });\r\n\r\n      reply.addEventListener('click', (event) => {\r\n        event.preventDefault();\r\n        event.stopPropagation();\r\n        const nativeReply = findNativeCommentAction(comment, replySelectors);\r\n        nativeReply?.click();\r\n        setTimeout(() => {\r\n          const editor = comment.querySelector(\r\n            'ytd-commentbox textarea, #contenteditable-root, [contenteditable=\"true\"]'\r\n          );\r\n          editor?.focus();\r\n          editor?.scrollIntoView({ block: 'center', behavior: 'smooth' });\r\n        }, 120);\r\n      });\r\n\r\n      actions.append(like, reply);\r\n      const actionHost =\r\n        comment.querySelector('#body, #main, #content') || comment;\r\n      actionHost.appendChild(actions);\r\n      syncLikeState();\r\n    }\r\n  }\r\n\r\n  function ensureViewport() {\r\n    if (!document.head) return;\r\n    let viewport = document.querySelector('meta[name=\"viewport\"]');\r\n    if (!viewport) {\r\n      viewport = document.createElement('meta');\r\n      viewport.name = 'viewport';\r\n      document.head.appendChild(viewport);\r\n    }\r\n    viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';\r\n  }\r\n\r\n  /*\r\n   * Prefer a mounted watch title/metadata node even when its layout height is\r\n   * briefly 0 during YouTube remounts. Requiring height > 0 caused the strip to\r\n   * bounce between #below (order 4 / huge gap) and after-title on every scan.\r\n   * Issue #2: never treat a hidden ancestor or the player shell as a valid\r\n   * mount. Reload paints the player before the title; parking there clips the\r\n   * strip when full-bleed CSS collapses #columns #player.\r\n   */\r\n  const COLLAPSED_PLAYER_SHELL_SELECTOR = [\r\n    'ytd-watch-flexy[full-bleed-player] #columns #player',\r\n    'ytd-watch-flexy[theater] #columns #player',\r\n    'ytd-watch-flexy:not([full-bleed-player]) #player-full-bleed-container',\r\n  ].join(', ');\r\n\r\n  function isUsableWatchMount(node) {\r\n    if (!(node instanceof Element) || !node.isConnected) return false;\r\n    if (node.closest('[hidden]')) return false;\r\n    if (node.closest(COLLAPSED_PLAYER_SHELL_SELECTOR)) return false;\r\n    const style = getComputedStyle(node);\r\n    if (style.display === 'none') return false;\r\n    return true;\r\n  }\r\n\r\n  function findWatchTitleAnchor() {\r\n    const selectors = [\r\n      'ytd-watch-metadata #title',\r\n      'ytd-video-primary-info-renderer #title',\r\n      'ytd-watch-flexy ytd-watch-metadata h1',\r\n      'ytd-watch-flexy #below h1',\r\n    ];\r\n    for (const selector of selectors) {\r\n      for (const candidate of document.querySelectorAll(selector)) {\r\n        if (!isUsableWatchMount(candidate)) continue;\r\n        return candidate.closest('#title') || candidate;\r\n      }\r\n    }\r\n    return null;\r\n  }\r\n\r\n  function findWatchMetadataHost() {\r\n    const selectors = [\r\n      'ytd-watch-flexy ytd-watch-metadata',\r\n      'ytd-watch-flexy ytd-video-primary-info-renderer',\r\n    ];\r\n    for (const selector of selectors) {\r\n      for (const candidate of document.querySelectorAll(selector)) {\r\n        if (isUsableWatchMount(candidate)) return candidate;\r\n      }\r\n    }\r\n    return null;\r\n  }\r\n\r\n  function findWatchBelowHost() {\r\n    const selectors = [\r\n      'ytd-watch-flexy #below',\r\n      'ytd-watch-flexy #primary-inner',\r\n    ];\r\n    for (const selector of selectors) {\r\n      const candidate = document.querySelector(selector);\r\n      if (isUsableWatchMount(candidate)) return candidate;\r\n    }\r\n    return null;\r\n  }\r\n\r\n  function findVisibleWatchPlayerHost() {\r\n    const watch = document.querySelector('ytd-watch-flexy');\r\n    if (!(watch instanceof Element)) return null;\r\n    const fullBleed =\r\n      watch.hasAttribute('full-bleed-player') ||\r\n      watch.hasAttribute('theater');\r\n    const selectors = fullBleed\r\n      ? [\r\n          'ytd-watch-flexy #player-full-bleed-container',\r\n          'ytd-watch-flexy #player-container-outer',\r\n          'ytd-watch-flexy #player',\r\n        ]\r\n      : [\r\n          'ytd-watch-flexy #player-container-outer',\r\n          'ytd-watch-flexy #player',\r\n          'ytd-watch-flexy #player-full-bleed-container',\r\n        ];\r\n    for (const selector of selectors) {\r\n      const candidate = document.querySelector(selector);\r\n      if (!(candidate instanceof Element) || !candidate.isConnected) continue;\r\n      if (candidate.closest(COLLAPSED_PLAYER_SHELL_SELECTOR)) continue;\r\n      if (candidate.closest('[hidden]')) continue;\r\n      if (getComputedStyle(candidate).display === 'none') continue;\r\n      return candidate;\r\n    }\r\n    return null;\r\n  }\r\n\r\n  function toolbarIsParkedOnPlayer(toolbar) {\r\n    /*\r\n     * CLIPPED only: inside the video engine or a collapsed unused player\r\n     * shell. Sitting after the visible player host is a valid fallback.\r\n     */\r\n    if (!(toolbar instanceof HTMLElement) || !toolbar.isConnected) {\r\n      return false;\r\n    }\r\n    if (toolbar.closest('#movie_player, .html5-video-player')) return true;\r\n    if (toolbar.closest(COLLAPSED_PLAYER_SHELL_SELECTOR)) return true;\r\n    return false;\r\n  }\r\n\r\n  function toolbarIsCorrectlyPlaced(\r\n    toolbar,\r\n    title,\r\n    metadata,\r\n    below,\r\n    playerHost,\r\n    watch\r\n  ) {\r\n    if (!(toolbar instanceof HTMLElement) || !toolbar.isConnected) {\r\n      return false;\r\n    }\r\n    if (toolbarIsParkedOnPlayer(toolbar)) return false;\r\n    if (title instanceof Element) {\r\n      return title.nextElementSibling === toolbar && isUsableWatchMount(title);\r\n    }\r\n    if (metadata instanceof Element) {\r\n      return (\r\n        toolbar.parentElement === metadata &&\r\n        metadata.firstElementChild === toolbar &&\r\n        isUsableWatchMount(metadata)\r\n      );\r\n    }\r\n    if (below instanceof Element) {\r\n      return (\r\n        toolbar.parentElement === below &&\r\n        below.firstElementChild === toolbar &&\r\n        isUsableWatchMount(below)\r\n      );\r\n    }\r\n    if (playerHost instanceof Element) {\r\n      return (\r\n        playerHost.nextElementSibling === toolbar &&\r\n        !playerHost.closest(COLLAPSED_PLAYER_SHELL_SELECTOR)\r\n      );\r\n    }\r\n    if (watch instanceof Element) {\r\n      return toolbar.parentElement === watch;\r\n    }\r\n    return false;\r\n  }\r\n\r\n  function mountPlayerControlsToolbar(\r\n    toolbar,\r\n    title,\r\n    metadata,\r\n    below,\r\n    playerHost,\r\n    watch\r\n  ) {\r\n    if (title instanceof Element) {\r\n      title.insertAdjacentElement('afterend', toolbar);\r\n      return true;\r\n    }\r\n    if (metadata instanceof Element) {\r\n      metadata.insertAdjacentElement('afterbegin', toolbar);\r\n      return true;\r\n    }\r\n    if (below instanceof Element) {\r\n      below.insertAdjacentElement('afterbegin', toolbar);\r\n      return true;\r\n    }\r\n    if (playerHost instanceof Element) {\r\n      playerHost.insertAdjacentElement('afterend', toolbar);\r\n      return true;\r\n    }\r\n    if (watch instanceof Element) {\r\n      watch.append(toolbar);\r\n      return true;\r\n    }\r\n    return false;\r\n  }\r\n\r\n  function ensurePlayerControlsToolbar() {\r\n    if (location.pathname !== '/watch') {\r\n      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID)?.remove();\r\n      return;\r\n    }\r\n\r\n    const title = findWatchTitleAnchor();\r\n    const metadata = findWatchMetadataHost();\r\n    const below = findWatchBelowHost();\r\n    const playerHost = findVisibleWatchPlayerHost();\r\n    const watch = document.querySelector('ytd-watch-flexy');\r\n    const watchChromeExists =\r\n      title instanceof Element ||\r\n      metadata instanceof Element ||\r\n      below instanceof Element ||\r\n      playerHost instanceof Element ||\r\n      watch instanceof Element;\r\n\r\n    if (!watchChromeExists) return;\r\n\r\n    let toolbar = document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID);\r\n    if (\r\n      !(toolbar instanceof HTMLElement) ||\r\n      toolbar.dataset.fypControlsLayout !== PLAYER_CONTROLS_LAYOUT_VERSION\r\n    ) {\r\n      toolbar?.remove();\r\n      toolbar = document.createElement('div');\r\n      toolbar.id = PLAYER_CONTROLS_TOOLBAR_ID;\r\n      toolbar.dataset.fypControlsLayout = PLAYER_CONTROLS_LAYOUT_VERSION;\r\n      toolbar.setAttribute('role', 'toolbar');\r\n      toolbar.setAttribute('aria-label', 'Video player controls');\r\n      toolbar.innerHTML = playerControlsMarkup();\r\n    }\r\n\r\n    if (\r\n      !toolbarIsCorrectlyPlaced(\r\n        toolbar,\r\n        title,\r\n        metadata,\r\n        below,\r\n        playerHost,\r\n        watch\r\n      )\r\n    ) {\r\n      mountPlayerControlsToolbar(\r\n        toolbar,\r\n        title,\r\n        metadata,\r\n        below,\r\n        playerHost,\r\n        watch\r\n      );\r\n    }\r\n    syncCustomPlayerControls();\r\n  }\r\n\r\n  const PLAYER_CONTROLS_TOOLBAR_RETRY_MS = Object.freeze([\r\n    0, 60, 160, 400, 900, 1800, 3500,\r\n  ]);\r\n  let playerControlsToolbarScheduleToken = 0;\r\n\r\n  function schedulePlayerControlsToolbar() {\r\n    const token = ++playerControlsToolbarScheduleToken;\r\n    for (const delay of PLAYER_CONTROLS_TOOLBAR_RETRY_MS) {\r\n      setTimeout(() => {\r\n        if (token !== playerControlsToolbarScheduleToken) return;\r\n        ensurePlayerControlsToolbar();\r\n      }, delay);\r\n    }\r\n  }\r\n\r\n  function enforceSimpleSearchLayout() {\r\n    const onResults = location.pathname.startsWith('/results');\r\n    if (!onResults) {\r\n      document.documentElement.removeAttribute(SIMPLE_SEARCH_ATTR);\r\n      return;\r\n    }\r\n    document.documentElement.setAttribute(SIMPLE_SEARCH_ATTR, 'true');\r\n\r\n    for (const card of document.querySelectorAll('ytd-search ytd-video-renderer')) {\r\n      if (!(card instanceof HTMLElement)) continue;\r\n      const dismissible = card.querySelector('#dismissible');\r\n      const thumb = card.querySelector('ytd-thumbnail');\r\n      const channel = card.querySelector('#channel-info');\r\n      if (\r\n        !(dismissible instanceof HTMLElement) ||\r\n        !(thumb instanceof HTMLElement) ||\r\n        !(channel instanceof HTMLElement) ||\r\n        !dismissible.contains(thumb) ||\r\n        !dismissible.contains(channel)\r\n      ) {\r\n        continue;\r\n      }\r\n      if (\r\n        channel.parentElement !== dismissible ||\r\n        channel.nextElementSibling !== thumb\r\n      ) {\r\n        dismissible.insertBefore(channel, thumb);\r\n      }\r\n    }\r\n\r\n    const clutter = document.querySelectorAll(\r\n      [\r\n        'ytd-search button[aria-label*=\"Summary\" i]',\r\n        'ytd-search button[aria-label*=\"Ask\" i]',\r\n        'ytd-search [aria-label*=\"AI summary\" i]',\r\n        'ytd-search [aria-label*=\"AI overview\" i]',\r\n        'ytd-search ytd-button-renderer:has([aria-label*=\"Summary\" i])',\r\n        'ytd-search ytd-button-renderer:has([aria-label*=\"Ask\" i])',\r\n        'ytd-search ytd-info-panel-container-renderer',\r\n        'ytd-search ytd-clarification-renderer',\r\n        'ytd-search ytd-expandable-metadata-renderer:has([aria-label*=\"Summary\" i])',\r\n        'ytd-search ytd-expandable-metadata-renderer:has([aria-label*=\"AI\" i])',\r\n      ].join(',')\r\n    );\r\n    for (const node of clutter) {\r\n      if (node instanceof HTMLElement) {\r\n        node.style.setProperty('display', 'none', 'important');\r\n        node.style.setProperty('visibility', 'hidden', 'important');\r\n        node.style.setProperty('pointer-events', 'none', 'important');\r\n      }\r\n    }\r\n\r\n    for (const panel of document.querySelectorAll(\r\n      'ytd-search ytd-expandable-metadata-renderer'\r\n    )) {\r\n      if (!(panel instanceof HTMLElement)) continue;\r\n      const text = `${panel.getAttribute('aria-label') || ''} ${\r\n        panel.textContent || ''\r\n      }`.toLowerCase();\r\n      if (text.includes('chapter')) continue;\r\n      if (\r\n        text.includes('summary') ||\r\n        text.includes('ai overview') ||\r\n        text.includes('ask youtube') ||\r\n        text.includes('gemini')\r\n      ) {\r\n        panel.style.setProperty('display', 'none', 'important');\r\n        panel.style.setProperty('visibility', 'hidden', 'important');\r\n        panel.style.setProperty('pointer-events', 'none', 'important');\r\n      }\r\n    }\r\n  }\r\n\r\n  let lastPageScanAt = 0;\r\n\r\n  function scanPage() {\r\n    lastPageScanAt = Date.now();\r\n    ensureViewport();\r\n    if (\r\n      location.pathname.startsWith('/shorts') ||\r\n      location.pathname.startsWith('/playables')\r\n    ) {\r\n      location.replace(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);\r\n      return;\r\n    }\r\n    applyMobileShell();\r\n    enforceSimpleSearchLayout();\r\n    ensureGuideButtonVisible();\r\n    restoreScrollAfterGuideClose();\r\n    hideUploadControls();\r\n    dismissMiniplayer();\r\n    removeFloatingPillNav();\r\n    showWelcomeOnce();\r\n    markSubscribeButtons();\r\n    ensurePlayerControlsToolbar();\r\n    updateMediaSessionMetadata();\r\n    hideAskGeminiControls();\r\n    arrangeWatchComments();\r\n    enhanceComments();\r\n    removeAdCards();\r\n    const video = findVideo();\r\n    if (video) attachVideo(video);\r\n    if (location.pathname === '/watch') void refreshWatchDislikeCount();\r\n  }\r\n\r\n  nativeDocumentAddEventListener('visibilitychange', () => {\r\n    if (isReallyHidden()) {\r\n      prepareForBackground();\r\n    } else if (state.video && !state.video.paused && !state.video.ended) {\r\n      claimMediaSessionOwnership(state.video);\r\n      installMediaSessionHandlers({ force: true });\r\n      updateMediaSessionMetadata();\r\n    }\r\n  }, true);\r\n  nativeDocumentAddEventListener('webkitvisibilitychange', () => {\r\n    if (isReallyHidden()) prepareForBackground();\r\n  }, true);\r\n  nativeDocumentAddEventListener('freeze', prepareForBackground, true);\r\n  nativeDocumentAddEventListener('yt-guide-close', restoreScrollAfterGuideClose, true);\r\n  nativeDocumentAddEventListener(\r\n    'iron-overlay-closed',\r\n    restoreScrollAfterGuideClose,\r\n    true\r\n  );\r\n  nativeDocumentAddEventListener('yt-navigate-finish', () => {\r\n    if (redirectChannelRootToVideos()) return;\r\n    if (\r\n      location.pathname.startsWith('/shorts') ||\r\n      location.pathname.startsWith('/playables')\r\n    ) {\r\n      location.replace(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);\r\n      return;\r\n    }\r\n    removeFloatingPillNav();\r\n    updateMobileNavigation();\r\n    hideNativeNavigationAndShorts();\r\n    enforceSimpleSearchLayout();\r\n    ensureGuideButtonVisible();\r\n    restoreScrollAfterGuideClose();\r\n    hideUploadControls();\r\n    dismissMiniplayer();\r\n    schedulePlayerControlsToolbar();\r\n    closeMobileSearch();\r\n    arrangeWatchComments();\r\n    enhanceComments();\r\n    if (location.pathname === '/watch') {\r\n      void refreshWatchDislikeCount({ force: true });\r\n    }\r\n  }, true);\r\n  nativeDocumentAddEventListener(\r\n    'PointerEvent' in window ? 'pointerdown' : 'touchstart',\r\n    recordPlayerControlIntent,\r\n    { capture: true, passive: true }\r\n  );\r\n  nativeDocumentAddEventListener(\r\n    'PointerEvent' in window ? 'pointerdown' : 'touchstart',\r\n    handlePlayerControlActionCapture,\r\n    { capture: true, passive: false }\r\n  );\r\n  nativeDocumentAddEventListener(\r\n    'PointerEvent' in window ? 'pointerup' : 'touchend',\r\n    handlePlayerControlActionCapture,\r\n    { capture: true, passive: false }\r\n  );\r\n  nativeDocumentAddEventListener(\r\n    'PointerEvent' in window ? 'pointercancel' : 'touchcancel',\r\n    handlePlayerControlActionCapture,\r\n    { capture: true, passive: true }\r\n  );\r\n  nativeDocumentAddEventListener(\r\n    'PointerEvent' in window ? 'pointerdown' : 'touchstart',\r\n    closePlayerControlMenuFromOutside,\r\n    true\r\n  );\r\n  // Only use click when PointerEvent is unavailable. Dual pointerdown+click\r\n  // made option taps close the menu and then re-hit Captions/More underneath.\r\n  if (!('PointerEvent' in window)) {\r\n    nativeDocumentAddEventListener(\r\n      'click',\r\n      handlePlayerControlActionCapture,\r\n      true\r\n    );\r\n  }\r\n  nativeDocumentAddEventListener(\r\n    'scroll',\r\n    enforceHorizontalViewportLock,\r\n    { capture: true, passive: true }\r\n  );\r\n  nativeWindowAddEventListener('scroll', enforceHorizontalViewportLock, {\r\n    passive: true,\r\n  });\r\n  nativeDocumentAddEventListener('click', blockShortsNavigation, true);\r\n  nativeDocumentAddEventListener('click', redirectChannelLinkToVideos, true);\r\n  nativeDocumentAddEventListener('click', handleMobileSearchClick, true);\r\n  nativeDocumentAddEventListener('touchstart', handleMobileSearchClick, {\r\n    capture: true,\r\n    passive: false,\r\n  });\r\n  nativeDocumentAddEventListener(\r\n    'submit',\r\n    (event) => {\r\n      if (event.target?.closest?.('ytd-masthead')) {\r\n        setTimeout(closeMobileSearch, 0);\r\n      }\r\n    },\r\n    true\r\n  );\r\n  nativeDocumentAddEventListener(\r\n    'keydown',\r\n    (event) => {\r\n      if (event.key !== 'Escape') return;\r\n      closeMobileSearch();\r\n    },\r\n    true\r\n  );\r\n  nativeWindowAddEventListener('blur', () => {\r\n    if (state.video && !state.video.paused) prepareForBackground();\r\n  }, true);\r\n  nativeWindowAddEventListener('pagehide', prepareForBackground, true);\r\n  nativeWindowAddEventListener('storage', (event) => {\r\n    if (event.key !== MEDIA_SESSION_OWNER_KEY) return;\r\n    if (ownsMediaSession()) {\r\n      installMediaSessionHandlers({ force: true });\r\n      updateMediaSessionMetadata();\r\n    } else {\r\n      deactivateMediaSessionForThisTab();\r\n    }\r\n  }, true);\r\n  nativeWindowAddEventListener('popstate', () => {\r\n    removeFloatingPillNav();\r\n    dismissMiniplayer();\r\n    updateMobileNavigation();\r\n    schedulePlayerControlsToolbar();\r\n  }, true);\r\n  nativeWindowAddEventListener('pageshow', () => {\r\n    schedulePlayerControlsToolbar();\r\n  }, true);\r\n\r\n  injectStyle();\r\n  applyMobileShell();\r\n  schedulePlayerControlsToolbar();\r\n\r\n  if (document.readyState === 'loading') {\r\n    nativeDocumentAddEventListener('DOMContentLoaded', scanPage, { once: true });\r\n  } else {\r\n    scanPage();\r\n  }\r\n\r\n  let scanQueued = false;\r\n  const observer = new MutationObserver(() => {\r\n    if (scanQueued) return;\r\n    scanQueued = true;\r\n    const delay = Math.max(\r\n      0,\r\n      PAGE_SCAN_MIN_INTERVAL_MS - (Date.now() - lastPageScanAt)\r\n    );\r\n    setTimeout(() => {\r\n      scanQueued = false;\r\n      scanPage();\r\n    }, delay);\r\n  });\r\n  observer.observe(document.documentElement || document, {\r\n    childList: true,\r\n    subtree: true,\r\n  });\r\n\r\n  // Player overlays and WebKit caption tracks can change between DOM scans.\r\n  setInterval(() => {\r\n    skipPlayerAd();\r\n    dismissAdBlockEnforcement();\r\n    suppressDuplicateNativeCaptions();\r\n  }, 300);\r\n  setInterval(() => {\r\n    markSubscribeButtons();\r\n    ensurePlayerControlsToolbar();\r\n    syncCustomPlayerControls();\r\n    hideAskGeminiControls();\r\n    ensureGuideButtonVisible();\r\n    restoreScrollAfterGuideClose();\r\n    hideUploadControls();\r\n    hideNativeNavigationAndShorts();\r\n    dismissMiniplayer();\r\n    removeFloatingPillNav();\r\n    hideShortsGuideEntries(document);\r\n    for (const video of document.querySelectorAll('video')) {\r\n      enforceInlinePlayback(video);\r\n    }\r\n    if (location.pathname === '/watch') arrangeWatchComments();\r\n  }, 1200);\r\n  setInterval(() => {\r\n    if (ownsMediaSession()) {\r\n      renewMediaSessionOwnership(state.video);\r\n      installMediaSessionHandlers({ force: true });\r\n      updateMediaSessionMetadata();\r\n    } else {\r\n      deactivateMediaSessionForThisTab();\r\n    }\r\n  }, MEDIA_SESSION_REFRESH_MS);\r\n})();\r\n";

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
      let code =
        typeof __fyp_embedded_page_code === 'string' && __fyp_embedded_page_code
          ? __fyp_embedded_page_code
          : null;
      if (!code) {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`page.js returned ${response.status}`);
        code = await response.text();
      }
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

  // FORCE INJECTION: Inject immediately at document_start without waiting
  if (!pageRuntimeReady()) injectWithText();

  if (!injectWithSrc()) {
    const observer = new MutationObserver(() => {
      if (!pageRuntimeReady()) injectWithText();
      if (injectWithSrc()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }

  // A tag can exist without executing in Orion. Verify a PAGE-world handshake.
  for (const delay of [0, 20, 50, 100, 200, 500, 1200]) {
    setTimeout(() => {
      if (!pageRuntimeReady()) injectWithText();
    }, delay);
  }
})();
