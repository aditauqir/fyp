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
  const EXPECTED_PAGE_VERSION = '3.2.3';
  const HISTORY_FEED_ATTR = 'data-fyp-feed';
  const DOM_FALLBACK_STYLE_ID = 'fyp-orion-dom-fallback-style';
  const PLAYER_CONTROLS_TOOLBAR_ID =
    'yt-mobile-orion-ext-controls-toolbar';
  const PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v320-visible-watch';
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
  const FALLBACK_SHORTS_REMOVAL_SELECTOR = [
    'a[href^="/shorts"]',
    'a[href*="/shorts/"]',
    'a[href*="youtube.com/shorts/"]',
    'a[href^="/playables"]',
    'a[href*="/playables/"]',
    'a[href*="youtube.com/playables"]',
    'button[aria-label="Shorts"]',
    'button[title="Shorts"]',
    '[aria-label="Shorts"]',
    '[title="Shorts"]',
    '[aria-label*="Playables" i]',
    '[title*="Playables" i]',
    '[is-shorts]',
    '[is-playables]',
    '[is-playable]',
    'ytd-reel-shelf-renderer',
    'ytm-reel-shelf-renderer',
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'ytd-reel-item-renderer',
    'ytm-reel-item-renderer',
    'yt-playable-game-renderer',
    'ytd-game-card-renderer',
    'ytd-playable-renderer',
    'ytd-playables-shelf-renderer',
    'yt-playables-shelf-renderer',
  ].join(',');
  const FALLBACK_SHORTS_CONTAINER_SELECTOR = [
    'ytm-pivot-bar-item-renderer',
    'ytd-guide-entry-renderer',
    'ytd-mini-guide-entry-renderer',
    'yt-tab-shape',
    '[role="tab"]',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-rich-shelf-renderer',
    'ytd-rich-section-renderer',
    'ytd-reel-shelf-renderer',
    'ytd-reel-item-renderer',
    'ytm-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'yt-lockup-view-model',
    'tp-yt-paper-item',
    'grid-shelf-view-model',
  ].join(',');
  let fallbackShortsObserver = null;
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

  // Trusted Types can reject innerHTML on YouTube pages. Use XML parsing plus
  // DOM nodes so a rejected icon cannot stop the fallback before video setup.
  function svgElementFromMarkup(markup) {
    try {
      const text = String(markup || '').trim();
      const source = text.startsWith('<svg')
        ? text
        : `<svg viewBox="0 0 24 24" aria-hidden="true">${text}</svg>`;
      const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
      const svg = parsed?.documentElement;
      if (!svg || String(svg.localName).toLowerCase() !== 'svg') return null;
      return document.importNode(svg, true);
    } catch {
      return null;
    }
  }

  function replaceIconContents(element, markup) {
    if (!(element instanceof Element)) return;
    const svg = svgElementFromMarkup(markup);
    if (svg) element.replaceChildren(svg);
    else element.replaceChildren();
  }

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

  function createPlayerControlButton(action, label, icon, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = extraClass
      ? `fyp-player-control ${extraClass}`
      : 'fyp-player-control';
    button.dataset.fypPlayerAction = action;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-pressed', 'false');
    if (action === 'speed' || action === 'quality') {
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
    }
    replaceIconContents(button, icon);
    return button;
  }

  function createPlayerControlButtons() {
    return [
      ['rewind', 'Back 10 seconds', PLAYER_CONTROL_ICONS.rewind],
      ['play-pause', 'Play', PLAYER_CONTROL_ICONS.play],
      ['forward', 'Forward 10 seconds', PLAYER_CONTROL_ICONS.forward],
      ['pip', 'Picture in Picture', PLAYER_CONTROL_ICONS.pip],
      ['airplay', 'AirPlay', PLAYER_CONTROL_ICONS.airplay],
      ['fullscreen', 'Fullscreen', PLAYER_CONTROL_ICONS.fullscreen],
    ].map(([action, label, icon]) =>
      createPlayerControlButton(action, label, icon)
    );
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
    video.setAttribute('data-fyp-inline-playback', 'true');
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
    const activeWatch = findFallbackVisibleWatchRoot();
    const watchVideo = activeWatch?.querySelector(
      '#movie_player video.html5-main-video:not([data-no-fullscreen]), ' +
        '#player-container video.html5-main-video:not([data-no-fullscreen]), ' +
        'ytd-player#ytd-player video.html5-main-video:not([data-no-fullscreen])'
    );
    const routedVideos = activeWatch
      ? [...activeWatch.querySelectorAll('video')]
      : [...document.querySelectorAll('video')].filter(
          (video) => !video.closest('ytd-watch-flexy')
        );
    const video =
      stateVideo ||
      watchVideo ||
      routedVideos.find((candidate) =>
        candidate.classList.contains('html5-main-video')
      ) ||
      routedVideos[0];
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
        replaceIconContents(
          playButton,
          paused ? PLAYER_CONTROL_ICONS.play : PLAYER_CONTROL_ICONS.pause
        );
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
    replaceIconContents(button, PLAYER_CONTROL_ICONS.collapse);
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
    const player = findFallbackActivePlayer();
    if (!player || typeof player.getOption !== 'function') return [];
    try {
      const tracks = player.getOption('captions', 'tracklist');
      return Array.isArray(tracks) ? tracks : [];
    } catch {
      return [];
    }
  }

  function selectFallbackYouTubeCaptionTrack(selectedTrack) {
    const player = findFallbackActivePlayer();
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
    const player = findFallbackActivePlayer();
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
    const player = findFallbackActivePlayer();
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
    const player = findFallbackActivePlayer();
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
    const player = findFallbackActivePlayer();
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
          const player = findFallbackActivePlayer();
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
            findFallbackActivePlayer()?.setPlaybackRate?.(speed);
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
    const watch = findFallbackVisibleWatchRoot();
    if (!watch) return null;
    const selectors = [
      'ytd-watch-metadata #title',
      'ytd-video-primary-info-renderer #title',
      'ytd-watch-metadata h1',
      '#below h1',
    ];
    for (const selector of selectors) {
      for (const candidate of watch.querySelectorAll(selector)) {
        if (!isFallbackUsableWatchMount(candidate)) continue;
        return candidate.closest('#title') || candidate;
      }
    }
    return null;
  }

  function findFallbackWatchMetadataHost() {
    const watch = findFallbackVisibleWatchRoot();
    if (!watch) return null;
    const selectors = [
      'ytd-watch-metadata',
      'ytd-video-primary-info-renderer',
    ];
    for (const selector of selectors) {
      for (const candidate of watch.querySelectorAll(selector)) {
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
    const watch = node.closest('ytd-watch-flexy');
    if (watch && !isFallbackVisibleWatchRoot(watch)) return false;
    if (node.closest(FALLBACK_COLLAPSED_PLAYER_SHELL_SELECTOR)) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  function isFallbackVisibleWatchRoot(watch) {
    if (!(watch instanceof Element) || !watch.isConnected) return false;
    for (let node = watch; node instanceof Element; node = node.parentElement) {
      if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') {
        return false;
      }
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  function findFallbackVisibleWatchRoot() {
    const candidates = [
      ...document.querySelectorAll(
        'ytd-app[is-watch-page] ytd-watch-flexy, ytd-watch-flexy[video-id], ytd-watch-flexy'
      ),
    ];
    return candidates.find(isFallbackVisibleWatchRoot) || null;
  }

  function findFallbackActivePlayer() {
    const watch = findFallbackVisibleWatchRoot();
    const player = watch?.querySelector('#movie_player, .html5-video-player');
    return player instanceof HTMLElement ? player : null;
  }

  function findFallbackWatchBelowHost() {
    const watch = findFallbackVisibleWatchRoot();
    if (!watch) return null;
    const selectors = [
      '#below',
      '#primary-inner',
    ];
    for (const selector of selectors) {
      const candidate = watch.querySelector(selector);
      if (isFallbackUsableWatchMount(candidate)) return candidate;
    }
    return null;
  }

  function findFallbackVisibleWatchPlayerHost() {
    const watch = findFallbackVisibleWatchRoot();
    if (!watch) return null;
    const fullBleed =
      watch.hasAttribute('full-bleed-player') ||
      watch.hasAttribute('theater');
    const selectors = fullBleed
      ? [
          '#player-full-bleed-container',
          '#player-container-outer',
          '#player',
        ]
      : [
          '#player-container-outer',
          '#player',
          '#player-full-bleed-container',
        ];
    for (const selector of selectors) {
      const candidate = watch.querySelector(selector);
      if (!(candidate instanceof Element) || !candidate.isConnected) continue;
      if (candidate.closest(FALLBACK_COLLAPSED_PLAYER_SHELL_SELECTOR)) continue;
      if (candidate.closest('[hidden]')) continue;
      const style = getComputedStyle(candidate);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
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
    const watch = findFallbackVisibleWatchRoot();
    if (!watch) {
      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID)?.remove();
      return;
    }
    const title = findFallbackWatchTitleAnchor();
    const metadata = findFallbackWatchMetadataHost();
    const below = findFallbackWatchBelowHost();
    const playerHost = findFallbackVisibleWatchPlayerHost();
    const watchChromeExists =
      title instanceof Element ||
      metadata instanceof Element ||
      below instanceof Element ||
      playerHost instanceof Element ||
      isFallbackVisibleWatchRoot(watch);
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
      toolbar.replaceChildren(...createPlayerControlButtons());
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

  function isFallbackShortsOrPlayablesHref(href) {
    return /(?:^|\/)(?:shorts|playables)(?:\/|$|\?)/i.test(String(href || ''));
  }

  function concealFallbackShortsElement(element) {
    if (!(element instanceof Element)) return;
    if (element.dataset.fypShortsHidden === 'true') return;
    for (const [property, value] of Object.entries({
      display: 'none',
      visibility: 'hidden',
      'pointer-events': 'none',
      height: '0',
      margin: '0',
      padding: '0',
      overflow: 'hidden',
    })) {
      element.style.setProperty(property, value, 'important');
    }
    element.setAttribute('aria-hidden', 'true');
    element.hidden = true;
    element.dataset.fypShortsHidden = 'true';
  }

  function removeFallbackShorts(root = document) {
    const candidates = new Set();
    const collect = (node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(FALLBACK_SHORTS_REMOVAL_SELECTOR)) candidates.add(node);
      node.querySelectorAll?.(FALLBACK_SHORTS_REMOVAL_SELECTOR).forEach((element) => {
        candidates.add(element);
      });

      const entrySelector =
        'ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ' +
        'ytm-pivot-bar-item-renderer, tp-yt-paper-item, yt-list-item-view-model';
      const entries = [];
      if (node.matches(entrySelector)) entries.push(node);
      entries.push(...(node.querySelectorAll?.(entrySelector) || []));
      for (const entry of entries) {
        const href = [...(entry.querySelectorAll?.('a[href]') || [])]
          .map((link) => link.getAttribute('href') || link.href)
          .join(' ');
        const label = [
          entry.getAttribute('title'),
          entry.getAttribute('aria-label'),
          entry.textContent,
        ]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (
          isFallbackShortsOrPlayablesHref(href) ||
          /^(shorts|playables)\b/i.test(label) ||
          (/mini[\s-]?games/i.test(label) && label.length < 48)
        ) {
          candidates.add(entry);
        }
      }

      node.querySelectorAll?.(
        'ytd-rich-shelf-renderer, ytd-rich-section-renderer, grid-shelf-view-model'
      ).forEach((shelf) => {
        const heading = (
          shelf.querySelector?.(
            '#title, #title-text, .title, yt-formatted-string, h2, [id*="title"]'
          )?.textContent || ''
        ).trim();
        const ariaLabel = shelf.getAttribute?.('aria-label') || '';
        const hasShortsHref = [...(shelf.querySelectorAll?.('a[href]') || [])].some(
          (link) => isFallbackShortsOrPlayablesHref(link.getAttribute('href') || link.href)
        );
        if (
          hasShortsHref ||
          /shorts|playables|mini[\s-]?games/i.test(heading) ||
          /shorts|playables|mini[\s-]?games/i.test(ariaLabel)
        ) {
          candidates.add(shelf);
        }
      });
    };

    if (root instanceof Element) collect(root);
    root.querySelectorAll?.(FALLBACK_SHORTS_REMOVAL_SELECTOR).forEach((element) => {
      candidates.add(element);
    });
    root.querySelectorAll?.(
      'ytd-rich-shelf-renderer, ytd-rich-section-renderer, grid-shelf-view-model'
    ).forEach((shelf) => collect(shelf));

    for (const candidate of candidates) {
      const item =
        candidate.closest(FALLBACK_SHORTS_CONTAINER_SELECTOR) || candidate;
      concealFallbackShortsElement(item);
    }
  }

  function blockFallbackShortsNavigation(event) {
    const link = event.target?.closest?.('a[href]');
    if (!link || !isFallbackShortsOrPlayablesHref(link.getAttribute('href') || link.href)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign('https://www.youtube.com/?app=desktop&persist_app=1');
  }

  function installFallbackShortsObserver() {
    if (fallbackShortsObserver) return;
    removeFallbackShorts(document);
    fallbackShortsObserver = new MutationObserver((mutations) => {
      const roots = new Set();
      for (const mutation of mutations) {
        if (mutation.target instanceof Element) roots.add(mutation.target);
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) roots.add(node);
        }
      }
      for (const root of roots) removeFallbackShorts(root);
    });
    fallbackShortsObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
    document.addEventListener('yt-navigate-start', () => removeFallbackShorts(document), true);
    document.addEventListener('yt-navigate-finish', () => removeFallbackShorts(document), true);
    window.addEventListener('popstate', () => removeFallbackShorts(document), true);
    window.addEventListener('pageshow', () => removeFallbackShorts(document), true);
  }

  function installDomFallbacks() {
    if (redirectChannelRootToVideos()) return;
    redirectShorts();
    installFallbackShortsObserver();
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

    document.addEventListener('click', blockFallbackShortsNavigation, true);
    document.addEventListener('pointerdown', blockFallbackShortsNavigation, {
      capture: true,
      passive: false,
    });
    document.addEventListener('touchstart', blockFallbackShortsNavigation, {
      capture: true,
      passive: false,
    });
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
          z-index: 100 !important;
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          isolation: isolate !important;
          flex-wrap: wrap !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          min-height: 4rem !important;
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

  const __fyp_embedded_page_code = "/* Fyoutube \u2014 page context bundle */\n/* Generated by rebuild-extension.sh \u2014 edit youtube-mobile-background.user.js, then rebuild. */\n(() => {\n  'use strict';\n\n  document.documentElement?.setAttribute('data-fyp-page-ready', '3.2.3');\n\n  /*\n   * Pristine timers for FYP-owned work (background recovery, controls hold, scans).\n   * YouTube CPU Tamer patches window.* for YouTube only \u2014 see installYoutubeCpuTamer.\n   * On Orion iPhone, rAF does not run while the document is hidden; FYP must not\n   * route recoverPlayback through rAF-gated timers.\n   * 2.2.12: tamer is OFF by default \u2014 wrapping setTimeout/setInterval during\n   * timeupdate starved caption painting and slowed player init on Orion.\n   */\n  const setTimeout = window.setTimeout.bind(window);\n  const setInterval = window.setInterval.bind(window);\n  const clearTimeout = window.clearTimeout.bind(window);\n  const clearInterval = window.clearInterval.bind(window);\n  const requestAnimationFrame = window.requestAnimationFrame.bind(window);\n\n  const SCRIPT_ID = 'yt-mobile-orion-ext';\n  const STYLE_ID = `${SCRIPT_ID}-style`;\n  const NAV_ID = `${SCRIPT_ID}-nav`;\n  const WELCOME_ID = `${SCRIPT_ID}-welcome`;\n  const PLAYER_CONTROLS_TOOLBAR_ID = `${SCRIPT_ID}-controls-toolbar`;\n  const PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v320-visible-watch';\n  const WELCOME_KEY = `${SCRIPT_ID}:welcome-shown`;\n  const BACKEND_HOST = 'www.youtube.com';\n  const CHANNEL_ROOT_PATH_PATTERN =\n    /^\\/(?:@[^/]+|channel\\/[^/]+|c\\/[^/]+|user\\/[^/]+)\\/?$/;\n  const NAV_LAYOUT_VERSION = 'ext-v314-search-overlay';\n  const CPU_TAMER_FLAG = '__fypYoutubeCpuTamer';\n  /** Off by default on Orion \u2014 opt in via __fypEnableCpuTamer or localStorage. */\n  const CPU_TAMER_ENABLED_BY_DEFAULT = false;\n  const RYD_API_URL = 'https://returnyoutubedislikeapi.com';\n  const RYD_CACHE_TTL_MS = 5 * 60 * 1000;\n  const RYD_TEXT_ATTR = 'data-fyp-dislike-count';\n  const rydCache = new Map();\n  const rydPending = new Set();\n  let rydDislikeObserver = null;\n  let rydObservedHost = null;\n  let rydReapplyQueued = false;\n  const HISTORY_FEED_ATTR = 'data-fyp-feed';\n  const SIMPLE_SEARCH_ATTR = 'data-fyp-simple-search';\n  const MOBILE_SEARCH_OPEN_ATTR = 'data-fyp-mobile-search-open';\n  const SEARCH_OVERLAY_ID = 'fyp-search-overlay';\n  const SEARCH_OVERLAY_FORM_ID = 'fyp-search-overlay-form';\n  const SEARCH_OVERLAY_INPUT_ID = 'fyp-search-overlay-input';\n  const SEARCH_BUTTON_ICON_MARKUP =\n    '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"icon icon-tabler icons-tabler-outline icon-tabler-search\" aria-hidden=\"true\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"></path><path d=\"M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\"></path><path d=\"M21 21l-6 -6\"></path></svg>';\n  const MOBILE_SEARCH_TRIGGER_SELECTOR = [\n    'ytd-masthead #search-button',\n    'ytd-masthead #search-button-narrow',\n    'ytd-masthead #search-icon-legacy',\n    'ytd-masthead button[aria-label=\"Search\"]',\n    'ytd-masthead [role=\"button\"][aria-label=\"Search\"]',\n    'ytd-masthead yt-icon-button[aria-label=\"Search\"]',\n    'ytd-masthead yt-searchbox',\n    'ytd-masthead ytd-searchbox',\n    'ytd-masthead .ytSearchboxComponentSearchButton',\n  ].join(',');\n  const PLAYER_CONTROLS_VISIBLE_MS = 10000;\n  const MENU_OPTION_TAP_SLOP_PX = 12;\n  const MEDIA_SESSION_OWNER_KEY = 'fyp:media-session-owner:v1';\n  const MEDIA_SESSION_TAB_ATTR = 'data-fyp-media-session-tab';\n  const MEDIA_SESSION_LEASE_MS = 15000;\n  const MEDIA_SESSION_REFRESH_MS = 5000;\n  const PAGE_SCAN_MIN_INTERVAL_MS = 1200;\n  const SHORTS_REMOVAL_SELECTOR = [\n    'a[href^=\"/shorts\"]',\n    'a[href*=\"/shorts/\"]',\n    'a[href*=\"youtube.com/shorts/\"]',\n    'a[href^=\"/playables\"]',\n    'a[href*=\"/playables/\"]',\n    'a[href*=\"youtube.com/playables\"]',\n    'button[aria-label=\"Shorts\"]',\n    'button[title=\"Shorts\"]',\n    '[aria-label=\"Shorts\"]',\n    '[title=\"Shorts\"]',\n    '[aria-label*=\"Playables\" i]',\n    '[title*=\"Playables\" i]',\n    '[is-shorts]',\n    '[is-playables]',\n    '[is-playable]',\n    'ytd-reel-shelf-renderer',\n    'ytm-reel-shelf-renderer',\n    'ytm-shorts-lockup-view-model',\n    'ytm-shorts-lockup-view-model-v2',\n    'ytd-reel-item-renderer',\n    'ytm-reel-item-renderer',\n    'yt-playable-game-renderer',\n    'ytd-game-card-renderer',\n    'ytd-playable-renderer',\n    'ytd-playables-shelf-renderer',\n    'yt-playables-shelf-renderer',\n  ].join(',');\n  const SHORTS_REMOVAL_CONTAINER_SELECTOR = [\n    'ytm-pivot-bar-item-renderer',\n    'ytd-guide-entry-renderer',\n    'ytd-mini-guide-entry-renderer',\n    'yt-tab-shape',\n    '[role=\"tab\"]',\n    'ytd-rich-item-renderer',\n    'ytd-video-renderer',\n    'ytd-grid-video-renderer',\n    'ytd-rich-shelf-renderer',\n    'ytd-rich-section-renderer',\n    'ytd-reel-shelf-renderer',\n    'ytd-reel-item-renderer',\n    'ytm-reel-item-renderer',\n    'ytm-shorts-lockup-view-model',\n    'ytm-shorts-lockup-view-model-v2',\n    'yt-lockup-view-model',\n    'tp-yt-paper-item',\n    'grid-shelf-view-model',\n  ].join(',');\n  let shortsRemovalObserver = null;\n  const FALLBACK_QUALITY_LEVELS = Object.freeze([\n    'auto',\n    'hd1080',\n    'hd720',\n    'large',\n    'medium',\n    'small',\n    'tiny',\n  ]);\n  /*\n   * Orion's floating address bar overlays the bottom of the page (like Safari).\n   * Keep floating controls above that chrome so they stay tappable.\n   */\n  const ORION_NAV_GAP = '72px';\n  const FYP_OWNED_SELECTOR = [\n    `#${PLAYER_CONTROLS_TOOLBAR_ID}`,\n    '[data-fyp-player-action]',\n    '[data-fyp-player-option]',\n  ].join(',');\n\n  /*\n   * Search recovery: hide Ask/voice/AI clutter early, then let the stable FYP\n   * overlay own the search interaction instead of depending on YouTube's\n   * changing masthead input implementation.\n   */\n  const CRITICAL_STYLE_ID = `${SCRIPT_ID}-critical-style`;\n  function injectCriticalAskHideStyle() {\n    if (document.getElementById(CRITICAL_STYLE_ID)) return;\n    const style = document.createElement('style');\n    style.id = CRITICAL_STYLE_ID;\n    style.textContent = `\n      ytd-masthead #voice-search-button,\n      ytd-masthead button[aria-label*='Search with your voice' i],\n      ytd-masthead button[aria-label*='Voice search' i],\n      ytd-masthead [aria-label*='Ask YouTube' i],\n      ytd-masthead [aria-label*='Ask Gemini' i],\n      #voice-search-button,\n      button[aria-label*='Search with your voice' i],\n      button[aria-label*='Voice search' i],\n      [aria-label*='Ask YouTube' i],\n      [aria-label*='Ask Gemini' i] {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n      }\n\n      /* Search is a FYP-owned layer. Keep it independent from YouTube's\n       * changing masthead DOM, including the modern textarea searchbox. */\n      #${SEARCH_OVERLAY_ID} {\n        box-sizing: border-box !important;\n        position: fixed !important;\n        top: 0 !important;\n        right: 0 !important;\n        bottom: 0 !important;\n        left: 0 !important;\n        z-index: 2147483647 !important;\n        display: none !important;\n        align-items: flex-start !important;\n        justify-content: center !important;\n        width: 100vw !important;\n        height: 100vh !important;\n        padding: calc(env(safe-area-inset-top, 0px) + 12px) 12px 12px !important;\n        color: var(--yt-spec-text-primary, #0f0f0f) !important;\n        background: rgba(0, 0, 0, .38) !important;\n        backdrop-filter: blur(4px) !important;\n        -webkit-backdrop-filter: blur(4px) !important;\n        pointer-events: auto !important;\n      }\n\n      #${SEARCH_OVERLAY_ID}[data-open='true'] {\n        display: flex !important;\n      }\n\n      #${SEARCH_OVERLAY_ID} [data-fyp-search-dialog] {\n        box-sizing: border-box !important;\n        width: min(640px, 100%) !important;\n        max-width: 640px !important;\n        margin: 0 auto !important;\n        padding: 4px !important;\n        background: var(--yt-spec-base-background, #fff) !important;\n        border: 1px solid rgba(0, 0, 0, .16) !important;\n        border-radius: 28px !important;\n        box-shadow: 0 12px 36px rgba(0, 0, 0, .28) !important;\n        pointer-events: auto !important;\n      }\n\n      #${SEARCH_OVERLAY_ID} form {\n        box-sizing: border-box !important;\n        display: flex !important;\n        align-items: center !important;\n        width: 100% !important;\n        min-height: 48px !important;\n        margin: 0 !important;\n        padding: 0 6px 0 16px !important;\n      }\n\n      #${SEARCH_OVERLAY_INPUT_ID} {\n        box-sizing: border-box !important;\n        flex: 1 1 auto !important;\n        width: 100% !important;\n        min-width: 0 !important;\n        height: 42px !important;\n        margin: 0 !important;\n        padding: 0 8px 0 0 !important;\n        color: var(--yt-spec-text-primary, #0f0f0f) !important;\n        background: transparent !important;\n        border: 0 !important;\n        outline: 0 !important;\n        box-shadow: none !important;\n        font: 400 16px/42px Roboto, Arial, sans-serif !important;\n        -webkit-appearance: none !important;\n      }\n\n      #${SEARCH_OVERLAY_INPUT_ID}::placeholder {\n        color: var(--yt-spec-text-secondary, #606060) !important;\n        opacity: 1 !important;\n      }\n\n      #${SEARCH_OVERLAY_ID} button[type='submit'] {\n        box-sizing: border-box !important;\n        flex: 0 0 auto !important;\n        width: 44px !important;\n        min-width: 44px !important;\n        height: 44px !important;\n        margin: 0 !important;\n        padding: 9px !important;\n        color: #fff !important;\n        background: #0f0f0f !important;\n        border: 0 !important;\n        border-radius: 50% !important;\n        cursor: pointer !important;\n        touch-action: manipulation !important;\n      }\n\n      #${SEARCH_OVERLAY_ID} button[type='submit'] svg {\n        display: block !important;\n        width: 24px !important;\n        height: 24px !important;\n        fill: none !important;\n        stroke: currentColor !important;\n        stroke-width: 2 !important;\n        stroke-linecap: round !important;\n        stroke-linejoin: round !important;\n      }\n\n      html[dark] #${SEARCH_OVERLAY_ID} [data-fyp-search-dialog],\n      html[dark-theme] #${SEARCH_OVERLAY_ID} [data-fyp-search-dialog],\n      ytd-app[dark] #${SEARCH_OVERLAY_ID} [data-fyp-search-dialog] {\n        color: #f1f1f1 !important;\n        background: #212121 !important;\n        border-color: rgba(255, 255, 255, .22) !important;\n        box-shadow: 0 12px 36px rgba(0, 0, 0, .58) !important;\n      }\n\n      html[dark] #${SEARCH_OVERLAY_INPUT_ID},\n      html[dark-theme] #${SEARCH_OVERLAY_INPUT_ID},\n      ytd-app[dark] #${SEARCH_OVERLAY_INPUT_ID} {\n        color: #fff !important;\n      }\n\n      html[dark] #${SEARCH_OVERLAY_INPUT_ID}::placeholder,\n      html[dark-theme] #${SEARCH_OVERLAY_INPUT_ID}::placeholder,\n      ytd-app[dark] #${SEARCH_OVERLAY_INPUT_ID}::placeholder {\n        color: #aaa !important;\n      }\n\n      html[data-fyp-search-active='true'] ytd-masthead #center,\n      html[data-fyp-search-active='true'] ytd-masthead #end {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n      }\n    `;\n    const host = document.documentElement || document.head;\n    if (host) host.appendChild(style);\n  }\n  injectCriticalAskHideStyle();\n\n  /*\n   * YouTube CPU Tamer by AnimationFrame \u2014 adapted for FYP page-world on Orion iOS.\n   * Original: CY Fung, MIT \u2014 https://greasyfork.org/en/scripts/431573\n   * Requires GPU acceleration. Fail soft (skip) if WebGL or clean timers unavailable.\n   * Patches window timers only; FYP locals above stay pristine for background audio.\n   */\n  function shouldInstallYoutubeCpuTamer(win = window) {\n    try {\n      if (win.__fypEnableCpuTamer === true) return true;\n      if (win.__fypEnableCpuTamer === false) return false;\n      const stored = win.localStorage?.getItem('fypEnableCpuTamer');\n      if (stored === '1' || stored === 'true') return true;\n      if (stored === '0' || stored === 'false') return false;\n    } catch {\n      // localStorage may be blocked in some embeds.\n    }\n    return CPU_TAMER_ENABLED_BY_DEFAULT;\n  }\n\n  function installYoutubeCpuTamer(win = window) {\n    try {\n      if (win[CPU_TAMER_FLAG]) return;\n      win[CPU_TAMER_FLAG] = true;\n    } catch {\n      return;\n    }\n\n    const isGPUAccelerationAvailable = (() => {\n      try {\n        const canvas = document.createElement('canvas');\n        return !!(\n          canvas.getContext('webgl') || canvas.getContext('experimental-webgl')\n        );\n      } catch {\n        return false;\n      }\n    })();\n\n    if (!isGPUAccelerationAvailable) {\n      try {\n        delete win[CPU_TAMER_FLAG];\n      } catch {\n        win[CPU_TAMER_FLAG] = false;\n      }\n      return;\n    }\n\n    /** @type {globalThis.PromiseConstructor} */\n    const PromiseCtor = (async () => {})().constructor;\n    const PromiseExternal = ((resolve_, reject_) => {\n      const h = (resolve, reject) => {\n        resolve_ = resolve;\n        reject_ = reject;\n      };\n      return class PromiseExternal extends PromiseCtor {\n        constructor(cb = h) {\n          super(cb);\n          if (cb === h) {\n            this.resolve = resolve_;\n            this.reject = reject_;\n          }\n        }\n      };\n    })();\n\n    const timeupdateDT = (() => {\n      win.__fypCpuTamerTimeupdate__ = 1;\n      document.addEventListener(\n        'timeupdate',\n        () => {\n          win.__fypCpuTamerTimeupdate__ = Date.now();\n        },\n        true\n      );\n      let kz = -1;\n      try {\n        kz = win.top.__fypCpuTamerTimeupdate__;\n      } catch {\n        // Cross-origin top frame.\n      }\n      return kz >= 1\n        ? () => win.top.__fypCpuTamerTimeupdate__\n        : () => win.__fypCpuTamerTimeupdate__;\n    })();\n\n    const cleanContext = async (targetWin) => {\n      const waitFn = requestAnimationFrame;\n      try {\n        let mx = 16;\n        const frameId = 'fyp-vanillajs-iframe-v1';\n        let frame = document.getElementById(frameId);\n        let removeIframeFn = null;\n        if (!frame) {\n          frame = document.createElement('iframe');\n          frame.id = frameId;\n          // Upstream skips blob URL when `kagi` is defined (Orion/Kagi) or non-WebKit.\n          const blobURL =\n            typeof webkitCancelAnimationFrame === 'function' &&\n            typeof kagi === 'undefined'\n              ? (frame.src = URL.createObjectURL(\n                  new Blob([], { type: 'text/html' })\n                ))\n              : null;\n          frame.sandbox = 'allow-same-origin';\n          let noscriptHost = document.createElement('noscript');\n          noscriptHost.appendChild(frame);\n          while (!document.documentElement && mx-- > 0) {\n            await new PromiseCtor(waitFn);\n          }\n          const root = document.documentElement;\n          if (!root) return null;\n          root.appendChild(noscriptHost);\n          if (blobURL) {\n            PromiseCtor.resolve().then(() => URL.revokeObjectURL(blobURL));\n          }\n\n          removeIframeFn = (nativeSetTimeout) => {\n            const removeIframeOnDocumentReady = (e) => {\n              e &&\n                targetWin.removeEventListener(\n                  'DOMContentLoaded',\n                  removeIframeOnDocumentReady,\n                  false\n                );\n              e = noscriptHost;\n              noscriptHost = targetWin = removeIframeFn = null;\n              nativeSetTimeout ? nativeSetTimeout(() => e.remove(), 200) : e.remove();\n            };\n            if (!nativeSetTimeout || document.readyState !== 'loading') {\n              removeIframeOnDocumentReady();\n            } else {\n              targetWin.addEventListener(\n                'DOMContentLoaded',\n                removeIframeOnDocumentReady,\n                false\n              );\n            }\n          };\n        }\n        while (!frame.contentWindow && mx-- > 0) {\n          await new PromiseCtor(waitFn);\n        }\n        const fc = frame.contentWindow;\n        if (!fc) return null;\n        try {\n          const {\n            requestAnimationFrame: raf,\n            setInterval: si,\n            setTimeout: st,\n            clearInterval: ci,\n            clearTimeout: ct,\n          } = fc;\n          const res = {\n            requestAnimationFrame: raf,\n            setInterval: si,\n            setTimeout: st,\n            clearInterval: ci,\n            clearTimeout: ct,\n          };\n          for (const k of Object.keys(res)) {\n            res[k] = res[k].bind(targetWin);\n          }\n          if (removeIframeFn) {\n            PromiseCtor.resolve(res.setTimeout).then(removeIframeFn);\n          }\n          return res;\n        } catch {\n          if (removeIframeFn) removeIframeFn();\n          return null;\n        }\n      } catch (e) {\n        console.warn('[FYP] CPU tamer cleanContext failed', e);\n        return null;\n      }\n    };\n\n    cleanContext(win).then((ctx) => {\n      if (!ctx) {\n        try {\n          delete win[CPU_TAMER_FLAG];\n        } catch {\n          win[CPU_TAMER_FLAG] = false;\n        }\n        return;\n      }\n\n      const {\n        requestAnimationFrame: pristineRAF,\n        setTimeout: pristineSetTimeout,\n        setInterval: pristineSetInterval,\n        clearTimeout: pristineClearTimeout,\n        clearInterval: pristineClearInterval,\n      } = ctx;\n\n      let afInterupter = null;\n\n      const getRAFHelper = () => {\n        const asc = document.createElement('a-f');\n        if (!('onanimationiteration' in asc)) {\n          return (resolve) => pristineRAF((afInterupter = resolve));\n        }\n        asc.id = 'a-f';\n        let qr = null;\n        asc.onanimationiteration = function () {\n          if (qr !== null) qr = (qr(), null);\n        };\n        if (!document.getElementById('fyp-afscript')) {\n          const style = document.createElement('style');\n          style.id = 'fyp-afscript';\n          style.textContent = `\n            @keyframes fypAF1 {\n              0% { order: 0; }\n              100% { order: 1; }\n            }\n            #a-f[id] {\n              visibility: collapse !important;\n              position: fixed !important;\n              display: block !important;\n              top: -100px !important;\n              left: -100px !important;\n              margin: 0 !important;\n              padding: 0 !important;\n              outline: 0 !important;\n              border: 0 !important;\n              z-index: -1 !important;\n              width: 0px !important;\n              height: 0px !important;\n              contain: strict !important;\n              pointer-events: none !important;\n              animation: 1ms steps(2, jump-none) 0ms infinite alternate forwards running fypAF1 !important;\n            }\n          `;\n          (document.head || document.documentElement).appendChild(style);\n        }\n        document.documentElement.insertBefore(\n          asc,\n          document.documentElement.firstChild\n        );\n        return (resolve) => (qr = afInterupter = resolve);\n      };\n\n      const rafPN = getRAFHelper();\n\n      (() => {\n        let afPromiseP;\n        let afPromiseQ;\n        afPromiseP = afPromiseQ = { resolved: true };\n        let afix = 0;\n        const afResolve = async (rX) => {\n          await new PromiseCtor(rafPN);\n          rX.resolved = true;\n          const t = (afix = (afix & 1073741823) + 1);\n          return rX.resolve(t), t;\n        };\n        const eFunc = async () => {\n          const uP = !afPromiseP.resolved ? afPromiseP : null;\n          const uQ = !afPromiseQ.resolved ? afPromiseQ : null;\n          let t = 0;\n          if (uP && uQ) {\n            const t1 = await uP;\n            const t2 = await uQ;\n            t = ((t1 - t2) & 536870912) === 0 ? t1 : t2;\n          } else {\n            const vP = !uP ? (afPromiseP = new PromiseExternal()) : null;\n            const vQ = !uQ ? (afPromiseQ = new PromiseExternal()) : null;\n            if (uQ) await uQ;\n            else if (uP) await uP;\n            if (vP) t = await afResolve(vP);\n            if (vQ) t = await afResolve(vQ);\n          }\n          return t;\n        };\n        const inExec = new Set();\n        const wFunc = async (handler, wStore) => {\n          try {\n            const ct = Date.now();\n            if (ct - timeupdateDT() < 800 && ct - wStore.dt < 800) {\n              const cid = wStore.cid;\n              inExec.add(cid);\n              const t = await eFunc();\n              const didNotRemove = inExec.delete(cid);\n              if (!didNotRemove || t === wStore.lastExecution) return;\n              wStore.lastExecution = t;\n            }\n            wStore.dt = ct;\n            handler();\n          } catch (e) {\n            console.error(e);\n            throw e;\n          }\n        };\n        const sFunc = (propFunc) => {\n          return (func, ms = 0, ...args) => {\n            if (typeof func === 'function') {\n              const wStore = { dt: Date.now() };\n              return (wStore.cid = propFunc(\n                wFunc,\n                ms,\n                args.length > 0 ? func.bind(null, ...args) : func,\n                wStore\n              ));\n            }\n            return propFunc(func, ms, ...args);\n          };\n        };\n        win.setTimeout = sFunc(pristineSetTimeout);\n        win.setInterval = sFunc(pristineSetInterval);\n\n        const dFunc = (propFunc) => {\n          return (cid) => {\n            if (cid) inExec.delete(cid) || propFunc(cid);\n          };\n        };\n\n        win.clearTimeout = dFunc(pristineClearTimeout);\n        win.clearInterval = dFunc(pristineClearInterval);\n\n        try {\n          win.setTimeout.toString = pristineSetTimeout.toString.bind(\n            pristineSetTimeout\n          );\n          win.setInterval.toString = pristineSetInterval.toString.bind(\n            pristineSetInterval\n          );\n          win.clearTimeout.toString = pristineClearTimeout.toString.bind(\n            pristineClearTimeout\n          );\n          win.clearInterval.toString = pristineClearInterval.toString.bind(\n            pristineClearInterval\n          );\n        } catch (e) {\n          console.warn(e);\n        }\n      })();\n\n      let mInterupter = null;\n      pristineSetInterval(() => {\n        if (mInterupter === afInterupter) {\n          if (mInterupter !== null) {\n            afInterupter = mInterupter = (mInterupter(), null);\n          }\n        } else {\n          mInterupter = afInterupter;\n        }\n      }, 125);\n\n      try {\n        document.documentElement?.setAttribute('data-fyp-cpu-tamer', '1');\n      } catch {\n        // Attribute is diagnostics-only.\n      }\n    });\n  }\n\n  if (shouldInstallYoutubeCpuTamer(window)) {\n    installYoutubeCpuTamer(window);\n  } else {\n    try {\n      document.documentElement?.setAttribute('data-fyp-cpu-tamer', '0');\n    } catch {\n      // Attribute is diagnostics-only.\n    }\n  }\n\n  let playerControlsHideTimer = null;\n  const selectedCaptionTrackByVideo = new WeakMap();\n  const captionDedupeReadyAtByVideo = new WeakMap();\n  const CAPTION_DEDUPE_DELAY_MS = 450;\n  const selectedQualityByVideo = new WeakMap();\n  let ignorePlayerControlActionsUntil = 0;\n  let pendingMenuOptionGesture = null;\n  let lastMediaSessionMetadataKey = '';\n  let mediaSessionHandlersInstalled = false;\n  let lastMediaSessionHandlerInstallAt = 0;\n  let mediaSessionStorageFailed = false;\n  let mediaSessionLocalOwner = false;\n  function channelVideosUrl(input) {\n    let target;\n    try {\n      target = new URL(input, location.href);\n    } catch {\n      return null;\n    }\n    if (\n      !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(\n        target.hostname\n      ) ||\n      !CHANNEL_ROOT_PATH_PATTERN.test(target.pathname)\n    ) {\n      return null;\n    }\n    target.protocol = 'https:';\n    target.hostname = BACKEND_HOST;\n    target.port = '';\n    target.pathname = `${target.pathname.replace(/\\/+$/, '')}/videos`;\n    target.searchParams.set('app', 'desktop');\n    target.searchParams.set('persist_app', '1');\n    return target;\n  }\n\n  function redirectChannelRootToVideos() {\n    const target = channelVideosUrl(location.href);\n    if (!target || target.href === location.href) return false;\n    location.replace(target.href);\n    return true;\n  }\n\n  function redirectChannelLinkToVideos(event) {\n    if (\n      event.defaultPrevented ||\n      event.button > 0 ||\n      event.metaKey ||\n      event.ctrlKey ||\n      event.shiftKey ||\n      event.altKey\n    ) {\n      return;\n    }\n    const link = event.target?.closest?.('a[href]');\n    const target = channelVideosUrl(link?.href || link?.getAttribute('href'));\n    if (!target) return;\n    event.preventDefault();\n    event.stopImmediatePropagation();\n    location.assign(target.href);\n  }\n  /*\n   * Normalize every normal and short YouTube link onto the desktop host.\n   * Orion can then use the full desktop player underneath the mobile-only UI\n   * provided by this script.\n   */\n  if (location.hostname === 'youtu.be') {\n    const videoId = location.pathname.split('/').filter(Boolean)[0];\n    if (videoId) {\n      const target = new URL(`https://${BACKEND_HOST}/watch`);\n      target.searchParams.set('v', videoId);\n      for (const [key, value] of new URL(location.href).searchParams) {\n        target.searchParams.set(key, value);\n      }\n      target.searchParams.set('app', 'desktop');\n      target.searchParams.set('persist_app', '1');\n      target.hash = location.hash;\n      location.replace(target.href);\n      return;\n    }\n  }\n\n  if (location.hostname !== BACKEND_HOST) {\n    const target = new URL(location.href);\n    target.protocol = 'https:';\n    target.hostname = BACKEND_HOST;\n    target.port = '';\n    target.searchParams.set('app', 'desktop');\n    target.searchParams.set('persist_app', '1');\n    location.replace(target.href);\n    return;\n  }\n\n  if (redirectChannelRootToVideos()) return;\n\n  // Never land on Shorts or Playables (mini-games) \u2014 send those URLs to Home.\n  if (\n    location.pathname.startsWith('/shorts') ||\n    location.pathname.startsWith('/playables')\n  ) {\n    location.replace(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);\n    return;\n  }\n\n  /*\n   * Built-in YouTube ad blocking so uBlock Origin is not required.\n   * YouTube network/player pruning is adapted from Universal Ad Blocker Pro\n   * by Gorstak (Goran \u0160tambuk), MIT:\n   * https://greasyfork.org/en/scripts/561518-universal-ad-blocker-pro\n   * Other-site blockers from that script are not included.\n   */\n  const AD_RESPONSE_ARRAY_KEYS = new Set(['adPlacements', 'adSlots', 'playerAds']);\n  const AD_RESPONSE_DELETE_KEYS = new Set([\n    'adBreakHeartbeatParams',\n    'ad3Module',\n    'adSafetyReason',\n  ]);\n  const AD_JSON_HINT =\n    /\"ad(?:Placements|Slots|BreakHeartbeatParams|3Module|SafetyReason)\"|\"playerAds\"/;\n  const BLOCKED_AD_HOST_SNIPPETS = [\n    'doubleclick.net',\n    'googleadservices.com',\n    'googlesyndication.com',\n    'adservice.google.com',\n    'googleads.',\n    'pagead2.',\n  ];\n  const BLOCKED_AD_PATH_SNIPPETS = [\n    '/pagead/',\n    '/api/stats/ads',\n    '/api/stats/atr',\n    '/ptracking',\n    '/get_midroll',\n    '/ad_break',\n    '/pcs/activeview',\n  ];\n  const MAX_AD_SEEK_DURATION_S = 90;\n  const AD_PLAYER_SELECTOR =\n    '.html5-video-player.ad-showing, .html5-video-player.ad-interrupting';\n  const AD_PLAYER_UI_SELECTOR = [\n    '.ytp-ad-player-overlay',\n    '.ytp-ad-text',\n    '.ytp-ad-preview-container',\n    '.ytp-ad-skip-button',\n    '.ytp-skip-ad-button',\n    '.video-ads',\n    '[class*=\"ytp-skip-ad\"]',\n  ].join(',');\n\n  function pruneAdsFromPlayerResponse(value, seen = new WeakSet()) {\n    if (!value || typeof value !== 'object' || seen.has(value)) return value;\n    seen.add(value);\n\n    if (Array.isArray(value)) {\n      value.forEach((item) => pruneAdsFromPlayerResponse(item, seen));\n      return value;\n    }\n\n    for (const key of Object.keys(value)) {\n      if (AD_RESPONSE_ARRAY_KEYS.has(key)) {\n        value[key] = [];\n        continue;\n      }\n      if (AD_RESPONSE_DELETE_KEYS.has(key)) {\n        delete value[key];\n        continue;\n      }\n      pruneAdsFromPlayerResponse(value[key], seen);\n    }\n\n    if (value.playerConfig && typeof value.playerConfig === 'object') {\n      if ('adPlacementConfig' in value.playerConfig) {\n        value.playerConfig.adPlacementConfig = {};\n      }\n      if ('adSignalsConfig' in value.playerConfig) {\n        value.playerConfig.adSignalsConfig = {};\n      }\n    }\n    return value;\n  }\n\n  function sanitizePlayerResponseText(text) {\n    if (typeof text !== 'string' || !AD_JSON_HINT.test(text)) return text;\n    try {\n      return JSON.stringify(pruneAdsFromPlayerResponse(JSON.parse(text)));\n    } catch {\n      return text;\n    }\n  }\n\n  function requestUrl(input) {\n    if (typeof input === 'string') return input;\n    if (input instanceof URL) return String(input);\n    if (input && typeof input.url === 'string') return input.url;\n    return '';\n  }\n\n  function isPlayerResponseUrl(input) {\n    const url = requestUrl(input);\n    return (\n      url.includes('/youtubei/v1/player') ||\n      url.includes('/youtubei/v1/get_watch') ||\n      /\\/playlist(?:\\?|$)/.test(url)\n    );\n  }\n\n  function isBlockedAdRequest(input) {\n    const url = requestUrl(input).toLowerCase();\n    if (!url) return false;\n    if (url.includes('googlevideo.com') && !url.includes('/ptracking')) {\n      return false;\n    }\n    return (\n      BLOCKED_AD_HOST_SNIPPETS.some((host) => url.includes(host)) ||\n      BLOCKED_AD_PATH_SNIPPETS.some((path) => url.includes(path))\n    );\n  }\n\n  function blockedAdJsonResponse() {\n    return new Response('{}', {\n      status: 200,\n      statusText: 'OK',\n      headers: { 'Content-Type': 'application/json' },\n    });\n  }\n\n  function installJsonAdPrune() {\n    const nativeJsonParse = JSON.parse.bind(JSON);\n    JSON.parse = function fypJsonParse(text, reviver) {\n      const parsed = nativeJsonParse(text, reviver);\n      if (typeof text === 'string' && AD_JSON_HINT.test(text)) {\n        try {\n          pruneAdsFromPlayerResponse(parsed);\n        } catch {\n          // Leave YouTube's object intact if pruning throws.\n        }\n      }\n      return parsed;\n    };\n  }\n\n  function bindPrunedWindowJson(propertyName) {\n    let current = pruneAdsFromPlayerResponse(window[propertyName]);\n    try {\n      Object.defineProperty(window, propertyName, {\n        configurable: true,\n        get: () => current,\n        set: (value) => {\n          current = pruneAdsFromPlayerResponse(value);\n        },\n      });\n    } catch {\n      if (window[propertyName]) pruneAdsFromPlayerResponse(window[propertyName]);\n    }\n  }\n\n  function installPlayerResponseAdFilter() {\n    const installFlag = '__vmYtPlayerResponseFilterV3';\n    if (window[installFlag]) return;\n    Object.defineProperty(window, installFlag, {\n      configurable: false,\n      value: true,\n    });\n\n    bindPrunedWindowJson('ytInitialPlayerResponse');\n    bindPrunedWindowJson('ytInitialData');\n    installJsonAdPrune();\n\n    const nativeFetch = window.fetch;\n    if (typeof nativeFetch === 'function') {\n      window.fetch = async function filteredYouTubeFetch(input, init) {\n        if (isBlockedAdRequest(input)) return blockedAdJsonResponse();\n        const response = await nativeFetch.call(this, input, init);\n        if (isBlockedAdRequest(response.url || input)) return blockedAdJsonResponse();\n        if (!isPlayerResponseUrl(response.url || input)) return response;\n        try {\n          const originalText = await response.clone().text();\n          const filteredText = sanitizePlayerResponseText(originalText);\n          if (filteredText === originalText) return response;\n\n          const filteredResponse = new Response(filteredText, {\n            status: response.status,\n            statusText: response.statusText,\n            headers: response.headers,\n          });\n          for (const property of ['url', 'redirected', 'type']) {\n            try {\n              Object.defineProperty(filteredResponse, property, {\n                configurable: true,\n                value: response[property],\n              });\n            } catch {\n              // These metadata properties are optional to the player.\n            }\n          }\n          return filteredResponse;\n        } catch {\n          return response;\n        }\n      };\n    }\n\n    if (typeof navigator.sendBeacon === 'function') {\n      const nativeBeacon = navigator.sendBeacon.bind(navigator);\n      navigator.sendBeacon = function fypSendBeacon(url, data) {\n        if (isBlockedAdRequest(url)) return true;\n        return nativeBeacon(url, data);\n      };\n    }\n\n    const NativeXHR = window.XMLHttpRequest;\n    if (typeof NativeXHR !== 'function') return;\n    const xhrUrls = new WeakMap();\n    const blockedXhr = new WeakSet();\n    const nativeOpen = NativeXHR.prototype.open;\n    NativeXHR.prototype.open = function filteredYouTubeOpen(method, url) {\n      const href = requestUrl(url);\n      xhrUrls.set(this, href);\n      if (isBlockedAdRequest(href)) {\n        blockedXhr.add(this);\n        return nativeOpen.call(this, method, 'data:,');\n      }\n      blockedXhr.delete(this);\n      return nativeOpen.apply(this, arguments);\n    };\n\n    const responseTextDescriptor = Object.getOwnPropertyDescriptor(\n      NativeXHR.prototype,\n      'responseText'\n    );\n    const responseDescriptor = Object.getOwnPropertyDescriptor(\n      NativeXHR.prototype,\n      'response'\n    );\n\n    if (responseTextDescriptor?.get && responseTextDescriptor.configurable) {\n      Object.defineProperty(NativeXHR.prototype, 'responseText', {\n        ...responseTextDescriptor,\n        get() {\n          if (blockedXhr.has(this)) return '{}';\n          const text = responseTextDescriptor.get.call(this);\n          return isPlayerResponseUrl(xhrUrls.get(this))\n            ? sanitizePlayerResponseText(text)\n            : text;\n        },\n      });\n    }\n\n    if (responseDescriptor?.get && responseDescriptor.configurable) {\n      Object.defineProperty(NativeXHR.prototype, 'response', {\n        ...responseDescriptor,\n        get() {\n          if (blockedXhr.has(this)) return {};\n          const response = responseDescriptor.get.call(this);\n          if (!isPlayerResponseUrl(xhrUrls.get(this))) return response;\n          if (typeof response === 'string') return sanitizePlayerResponseText(response);\n          return pruneAdsFromPlayerResponse(response);\n        },\n      });\n    }\n  }\n\n  installPlayerResponseAdFilter();\n\n  const nativeDocumentAddEventListener = document.addEventListener.bind(document);\n  const nativeWindowAddEventListener = window.addEventListener.bind(window);\n\n  function inheritedDescriptor(object, property) {\n    let current = object;\n    while (current) {\n      const descriptor = Object.getOwnPropertyDescriptor(current, property);\n      if (descriptor) return descriptor;\n      current = Object.getPrototypeOf(current);\n    }\n    return null;\n  }\n\n  const nativeHiddenDescriptor = inheritedDescriptor(document, 'hidden');\n  const nativeVisibilityDescriptor = inheritedDescriptor(document, 'visibilityState');\n\n  function readNativeDescriptor(descriptor, fallback) {\n    try {\n      return descriptor?.get ? descriptor.get.call(document) : fallback;\n    } catch {\n      return fallback;\n    }\n  }\n\n  function isReallyHidden() {\n    const nativeHidden = readNativeDescriptor(nativeHiddenDescriptor, null);\n    if (typeof nativeHidden === 'boolean') return nativeHidden;\n    return readNativeDescriptor(nativeVisibilityDescriptor, 'visible') === 'hidden';\n  }\n\n  /*\n   * YouTube normally receives visibility events when iOS backgrounds the tab.\n   * Reporting \"visible\" prevents its page code from treating that transition\n   * as a reason to stop playback. The native values above remain available to\n   * this script so it can still request PiP and recover playback.\n   */\n  function spoofDocumentProperty(property, value) {\n    try {\n      Object.defineProperty(document, property, {\n        configurable: true,\n        enumerable: true,\n        get: () => value,\n      });\n    } catch {\n      // Some WebKit builds make these properties non-configurable.\n    }\n  }\n\n  spoofDocumentProperty('hidden', false);\n  spoofDocumentProperty('webkitHidden', false);\n  spoofDocumentProperty('visibilityState', 'visible');\n  spoofDocumentProperty('webkitVisibilityState', 'visible');\n\n  const state = {\n    video: null,\n    wantsPlayback: false,\n    recoveryTimers: new Set(),\n    userPauseUntil: 0,\n    fullscreenIntentUntil: 0,\n  };\n  const RESUME_STORAGE_KEY = 'fyp:resume:v1';\n  const resumeRestoreByVideoId = new Map();\n\n  const nativeMediaPause = HTMLMediaElement.prototype.pause;\n  HTMLMediaElement.prototype.pause = function guardedMediaPause() {\n    const isActiveVideo =\n      this === state.video || this.classList?.contains('html5-main-video');\n    const shouldKeepPlaying =\n      isActiveVideo &&\n      state.wantsPlayback &&\n      Date.now() > state.userPauseUntil &&\n      isReallyHidden() &&\n      !this.ended;\n    if (shouldKeepPlaying) return;\n    return nativeMediaPause.apply(this, arguments);\n  };\n\n  function safePlay(video = state.video) {\n    if (!video || video.ended || video.error) return;\n    const result = video.play();\n    if (result && typeof result.catch === 'function') {\n      result.catch(() => {});\n    }\n  }\n\n  function currentWatchVideoId() {\n    if (location.pathname !== '/watch') return '';\n    try {\n      return new URL(location.href).searchParams.get('v') || '';\n    } catch {\n      return '';\n    }\n  }\n\n  function getOrCreateMediaSessionTabId() {\n    const root = document.documentElement;\n    const existing = root?.getAttribute(MEDIA_SESSION_TAB_ATTR)?.trim();\n    if (existing) return existing;\n    const randomId =\n      typeof crypto?.randomUUID === 'function'\n        ? crypto.randomUUID()\n        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;\n    root?.setAttribute(MEDIA_SESSION_TAB_ATTR, randomId);\n    return randomId;\n  }\n\n  const mediaSessionTabId = getOrCreateMediaSessionTabId();\n\n  function readMediaSessionOwner() {\n    if (mediaSessionStorageFailed) return null;\n    try {\n      const raw = localStorage.getItem(MEDIA_SESSION_OWNER_KEY);\n      if (!raw) return null;\n      const owner = JSON.parse(raw);\n      if (\n        !owner ||\n        typeof owner.tabId !== 'string' ||\n        !Number.isFinite(owner.expiresAt)\n      ) {\n        return null;\n      }\n      return owner;\n    } catch {\n      mediaSessionStorageFailed = true;\n      return null;\n    }\n  }\n\n  function ownsMediaSession() {\n    if (mediaSessionStorageFailed) return mediaSessionLocalOwner;\n    const owner = readMediaSessionOwner();\n    return Boolean(\n      owner &&\n        owner.tabId === mediaSessionTabId &&\n        owner.expiresAt > Date.now()\n    );\n  }\n\n  function claimMediaSessionOwnership(video = state.video) {\n    if (\n      location.pathname !== '/watch' ||\n      !(video instanceof HTMLVideoElement) ||\n      video.ended\n    ) {\n      return false;\n    }\n    const currentOwner = readMediaSessionOwner();\n    if (\n      currentOwner &&\n      currentOwner.tabId !== mediaSessionTabId &&\n      currentOwner.expiresAt > Date.now() &&\n      isReallyHidden()\n    ) {\n      return false;\n    }\n    const now = Date.now();\n    const claim = {\n      tabId: mediaSessionTabId,\n      videoId: currentWatchVideoId(),\n      claimedAt: now,\n      expiresAt: now + MEDIA_SESSION_LEASE_MS,\n    };\n    try {\n      localStorage.setItem(MEDIA_SESSION_OWNER_KEY, JSON.stringify(claim));\n      mediaSessionLocalOwner = true;\n      return true;\n    } catch {\n      mediaSessionStorageFailed = true;\n      mediaSessionLocalOwner = true;\n      return true;\n    }\n  }\n\n  function renewMediaSessionOwnership(video = state.video) {\n    if (!ownsMediaSession()) return false;\n    return claimMediaSessionOwnership(video);\n  }\n\n  // Return YouTube Dislike integration (adapted from Anarios/return-youtube-dislike)\n  function findWatchButtonsRoot() {\n    const menuContainer = document.getElementById('menu-container');\n    if (menuContainer?.offsetParent === null) {\n      return (\n        document.querySelector('ytd-menu-renderer.ytd-watch-metadata > div') ||\n        document.querySelector('ytd-menu-renderer.ytd-video-primary-info-renderer > div')\n      );\n    }\n    return (\n      menuContainer?.querySelector('#top-level-buttons-computed') ||\n      document.querySelector('#top-level-buttons-computed')\n    );\n  }\n\n  function findWatchLikeHost() {\n    const root = findWatchButtonsRoot();\n    if (!(root instanceof Element)) return null;\n    return (\n      root.querySelector('#segmented-like-button') ||\n      root.querySelector('like-button-view-model') ||\n      root.querySelector('#like-button') ||\n      root.children?.[0] ||\n      null\n    );\n  }\n\n  function findWatchDislikeHost() {\n    const root = findWatchButtonsRoot();\n    if (!(root instanceof Element)) return null;\n    return (\n      root.querySelector('#segmented-dislike-button') ||\n      root.querySelector('dislike-button-view-model') ||\n      root.querySelector('#dislike-button') ||\n      root.children?.[1] ||\n      null\n    );\n  }\n\n  function updateWatchDislikeButtonShape(nativeButton) {\n    if (!(nativeButton instanceof HTMLElement)) return;\n    for (const className of [\n      'yt-spec-button-shape-next--icon-button',\n      'ytSpecButtonShapeNextIconButton',\n    ]) {\n      nativeButton.classList.remove(className);\n    }\n    for (const className of [\n      'yt-spec-button-shape-next--icon-leading',\n      'ytSpecButtonShapeNextIconLeading',\n    ]) {\n      nativeButton.classList.add(className);\n    }\n    nativeButton.style.width = 'auto';\n  }\n\n  function getWatchDislikeTextContainer(dislikeHost = findWatchDislikeHost()) {\n    if (!(dislikeHost instanceof Element)) return null;\n    const nativeButton = dislikeHost.querySelector('button');\n    let textNode = dislikeHost.querySelector(`[${RYD_TEXT_ATTR}]`);\n    if (!(textNode instanceof HTMLElement)) {\n      const selectors = [\n        '.yt-spec-button-shape-next__button-text-content',\n        '.ytSpecButtonShapeNextButtonTextContent',\n        '#text',\n        'yt-formatted-string',\n        'span[role=\"text\"]',\n      ];\n      for (const selector of selectors) {\n        const candidate = dislikeHost.querySelector(selector);\n        if (\n          candidate instanceof HTMLElement &&\n          candidate !== nativeButton &&\n          !candidate.closest('yt-icon, svg')\n        ) {\n          textNode = candidate;\n          break;\n        }\n      }\n    }\n    if (!(textNode instanceof HTMLElement)) {\n      if (!(nativeButton instanceof HTMLButtonElement)) return null;\n      const likeHost = findWatchLikeHost();\n      const template =\n        likeHost?.querySelector(\n          '.yt-spec-button-shape-next__button-text-content, .ytSpecButtonShapeNextButtonTextContent'\n        ) || null;\n      if (template instanceof HTMLElement) {\n        textNode = template.cloneNode(true);\n        const inner =\n          textNode.querySelector('span[role=\"text\"]') || textNode;\n        if (inner instanceof HTMLElement) inner.textContent = '';\n        nativeButton.appendChild(textNode);\n      } else {\n        textNode = document.createElement('span');\n        textNode.id = 'text';\n        textNode.setAttribute('role', 'text');\n        textNode.style.marginLeft = '6px';\n        nativeButton.appendChild(textNode);\n      }\n    }\n    if (!(textNode instanceof HTMLElement)) return null;\n    textNode.setAttribute(RYD_TEXT_ATTR, '1');\n    updateWatchDislikeButtonShape(nativeButton);\n    return textNode;\n  }\n\n  function formatDislikeCount(count) {\n    if (!Number.isFinite(count) || count < 0) return '';\n    try {\n      return new Intl.NumberFormat(undefined, {\n        notation: 'compact',\n        compactDisplay: 'short',\n        maximumFractionDigits: 1,\n      }).format(count);\n    } catch {\n      return String(Math.round(count));\n    }\n  }\n\n  function disconnectWatchDislikeObserver() {\n    rydDislikeObserver?.disconnect();\n    rydDislikeObserver = null;\n    rydObservedHost = null;\n  }\n\n  function queueStickyWatchDislikeReapply() {\n    if (rydReapplyQueued) return;\n    rydReapplyQueued = true;\n    setTimeout(() => {\n      rydReapplyQueued = false;\n      stickyReapplyWatchDislikeCount();\n    }, 40);\n  }\n\n  function ensureWatchDislikeObserver(dislikeHost) {\n    if (!(dislikeHost instanceof Element)) return;\n    if (rydObservedHost === dislikeHost && rydDislikeObserver) return;\n    disconnectWatchDislikeObserver();\n    rydObservedHost = dislikeHost;\n    rydDislikeObserver = new MutationObserver(() => {\n      queueStickyWatchDislikeReapply();\n    });\n    rydDislikeObserver.observe(dislikeHost, {\n      childList: true,\n      subtree: true,\n      characterData: true,\n      attributes: true,\n      attributeFilter: ['class', 'style'],\n    });\n  }\n\n  function stickyReapplyWatchDislikeCount() {\n    if (location.pathname !== '/watch') {\n      disconnectWatchDislikeObserver();\n      return;\n    }\n    const videoId = currentWatchVideoId();\n    if (!videoId) return;\n    const cache = rydCache.get(videoId);\n    if (!cache || !Number.isFinite(cache.dislikes)) return;\n    applyWatchDislikeCount(cache.dislikes);\n  }\n\n  function applyWatchDislikeCount(count) {\n    const text = formatDislikeCount(count);\n    if (!text) return false;\n    const dislikeHost = findWatchDislikeHost();\n    if (!(dislikeHost instanceof Element)) return false;\n    ensureWatchDislikeObserver(dislikeHost);\n    const textContainer = getWatchDislikeTextContainer(dislikeHost);\n    if (!(textContainer instanceof HTMLElement)) return false;\n    if (textContainer.textContent !== text) {\n      textContainer.textContent = text;\n    }\n    textContainer.setAttribute(RYD_TEXT_ATTR, '1');\n    updateWatchDislikeButtonShape(dislikeHost.querySelector('button'));\n    return true;\n  }\n\n  async function refreshWatchDislikeCount({ force = false } = {}) {\n    if (location.pathname !== '/watch') {\n      disconnectWatchDislikeObserver();\n      return;\n    }\n    const videoId = currentWatchVideoId();\n    if (!videoId) return;\n    const cache = rydCache.get(videoId);\n    if (\n      !force &&\n      cache &&\n      Date.now() - cache.at < RYD_CACHE_TTL_MS &&\n      Number.isFinite(cache.dislikes)\n    ) {\n      applyWatchDislikeCount(cache.dislikes);\n      return;\n    }\n    if (rydPending.has(videoId)) return;\n    rydPending.add(videoId);\n    try {\n      const response = await fetch(\n        `${RYD_API_URL}/votes?videoId=${encodeURIComponent(videoId)}`,\n        {\n          method: 'GET',\n        }\n      );\n      if (!response.ok) return;\n      const payload = await response.json();\n      const dislikes = Number(payload?.dislikes);\n      if (!Number.isFinite(dislikes)) return;\n      rydCache.set(videoId, { dislikes, at: Date.now() });\n      applyWatchDislikeCount(dislikes);\n    } catch {\n      // Keep native UI if API/network fails.\n    } finally {\n      rydPending.delete(videoId);\n    }\n  }\n\n  function readResumeStore() {\n    try {\n      const raw = localStorage.getItem(RESUME_STORAGE_KEY);\n      const parsed = raw ? JSON.parse(raw) : {};\n      return parsed && typeof parsed === 'object' ? parsed : {};\n    } catch {\n      return {};\n    }\n  }\n\n  function writeResumeStore(store) {\n    try {\n      localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(store));\n    } catch {\n      // Storage can fail in private mode or quota pressure.\n    }\n  }\n\n  function persistWatchResume(video = state.video) {\n    if (!(video instanceof HTMLVideoElement)) return;\n    const videoId = currentWatchVideoId();\n    if (!videoId || !Number.isFinite(video.currentTime)) return;\n    const current = Math.max(0, video.currentTime);\n    if (current < 2 || video.ended) return;\n    const duration = Number.isFinite(video.duration) ? video.duration : 0;\n    if (duration > 0 && current >= duration - 1) return;\n    const store = readResumeStore();\n    store[videoId] = {\n      t: Math.round(current),\n      at: Date.now(),\n    };\n    writeResumeStore(store);\n  }\n\n  function restoreWatchResume(video = state.video) {\n    if (!(video instanceof HTMLVideoElement)) return;\n    const videoId = currentWatchVideoId();\n    if (!videoId || resumeRestoreByVideoId.get(videoId)) return;\n    const store = readResumeStore();\n    const entry = store[videoId];\n    if (!entry || !Number.isFinite(entry.t)) return;\n    const target = Math.max(0, Number(entry.t) || 0);\n    if (target < 3) return;\n    const duration = Number.isFinite(video.duration)\n      ? video.duration\n      : Number.POSITIVE_INFINITY;\n    if (target >= duration - 2) return;\n    if (Number.isFinite(video.currentTime) && video.currentTime > 2) {\n      resumeRestoreByVideoId.set(videoId, true);\n      return;\n    }\n    try {\n      video.currentTime = target;\n      resumeRestoreByVideoId.set(videoId, true);\n    } catch {\n      // Seek can fail before metadata is available; loadedmetadata will retry.\n    }\n  }\n\n  function clearRecoveryTimers() {\n    for (const timer of state.recoveryTimers) clearTimeout(timer);\n    state.recoveryTimers.clear();\n  }\n\n  function configurePlaybackAudioSession() {\n    try {\n      if (navigator.audioSession) {\n        navigator.audioSession.type = 'playback';\n      }\n    } catch {\n      // AudioSession is an optional WebKit API.\n    }\n  }\n\n  function recoverPlayback(video = state.video) {\n    if (!video || !state.wantsPlayback || video.ended) return;\n    safePlay(video);\n    clearRecoveryTimers();\n    for (const delay of [80, 250, 750, 1500]) {\n      const timer = setTimeout(() => {\n        state.recoveryTimers.delete(timer);\n        if (state.wantsPlayback && isReallyHidden()) safePlay(video);\n      }, delay);\n      state.recoveryTimers.add(timer);\n    }\n  }\n\n  function onVideoPlay() {\n    state.wantsPlayback = true;\n    state.userPauseUntil = 0;\n    claimMediaSessionOwnership(state.video);\n    installMediaSessionHandlers({ force: true });\n    configurePlaybackAudioSession();\n    enforceInlinePlayback(state.video);\n    persistWatchResume(state.video);\n    updateMediaSessionMetadata();\n    syncCustomPlayerControls();\n  }\n\n  function onVideoPause() {\n    persistWatchResume(state.video);\n    if (Date.now() <= state.userPauseUntil || !state.wantsPlayback) {\n      state.wantsPlayback = false;\n      clearRecoveryTimers();\n      syncCustomPlayerControls();\n      return;\n    }\n    if (isReallyHidden() && state.wantsPlayback && !state.video?.ended) {\n      recoverPlayback();\n    } else if (!isReallyHidden()) {\n      // A pause while the page is visible is treated as an intentional pause.\n      state.wantsPlayback = false;\n      clearRecoveryTimers();\n    }\n    syncCustomPlayerControls();\n  }\n\n  function recordPlayerControlIntent(event) {\n    const target = event.target;\n    if (!(target instanceof Element)) return;\n    if (\n      target.closest(\n        `#movie_player, .html5-video-player, .html5-video-container, #${PLAYER_CONTROLS_TOOLBAR_ID}`\n      )\n    ) {\n      holdPlayerControlsVisible();\n    }\n    const control = target.closest([\n      '.ytp-play-button',\n      'button[aria-label^=\"Pause\"]',\n      'button[aria-label^=\"Play\"]',\n      'button[data-title-no-tooltip=\"Pause\"]',\n      'button[data-title-no-tooltip=\"Play\"]',\n    ].join(','));\n    if (!control) return;\n\n    const video = state.video || findVideo();\n    if (!video) return;\n    attachVideo(video);\n    if (video.paused || video.ended) {\n      state.wantsPlayback = true;\n      state.userPauseUntil = 0;\n    } else {\n      state.wantsPlayback = false;\n      state.userPauseUntil = Date.now() + 3000;\n      clearRecoveryTimers();\n    }\n  }\n\n  function holdPlayerControlsVisible() {\n    const player = findActivePlayerElement();\n    if (!(player instanceof HTMLElement)) return;\n\n    player.dataset.fypControlsVisible = 'true';\n    if (playerControlsHideTimer) clearTimeout(playerControlsHideTimer);\n    playerControlsHideTimer = setTimeout(() => {\n      delete player.dataset.fypControlsVisible;\n      playerControlsHideTimer = null;\n    }, PLAYER_CONTROLS_VISIBLE_MS);\n  }\n\n  const PLAYER_CONTROL_ICONS = Object.freeze({\n    pause:\n      '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M0 0h24v24H0z\" fill=\"none\"/><path fill=\"currentColor\" d=\"M11 7H8v10h3zm2 10h3V7h-3z\"/></svg>',\n    play:\n      '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M0 0h16v16H0z\" fill=\"none\"/><path fill=\"currentColor\" d=\"M3 2.803a1 1 0 0 1 1.5-.865l9 5.195a1 1 0 0 1 0 1.733l-9 5.196a1 1 0 0 1-1.5-.866z\"/></svg>',\n    rewind:\n      '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" viewBox=\"0 0 512 512\" aria-hidden=\"true\"><path d=\"M0 0h512v512H0z\" fill=\"none\"/><path fill=\"currentColor\" d=\"M455.979 424.271A24.053 24.053 0 0 0 480 400.251V112.015a24 24 0 0 0-38.285-19.286L264 224.369V112.015a24 24 0 0 0-38.285-19.286L31.155 236.847a24 24 0 0 0 0 38.57l194.56 144.119A24 24 0 0 0 264 400.251V287.9l177.715 131.637a23.92 23.92 0 0 0 14.264 4.734M232 384.37L58.88 256.132L232 127.9ZM448 127.9v256.47L274.88 256.132Z\"/></svg>',\n    forward:\n      '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" viewBox=\"0 0 512 512\" aria-hidden=\"true\"><path d=\"M0 0h512v512H0z\" fill=\"none\"/><path fill=\"currentColor\" d=\"M32 111.882v288.236A23.979 23.979 0 0 0 70.285 419.4L248 287.763v112.355a23.979 23.979 0 0 0 38.285 19.282l194.56-144.119a24 24 0 0 0 0-38.57L286.285 92.6A24 24 0 0 0 248 111.882v112.355L70.285 92.6A24 24 0 0 0 32 111.882m248 15.881L453.119 256L280 384.237Zm-216 0L237.119 256L64 384.237Z\"/></svg>',\n    pip:\n      '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M0 0h24v24H0z\" fill=\"none\"/><path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm3-1h12a1 1 0 0 1 1 1v6.268A2 2 0 0 0 18 12h-4a2 2 0 0 0-2 2v4c0 .364.097.706.268 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1\" clip-rule=\"evenodd\"/></svg>',\n    fullscreen:\n      '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\"><path d=\"M8 3H5a2 2 0 0 0-2 2v3\"/><path d=\"M16 3h3a2 2 0 0 1 2 2v3\"/><path d=\"M8 21H5a2 2 0 0 1-2-2v-3\"/><path d=\"M16 21h3a2 2 0 0 0 2-2v-3\"/></svg>',\n    speed:\n      '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/></svg>',\n    airplay:\n      '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M0 0h24v24H0z\" fill=\"none\"/><g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\"><path stroke-opacity=\".4\" d=\"M4.1043 15.8632C2.8523 15.4715 2 14.3118 2 13L2 6C2 4.3431 3.3431 3 5 3L19 3C20.6569 3 22 4.3431 22 6L22 13C22 14.3118 21.1477 15.4715 19.8957 15.8632\"/><path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M13.6 13.4667L17.6 18.8C17.8596 19.1462 18 19.5673 18 20C18 21.1046 17.1046 22 16 22L8 22C6.8954 22 6 21.1046 6 20C6 19.5673 6.1404 19.1462 6.4 18.8L10.4 13.4667C10.7777 12.9631 11.3705 12.6667 12 12.6667C12.6295 12.6667 13.2223 12.9631 13.6 13.4667Z\" clip-rule=\"evenodd\" stroke=\"none\"/></g></svg>',\n    collapse:\n      '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\"><path d=\"m18 15-6-6-6 6\"/></svg>',\n  });\n\n  /*\n   * YouTube can enforce Trusted Types on Element.innerHTML. Build FYP-owned\n   * controls through DOM nodes so one rejected icon cannot abort scanPage()\n   * before the video is attached to the playback state.\n   */\n  function svgElementFromMarkup(markup) {\n    try {\n      const text = String(markup || '').trim();\n      const source = text.startsWith('<svg')\n        ? text\n        : `<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">${text}</svg>`;\n      const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');\n      const svg = parsed?.documentElement;\n      if (!svg || String(svg.localName).toLowerCase() !== 'svg') return null;\n      return document.importNode(svg, true);\n    } catch {\n      return null;\n    }\n  }\n\n  function replaceIconContents(element, markup) {\n    if (!(element instanceof Element)) return;\n    const svg = svgElementFromMarkup(markup);\n    if (svg) element.replaceChildren(svg);\n    else element.replaceChildren();\n  }\n\n  function playerControlButtonMarkup(action, label, icon, extraClass = '') {\n    const menuAttributes =\n      action === 'speed' || action === 'quality'\n        ? ' aria-haspopup=\"menu\" aria-expanded=\"false\"'\n        : '';\n    const className = extraClass\n      ? `fyp-player-control ${extraClass}`\n      : 'fyp-player-control';\n    return (\n      `<button type=\"button\" class=\"${className}\" ` +\n      `data-fyp-player-action=\"${action}\" aria-label=\"${label}\" ` +\n      `title=\"${label}\" aria-pressed=\"false\"${menuAttributes}>${icon}</button>`\n    );\n  }\n\n  function playerControlsMarkup() {\n    return [\n      playerControlButtonMarkup(\n        'rewind',\n        'Back 10 seconds',\n        PLAYER_CONTROL_ICONS.rewind\n      ),\n      playerControlButtonMarkup(\n        'play-pause',\n        'Play',\n        PLAYER_CONTROL_ICONS.play\n      ),\n      playerControlButtonMarkup(\n        'forward',\n        'Forward 10 seconds',\n        PLAYER_CONTROL_ICONS.forward\n      ),\n      playerControlButtonMarkup(\n        'pip',\n        'Picture in Picture',\n        PLAYER_CONTROL_ICONS.pip\n      ),\n      playerControlButtonMarkup(\n        'airplay',\n        'AirPlay',\n        PLAYER_CONTROL_ICONS.airplay\n      ),\n      playerControlButtonMarkup(\n        'fullscreen',\n        'Fullscreen',\n        PLAYER_CONTROL_ICONS.fullscreen\n      ),\n    ].join('');\n  }\n\n  function createPlayerControlButton(action, label, icon, extraClass = '') {\n    const button = document.createElement('button');\n    button.type = 'button';\n    button.className = extraClass\n      ? `fyp-player-control ${extraClass}`\n      : 'fyp-player-control';\n    button.dataset.fypPlayerAction = action;\n    button.setAttribute('aria-label', label);\n    button.title = label;\n    button.setAttribute('aria-pressed', 'false');\n    if (action === 'speed' || action === 'quality') {\n      button.setAttribute('aria-haspopup', 'menu');\n      button.setAttribute('aria-expanded', 'false');\n    }\n    replaceIconContents(button, icon);\n    return button;\n  }\n\n  function createPlayerControlButtons() {\n    return [\n      ['rewind', 'Back 10 seconds', PLAYER_CONTROL_ICONS.rewind],\n      ['play-pause', 'Play', PLAYER_CONTROL_ICONS.play],\n      ['forward', 'Forward 10 seconds', PLAYER_CONTROL_ICONS.forward],\n      ['pip', 'Picture in Picture', PLAYER_CONTROL_ICONS.pip],\n      ['airplay', 'AirPlay', PLAYER_CONTROL_ICONS.airplay],\n      ['fullscreen', 'Fullscreen', PLAYER_CONTROL_ICONS.fullscreen],\n    ].map(([action, label, icon]) =>\n      createPlayerControlButton(action, label, icon)\n    );\n  }\n\n  function controllableVideo(shouldAttach = true) {\n    const stateVideo =\n      state.video instanceof HTMLVideoElement && state.video.isConnected\n        ? state.video\n        : null;\n    const video = stateVideo || findVideo();\n    if (!(video instanceof HTMLVideoElement)) return null;\n    if (shouldAttach) attachVideo(video);\n    return video;\n  }\n\n  function syncCustomPlayerControls() {\n    const toolbar = document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID);\n    if (!(toolbar instanceof HTMLElement)) return;\n    const video = controllableVideo(false);\n    const playButton = toolbar.querySelector(\n      '[data-fyp-player-action=\"play-pause\"]'\n    );\n    if (playButton instanceof HTMLButtonElement) {\n      const paused = !video || video.paused || video.ended;\n      const label = paused ? 'Play' : 'Pause';\n      const playbackState = paused ? 'paused' : 'playing';\n      if (playButton.dataset.fypPlaybackState !== playbackState) {\n        playButton.dataset.fypPlaybackState = playbackState;\n        replaceIconContents(\n          playButton,\n          paused ? PLAYER_CONTROL_ICONS.play : PLAYER_CONTROL_ICONS.pause\n        );\n      }\n      playButton.setAttribute('aria-label', label);\n      playButton.title = label;\n      playButton.setAttribute('aria-pressed', String(!paused));\n    }\n\n    const pipButton = toolbar.querySelector('[data-fyp-player-action=\"pip\"]');\n    if (pipButton instanceof HTMLButtonElement) {\n      const pipActive =\n        document.pictureInPictureElement === video ||\n        video?.webkitPresentationMode === 'picture-in-picture';\n      pipButton.setAttribute('aria-pressed', String(pipActive));\n    }\n\n    const fullscreenButton = toolbar.querySelector(\n      '[data-fyp-player-action=\"fullscreen\"]'\n    );\n    if (fullscreenButton instanceof HTMLButtonElement) {\n      const fullscreenActive = Boolean(\n        document.fullscreenElement ||\n          document.webkitFullscreenElement ||\n          video?.webkitDisplayingFullscreen\n      );\n      fullscreenButton.setAttribute('aria-pressed', String(fullscreenActive));\n    }\n  }\n\n  function playerMenuHosts() {\n    return [\n      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID),\n    ].filter((node) => node instanceof HTMLElement);\n  }\n\n  function closePlayerControlMenu(host) {\n    const hosts = host instanceof HTMLElement ? [host] : playerMenuHosts();\n    for (const menuHost of hosts) {\n      menuHost.querySelector('.fyp-player-menu')?.remove();\n      menuHost\n        .querySelectorAll('[aria-haspopup=\"menu\"]')\n        .forEach((button) => button.setAttribute('aria-expanded', 'false'));\n    }\n  }\n\n  function createPlayerControlMenu(host, sourceButton, label) {\n    if (!(host instanceof HTMLElement)) return null;\n    const current = host.querySelector('.fyp-player-menu');\n    if (\n      current?.dataset.fypMenuOwner === sourceButton.dataset.fypPlayerAction\n    ) {\n      closePlayerControlMenu(host);\n      return null;\n    }\n    closePlayerControlMenu();\n    const menu = document.createElement('div');\n    menu.className = 'fyp-player-menu';\n    menu.dataset.fypMenuOwner = sourceButton.dataset.fypPlayerAction || '';\n    menu.setAttribute('role', 'menu');\n    menu.setAttribute('aria-label', label);\n    sourceButton.setAttribute('aria-expanded', 'true');\n    host.appendChild(menu);\n    return menu;\n  }\n\n  function appendPlayerMenuTitle(menu, text) {\n    const title = document.createElement('div');\n    title.className = 'fyp-player-menu-title';\n    title.textContent = text;\n    menu.appendChild(title);\n  }\n\n  function appendPlayerMenuCollapse(menu) {\n    const button = document.createElement('button');\n    button.type = 'button';\n    button.className = 'fyp-player-menu-collapse';\n    button.dataset.fypPlayerOption = 'menu-collapse';\n    button.setAttribute('aria-label', 'Collapse menu');\n    button.title = 'Collapse menu';\n    replaceIconContents(button, PLAYER_CONTROL_ICONS.collapse);\n    menu.appendChild(button);\n    return button;\n  }\n\n  function appendPlayerMenuOption(\n    menu,\n    {\n      action,\n      label,\n      checked = false,\n      disabled = false,\n      trackIndex,\n      speed,\n      quality,\n      captionLanguage,\n      captionLabel,\n    }\n  ) {\n    const option = document.createElement('button');\n    option.type = 'button';\n    option.className = 'fyp-player-menu-option';\n    option.dataset.fypPlayerOption = action;\n    if (trackIndex !== undefined) {\n      option.dataset.fypTrackIndex = String(trackIndex);\n    }\n    if (speed !== undefined) option.dataset.fypSpeed = String(speed);\n    if (quality !== undefined) option.dataset.fypQuality = String(quality);\n    if (captionLanguage !== undefined) {\n      option.dataset.fypCaptionLanguage = String(captionLanguage);\n    }\n    if (captionLabel !== undefined) {\n      option.dataset.fypCaptionLabel = String(captionLabel);\n    }\n    option.setAttribute('role', 'menuitemradio');\n    option.setAttribute('aria-checked', String(checked));\n    option.disabled = disabled;\n    option.textContent = label;\n    menu.appendChild(option);\n    return option;\n  }\n\n  function captionTracks(video) {\n    const tracks = [...video.textTracks].filter(\n      (track) => track.kind === 'captions' || track.kind === 'subtitles'\n    );\n    const seen = new Set();\n    return tracks.filter((track) => {\n      const key = `${track.label || ''}|${track.language || ''}`\n        .trim()\n        .toLowerCase();\n      if (seen.has(key)) return false;\n      seen.add(key);\n      return true;\n    });\n  }\n\n  function captionOptionText(value) {\n    if (typeof value === 'string') return value.trim();\n    if (typeof value?.simpleText === 'string') return value.simpleText.trim();\n    if (Array.isArray(value?.runs)) {\n      return value.runs.map((run) => run.text || '').join('').trim();\n    }\n    return '';\n  }\n\n  function youtubeCaptionTrackList() {\n    const player = findActivePlayerElement();\n    if (!player || typeof player.getOption !== 'function') return [];\n    try {\n      const tracks = player.getOption('captions', 'tracklist');\n      if (!Array.isArray(tracks)) return [];\n      const seen = new Set();\n      return tracks.filter((track) => {\n        const label = captionOptionText(\n          track.displayName || track.name || track.label\n        ).toLowerCase();\n        const language = String(\n          track.languageCode || track.language || track.lang || ''\n        ).toLowerCase();\n        const key = `${label}|${language}`;\n        if (seen.has(key)) return false;\n        seen.add(key);\n        return true;\n      });\n    } catch {\n      return [];\n    }\n  }\n\n  function selectYouTubeCaptionTrack(selectedTrack) {\n    const player = findActivePlayerElement();\n    if (!player || typeof player.setOption !== 'function') return false;\n    try {\n      player.loadModule?.('captions');\n    } catch {}\n    const selectedLabel = String(\n      selectedTrack?.label || selectedTrack?.captionLabel || ''\n    )\n      .trim()\n      .toLowerCase();\n    const selectedLanguage = String(\n      selectedTrack?.language ||\n        selectedTrack?.languageCode ||\n        selectedTrack?.captionLanguage ||\n        selectedTrack?.lang ||\n        ''\n    ).toLowerCase();\n    const youtubeTrackList = youtubeCaptionTrackList();\n    let youtubeTrack =\n      youtubeTrackList.find((track) => {\n        const label = captionOptionText(\n          track.displayName || track.name || track.label\n        ).toLowerCase();\n        const language = String(\n          track.languageCode || track.language || track.lang || ''\n        ).toLowerCase();\n        return (\n          (selectedLabel && label === selectedLabel) ||\n          (selectedLanguage && language === selectedLanguage)\n        );\n      }) || null;\n    if (!youtubeTrack && selectedTrack && typeof selectedTrack === 'object') {\n      if (\n        selectedTrack.languageCode ||\n        selectedTrack.language ||\n        selectedTrack.lang\n      ) {\n        youtubeTrack = selectedTrack;\n      } else if (selectedLanguage) {\n        youtubeTrack = {\n          languageCode: selectedLanguage,\n          language: selectedLanguage,\n        };\n      }\n    }\n    if (!youtubeTrack) return false;\n    try {\n      // Drive YouTube's caption module exclusively; do not click the native\n      // subtitles button or force textTrack mode here.\n      player.setOption('captions', 'track', youtubeTrack);\n      player.setOption('captions', 'reload', true);\n      return true;\n    } catch {\n      return false;\n    }\n  }\n\n  function currentYouTubeCaptionTrack() {\n    const player = findActivePlayerElement();\n    if (!player || typeof player.getOption !== 'function') return null;\n    try {\n      const track = player.getOption('captions', 'track');\n      if (!track || typeof track !== 'object') return null;\n      const language = String(\n        track.languageCode || track.language || track.lang || ''\n      ).trim();\n      const label = captionOptionText(\n        track.displayName || track.name || track.label\n      );\n      if (!language && !label) return null;\n      return track;\n    } catch {\n      return null;\n    }\n  }\n\n  function qualityOptionLabel(quality) {\n    const labels = {\n      auto: 'Auto',\n      highres: 'High res',\n      hd2160: '2160p',\n      hd1440: '1440p',\n      hd1080: '1080p',\n      hd720: '720p',\n      large: '480p',\n      medium: '360p',\n      small: '240p',\n      tiny: '144p',\n    };\n    return labels[quality] || String(quality || '').toUpperCase() || 'Auto';\n  }\n\n  function youtubeQualityOptions() {\n    const player = findActivePlayerElement();\n    if (!player) {\n      return FALLBACK_QUALITY_LEVELS.map((quality) => ({\n        quality,\n        label: qualityOptionLabel(quality),\n      }));\n    }\n    const options = [];\n    const seen = new Set();\n    try {\n      const qualityData = player.getAvailableQualityData?.() || [];\n      for (const entry of qualityData) {\n        const quality = String(entry?.quality || entry?.id || '').trim();\n        if (!quality || seen.has(quality)) continue;\n        seen.add(quality);\n        options.push({\n          quality,\n          label:\n            captionOptionText(\n              entry?.qualityLabel || entry?.displayName || entry?.label\n            ) || qualityOptionLabel(quality),\n        });\n      }\n    } catch {}\n\n    let levels = [];\n    try {\n      if (typeof player.getAvailableQualityLevels === 'function') {\n        levels = player.getAvailableQualityLevels() || [];\n      }\n    } catch {}\n    if (!levels.length) {\n      try {\n        const optionLevels = player.getOption?.('quality', 'levels');\n        levels = Array.isArray(optionLevels) ? optionLevels : [];\n      } catch {\n        levels = [];\n      }\n    }\n    for (const level of levels) {\n      const quality = String(level || '').trim();\n      if (!quality || seen.has(quality)) continue;\n      seen.add(quality);\n      options.push({ quality, label: qualityOptionLabel(quality) });\n    }\n    if (!seen.has('auto')) {\n      options.unshift({ quality: 'auto', label: 'Auto' });\n    }\n    // Orion sometimes reports only \"auto\" before levels settle; keep a usable ladder.\n    if (options.length <= 1) {\n      return FALLBACK_QUALITY_LEVELS.map((quality) => ({\n        quality,\n        label: qualityOptionLabel(quality),\n      }));\n    }\n    return options;\n  }\n\n  function youtubeQualityLevels() {\n    return youtubeQualityOptions().map((option) => option.quality);\n  }\n\n  function currentYouTubeQuality(video) {\n    if (video && selectedQualityByVideo.has(video)) {\n      return selectedQualityByVideo.get(video);\n    }\n    const player = findActivePlayerElement();\n    try {\n      return (\n        player?.getPlaybackQuality?.() ||\n        player?.getOption?.('quality', 'requested') ||\n        'auto'\n      );\n    } catch {\n      return 'auto';\n    }\n  }\n\n  function applyYouTubeQuality(quality) {\n    const player = findActivePlayerElement();\n    if (!player || !quality) return;\n    try {\n      player.setPlaybackQualityRange?.(quality, quality);\n    } catch {}\n    try {\n      player.setPlaybackQuality?.(quality);\n    } catch {}\n    try {\n      player.setOption?.('quality', 'requested', quality);\n    } catch {}\n  }\n\n  function menuHostForButton(sourceButton) {\n    return sourceButton.closest(`#${PLAYER_CONTROLS_TOOLBAR_ID}`);\n  }\n\n  function toggleSpeedMenu(video, sourceButton) {\n    const host = menuHostForButton(sourceButton);\n    if (!(host instanceof HTMLElement)) return;\n    const menu = createPlayerControlMenu(\n      host,\n      sourceButton,\n      'Playback speed'\n    );\n    if (!menu) return;\n\n    appendPlayerMenuCollapse(menu);\n    appendPlayerMenuTitle(menu, 'Playback speed');\n    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {\n      appendPlayerMenuOption(menu, {\n        action: 'playback-speed',\n        label: speed === 1 ? 'Normal' : `${speed}\u00d7`,\n        checked: Math.abs(video.playbackRate - speed) < 0.01,\n        speed,\n      });\n    }\n  }\n\n  function toggleQualityMenu(video, sourceButton) {\n    const host = menuHostForButton(sourceButton);\n    if (!(host instanceof HTMLElement)) return;\n    const menu = createPlayerControlMenu(\n      host,\n      sourceButton,\n      'Video quality'\n    );\n    if (!menu) return;\n\n    appendPlayerMenuCollapse(menu);\n    appendPlayerMenuTitle(menu, 'Video quality');\n    const qualities = youtubeQualityOptions();\n    const currentQuality = String(currentYouTubeQuality(video) || 'auto');\n    for (const { quality, label } of qualities) {\n      appendPlayerMenuOption(menu, {\n        action: 'playback-quality',\n        label,\n        checked: currentQuality === quality,\n        quality,\n      });\n    }\n  }\n\n  async function runPlayerControlOption(option) {\n    const video = controllableVideo();\n    if (!(video instanceof HTMLVideoElement)) return;\n    const preservePlayback = !video.paused;\n    const action = option.dataset.fypPlayerOption;\n\n    /*\n     * Playback-speed is the known-good Orion pattern: apply immediately, retry\n     * once at 120ms, avoid native UI clicks that steal the gesture. Captions\n     * and quality follow that same shape. Caption ownership stays with YouTube's\n     * caption module \u2014 never click .ytp-subtitles-button from this menu.\n     */\n    if (action === 'menu-collapse') {\n      // Close only; shared cleanup below still runs.\n    } else if (action === 'captions-off') {\n      const applyCaptionsOff = () => {\n        try {\n          const player = findActivePlayerElement();\n          player?.loadModule?.('captions');\n          player?.setOption?.('captions', 'track', {});\n        } catch {}\n        selectedCaptionTrackByVideo.delete(video);\n        captionDedupeReadyAtByVideo.delete(video);\n        delete video.dataset.fypNativeCaptionsHidden;\n      };\n      applyCaptionsOff();\n      setTimeout(applyCaptionsOff, 120);\n    } else if (action === 'caption-track') {\n      const language = String(option.dataset.fypCaptionLanguage || '').trim();\n      const label = String(option.dataset.fypCaptionLabel || '').trim();\n      const trackIndex = Number(option.dataset.fypTrackIndex);\n      const youtubeTracks = youtubeCaptionTrackList();\n      const textTracks = captionTracks(video);\n      const selectedMeta =\n        (Number.isFinite(trackIndex) && youtubeTracks[trackIndex]) ||\n        {\n          language,\n          languageCode: language,\n          label,\n          captionLanguage: language,\n          captionLabel: label,\n        };\n      const applyCaptionSelection = () => {\n        selectYouTubeCaptionTrack(selectedMeta);\n        const matchedTextTrack =\n          (Number.isFinite(trackIndex) && textTracks[trackIndex]) ||\n          textTracks.find((track) => {\n            const trackLanguage = String(track.language || '').toLowerCase();\n            const trackLabel = String(track.label || '')\n              .trim()\n              .toLowerCase();\n            return (\n              (language && trackLanguage === language.toLowerCase()) ||\n              (label && trackLabel === label.toLowerCase())\n            );\n          });\n        if (matchedTextTrack) {\n          selectedCaptionTrackByVideo.set(video, matchedTextTrack);\n        } else {\n          selectedCaptionTrackByVideo.set(video, selectedMeta);\n        }\n        // Deduplicate only after YouTube's custom caption layer can paint.\n        setTimeout(() => suppressDuplicateNativeCaptions(video), 250);\n      };\n      applyCaptionSelection();\n      setTimeout(applyCaptionSelection, 120);\n    } else if (action === 'playback-speed') {\n      const speed = Number(option.dataset.fypSpeed);\n      if (Number.isFinite(speed)) {\n        const applyPlaybackRate = () => {\n          video.playbackRate = speed;\n          try {\n            findActivePlayerElement()?.setPlaybackRate?.(speed);\n          } catch {}\n        };\n        applyPlaybackRate();\n        setTimeout(applyPlaybackRate, 120);\n      }\n    } else if (action === 'playback-quality') {\n      const quality = String(option.dataset.fypQuality || '').trim();\n      if (quality) {\n        const applyQuality = () => {\n          applyYouTubeQuality(quality);\n          selectedQualityByVideo.set(video, quality);\n        };\n        applyQuality();\n        setTimeout(applyQuality, 120);\n      }\n    }\n\n    if (preservePlayback) {\n      state.wantsPlayback = true;\n      state.userPauseUntil = 0;\n      for (const delay of [0, 120, 350]) {\n        setTimeout(() => {\n          if (video.paused && !video.ended) safePlay(video);\n        }, delay);\n      }\n    }\n    if (action === 'playback-quality') {\n      const selectedQuality = String(option.dataset.fypQuality || '').trim();\n      option\n        .closest('.fyp-player-menu')\n        ?.querySelectorAll('[data-fyp-player-option=\"playback-quality\"]')\n        .forEach((qualityOption) => {\n          qualityOption.setAttribute(\n            'aria-checked',\n            String(qualityOption.dataset.fypQuality === selectedQuality)\n          );\n        });\n    } else {\n      closePlayerControlMenu();\n    }\n    setTimeout(syncCustomPlayerControls, 0);\n    setTimeout(syncCustomPlayerControls, 250);\n  }\n\n  async function runPlayerControlAction(action, sourceButton) {\n    const video = controllableVideo();\n    if (!(video instanceof HTMLVideoElement)) return;\n    const preservePlayback = action !== 'play-pause' && !video.paused;\n\n    if (action === 'rewind' || action === 'forward') {\n      const offset = action === 'rewind' ? -10 : 10;\n      const duration = Number.isFinite(video.duration)\n        ? video.duration\n        : Number.POSITIVE_INFINITY;\n      video.currentTime = Math.max(\n        0,\n        Math.min(duration, video.currentTime + offset)\n      );\n    } else if (action === 'play-pause') {\n      if (video.paused || video.ended) {\n        state.wantsPlayback = true;\n        state.userPauseUntil = 0;\n        try {\n          await video.play();\n        } catch {\n          document.querySelector('.ytp-play-button')?.click();\n        }\n      } else {\n        state.wantsPlayback = false;\n        state.userPauseUntil = Date.now() + 3000;\n        clearRecoveryTimers();\n        video.pause();\n      }\n    } else if (\n      action === 'speed' &&\n      sourceButton instanceof HTMLButtonElement\n    ) {\n      toggleSpeedMenu(video, sourceButton);\n    } else if (action === 'quality' && sourceButton instanceof HTMLButtonElement) {\n      toggleQualityMenu(video, sourceButton);\n    } else if (action === 'airplay') {\n      video.setAttribute('x-webkit-airplay', 'allow');\n      if (typeof video.webkitShowPlaybackTargetPicker === 'function') {\n        video.webkitShowPlaybackTargetPicker();\n      }\n    } else if (action === 'pip') {\n      video.removeAttribute('disablepictureinpicture');\n      try {\n        video.disablePictureInPicture = false;\n      } catch {}\n      if (document.pictureInPictureElement) {\n        await document.exitPictureInPicture?.();\n      } else if (typeof video.requestPictureInPicture === 'function') {\n        await video.requestPictureInPicture();\n      } else if (typeof video.webkitSetPresentationMode === 'function') {\n        const mode =\n          video.webkitPresentationMode === 'picture-in-picture'\n            ? 'inline'\n            : 'picture-in-picture';\n        video.webkitSetPresentationMode(mode);\n      }\n    } else if (action === 'fullscreen') {\n      state.fullscreenIntentUntil = Date.now() + 2000;\n      const player =\n        video.closest('#movie_player, .html5-video-player, ytd-player') ||\n        video;\n      if (document.fullscreenElement || document.webkitFullscreenElement) {\n        const exit =\n          document.exitFullscreen || document.webkitExitFullscreen;\n        await exit?.call(document);\n      } else {\n        const request =\n          player.requestFullscreen ||\n          player.webkitRequestFullscreen ||\n          player.webkitRequestFullScreen;\n        if (typeof request === 'function') {\n          await request.call(player);\n        } else {\n          const enter =\n            video.webkitEnterFullscreen || video.webkitEnterFullScreen;\n          enter?.call(video);\n        }\n      }\n    }\n\n    if (preservePlayback) {\n      state.wantsPlayback = true;\n      state.userPauseUntil = 0;\n      for (const delay of [0, 120, 350]) {\n        setTimeout(() => {\n          if (video.paused && !video.ended) safePlay(video);\n        }, delay);\n      }\n    }\n    setTimeout(syncCustomPlayerControls, 0);\n    setTimeout(syncCustomPlayerControls, 250);\n  }\n\n  function acceptSinglePlayerControlAction(button) {\n    if (!(button instanceof HTMLElement)) return false;\n    const now = Date.now();\n    const previous = Number(button.dataset.fypLastActionAt || 0);\n    if (now - previous < 450) return false;\n    button.dataset.fypLastActionAt = String(now);\n    return true;\n  }\n\n  function eventClientPoint(event) {\n    if (event.changedTouches?.[0]) {\n      return {\n        x: event.changedTouches[0].clientX,\n        y: event.changedTouches[0].clientY,\n      };\n    }\n    if (event.touches?.[0]) {\n      return {\n        x: event.touches[0].clientX,\n        y: event.touches[0].clientY,\n      };\n    }\n    return {\n      x: Number(event.clientX) || 0,\n      y: Number(event.clientY) || 0,\n    };\n  }\n\n  function isFypOwnedTarget(target) {\n    return target instanceof Element && Boolean(target.closest(FYP_OWNED_SELECTOR));\n  }\n\n  function handlePlayerControlActionCapture(event) {\n    const target = event.target;\n    if (!(target instanceof Element)) return;\n    /*\n     * Never steal YouTube chrome (settings gear, CC, progress, etc.).\n     * Capture handlers only own FYP strip / search nodes.\n     */\n    if (!isFypOwnedTarget(target)) return;\n\n    if (Date.now() < ignorePlayerControlActionsUntil) {\n      if (event.cancelable) event.preventDefault();\n      event.stopImmediatePropagation();\n      return;\n    }\n\n    const optionButton = target.closest('[data-fyp-player-option]');\n    if (optionButton instanceof HTMLButtonElement) {\n      /*\n       * Dropdown options must remain scrollable on Orion/iOS. Do not\n       * preventDefault on pointerdown/touchstart \u2014 that kills overflow-y\n       * scrolling. Activate only on a short, low-slop pointerup/touchend.\n       */\n      if (event.type === 'pointerdown' || event.type === 'touchstart') {\n        const point = eventClientPoint(event);\n        pendingMenuOptionGesture = {\n          button: optionButton,\n          x: point.x,\n          y: point.y,\n        };\n        event.stopPropagation();\n        return;\n      }\n      if (\n        event.type === 'pointercancel' ||\n        event.type === 'touchcancel'\n      ) {\n        pendingMenuOptionGesture = null;\n        return;\n      }\n      if (event.type === 'pointerup' || event.type === 'touchend') {\n        const gesture = pendingMenuOptionGesture;\n        pendingMenuOptionGesture = null;\n        if (!gesture || gesture.button !== optionButton) return;\n        const point = eventClientPoint(event);\n        const moved =\n          Math.abs(point.x - gesture.x) > MENU_OPTION_TAP_SLOP_PX ||\n          Math.abs(point.y - gesture.y) > MENU_OPTION_TAP_SLOP_PX;\n        if (moved) return;\n        if (event.cancelable) event.preventDefault();\n        event.stopImmediatePropagation();\n        if (!acceptSinglePlayerControlAction(optionButton)) return;\n        ignorePlayerControlActionsUntil = Date.now() + 500;\n        void runPlayerControlOption(optionButton);\n        return;\n      }\n      if (event.type === 'click') {\n        if (event.cancelable) event.preventDefault();\n        event.stopImmediatePropagation();\n      }\n      return;\n    }\n\n    const button = target.closest('[data-fyp-player-action]');\n    if (!(button instanceof HTMLButtonElement)) return;\n    if (event.cancelable) event.preventDefault();\n    event.stopImmediatePropagation();\n    if (!acceptSinglePlayerControlAction(button)) return;\n    void runPlayerControlAction(button.dataset.fypPlayerAction, button);\n  }\n\n  function closePlayerControlMenuFromOutside(event) {\n    const target = event.target;\n    if (!(target instanceof Element)) return;\n    if (target.closest(`#${PLAYER_CONTROLS_TOOLBAR_ID}`)) return;\n    // Do not preventDefault \u2014 native ytp menus / settings must keep working.\n    closePlayerControlMenu();\n  }\n\n  function enforceHorizontalViewportLock() {\n    const event = arguments[0];\n    if (guideDrawerIsBusy()) {\n      event?.stopImmediatePropagation?.();\n      return;\n    }\n    const scrollingElement = document.scrollingElement;\n    if (scrollingElement?.scrollLeft) scrollingElement.scrollLeft = 0;\n    if (document.documentElement.scrollLeft) {\n      document.documentElement.scrollLeft = 0;\n    }\n    if (document.body?.scrollLeft) document.body.scrollLeft = 0;\n    const app = document.querySelector('ytd-app, ytm-app');\n    if (app?.scrollLeft) app.scrollLeft = 0;\n    const pageManager = document.querySelector('ytd-page-manager, #page-manager');\n    if (pageManager?.scrollLeft) pageManager.scrollLeft = 0;\n    if (window.scrollX) window.scrollTo(0, window.scrollY);\n  }\n\n  function enforceInlinePlayback(video) {\n    if (!video) return;\n    video.setAttribute('data-fyp-inline-playback', 'true');\n    if (!video.hasAttribute('playsinline')) video.setAttribute('playsinline', '');\n    if (!video.hasAttribute('webkit-playsinline')) {\n      video.setAttribute('webkit-playsinline', '');\n    }\n    try {\n      video.playsInline = true;\n    } catch {}\n    if (video.getAttribute('x-webkit-airplay') !== 'allow') {\n      video.setAttribute('x-webkit-airplay', 'allow');\n    }\n    try {\n      video.webkitPlaysInline = true;\n    } catch {}\n    try {\n      video.removeAttribute('disablepictureinpicture');\n      video.disablePictureInPicture = false;\n    } catch {}\n  }\n\n  function onVideoLoaded() {\n    enforceInlinePlayback(state.video);\n    restoreWatchResume(state.video);\n    void refreshWatchDislikeCount({ force: true });\n    updateMediaSessionMetadata();\n  }\n\n  function hasExplicitFullscreenIntent() {\n    return Date.now() <= state.fullscreenIntentUntil;\n  }\n\n  function isVideoFullscreenTarget(target) {\n    if (target instanceof HTMLVideoElement) return true;\n    if (!(target instanceof Element)) return false;\n    return Boolean(\n      target.matches?.(\n        '#movie_player, .html5-video-player, .html5-video-container, ytd-player'\n      ) || target.querySelector?.('video')\n    );\n  }\n\n  function recordFullscreenIntent(event) {\n    const target = event.target;\n    if (!(target instanceof Element)) return;\n    const control = target.closest([\n      '.ytp-fullscreen-button',\n      'button[aria-label=\"Full screen\"]',\n      'button[aria-label=\"Fullscreen\"]',\n      'button[title=\"Full screen\"]',\n      'button[title=\"Fullscreen\"]',\n      '[data-tooltip-target-id=\"ytp-fullscreen-button\"]',\n      '[data-fyp-player-action=\"fullscreen\"]',\n    ].join(','));\n    if (!control) return;\n    state.fullscreenIntentUntil = Date.now() + 2000;\n  }\n\n  /*\n   * WebKit can choose native fullscreen before a late play() patch takes\n   * effect. Mark video elements at creation time, then repeat immediately\n   * before native play(). Fullscreen entry remains available only for the two\n   * seconds following a real tap on YouTube's fullscreen control.\n   */\n  function installInlinePlaybackGuard() {\n    const flag = '__ytMobileOrionInlinePlaybackGuardV2';\n    if (window[flag]) return;\n    Object.defineProperty(window, flag, { value: true });\n\n    const replacePrototypeMethod = (prototype, method, createReplacement) => {\n      const nativeMethod = prototype?.[method];\n      if (typeof nativeMethod !== 'function') return;\n      const replacement = createReplacement(nativeMethod);\n      try {\n        const descriptor = Object.getOwnPropertyDescriptor(prototype, method);\n        Object.defineProperty(prototype, method, {\n          configurable: descriptor?.configurable ?? true,\n          enumerable: descriptor?.enumerable ?? false,\n          writable: descriptor?.writable ?? true,\n          value: replacement,\n        });\n      } catch {\n        try {\n          prototype[method] = replacement;\n        } catch {}\n      }\n    };\n\n    const patchVideoCreation = (prototype, method) => {\n      replacePrototypeMethod(\n        prototype,\n        method,\n        (nativeMethod) =>\n          function inlineVideoCreation(name) {\n            const element = nativeMethod.apply(this, arguments);\n            if (\n              element instanceof HTMLVideoElement ||\n              String(name).toLowerCase() === 'video'\n            ) {\n              enforceInlinePlayback(element);\n            }\n            return element;\n          }\n      );\n    };\n\n    patchVideoCreation(Document.prototype, 'createElement');\n    patchVideoCreation(Document.prototype, 'createElementNS');\n\n    replacePrototypeMethod(\n      Element.prototype,\n      'setAttribute',\n      (nativeSetAttribute) =>\n        function inlineBeforeVideoSource(name) {\n          if (\n            this instanceof HTMLVideoElement &&\n            String(name).toLowerCase() === 'src'\n          ) {\n            enforceInlinePlayback(this);\n          }\n          return nativeSetAttribute.apply(this, arguments);\n        }\n    );\n\n    try {\n      const srcDescriptor = Object.getOwnPropertyDescriptor(\n        HTMLMediaElement.prototype,\n        'src'\n      );\n      if (srcDescriptor?.set && srcDescriptor.configurable) {\n        Object.defineProperty(HTMLMediaElement.prototype, 'src', {\n          ...srcDescriptor,\n          set(value) {\n            if (this instanceof HTMLVideoElement) enforceInlinePlayback(this);\n            return srcDescriptor.set.call(this, value);\n          },\n        });\n      }\n    } catch {}\n\n    replacePrototypeMethod(\n      HTMLMediaElement.prototype,\n      'play',\n      (nativePlay) =>\n        function inlinePlay() {\n          if (this instanceof HTMLVideoElement) {\n            enforceInlinePlayback(this);\n            if (\n              this.classList?.contains('html5-main-video') ||\n              this === state.video\n            ) {\n              attachVideo(this);\n            }\n          }\n          return nativePlay.apply(this, arguments);\n        }\n    );\n\n    const guardFullscreenMethod = (prototype, method, promiseResult = false) => {\n      replacePrototypeMethod(\n        prototype,\n        method,\n        (nativeMethod) =>\n          function explicitFullscreenOnly() {\n            if (\n              isVideoFullscreenTarget(this) &&\n              !hasExplicitFullscreenIntent()\n            ) {\n              return promiseResult ? Promise.resolve(undefined) : undefined;\n            }\n            return nativeMethod.apply(this, arguments);\n          }\n      );\n    };\n\n    guardFullscreenMethod(HTMLVideoElement.prototype, 'webkitEnterFullscreen');\n    guardFullscreenMethod(HTMLVideoElement.prototype, 'webkitEnterFullScreen');\n    guardFullscreenMethod(Element.prototype, 'requestFullscreen', true);\n    guardFullscreenMethod(Element.prototype, 'webkitRequestFullscreen');\n    guardFullscreenMethod(Element.prototype, 'webkitRequestFullScreen');\n\n    replacePrototypeMethod(\n      HTMLVideoElement.prototype,\n      'webkitSetPresentationMode',\n      (nativePresentationMode) =>\n        function explicitPresentationModeOnly(mode) {\n          if (mode === 'fullscreen' && !hasExplicitFullscreenIntent()) {\n            return undefined;\n          }\n          return nativePresentationMode.apply(this, arguments);\n        }\n    );\n\n    nativeDocumentAddEventListener(\n      'PointerEvent' in window ? 'pointerdown' : 'touchstart',\n      recordFullscreenIntent,\n      { capture: true, passive: true }\n    );\n    nativeDocumentAddEventListener('click', recordFullscreenIntent, true);\n\n    const enforceVideoTree = (root) => {\n      if (root instanceof HTMLVideoElement) enforceInlinePlayback(root);\n      root.querySelectorAll?.('video').forEach(enforceInlinePlayback);\n    };\n    enforceVideoTree(document);\n    const videoObserver = new MutationObserver((mutations) => {\n      for (const mutation of mutations) {\n        mutation.addedNodes.forEach((node) => {\n          if (node instanceof Element) enforceVideoTree(node);\n        });\n      }\n    });\n    videoObserver.observe(document.documentElement || document, {\n      childList: true,\n      subtree: true,\n    });\n    nativeDocumentAddEventListener('play', (event) => {\n      if (event.target instanceof HTMLVideoElement) {\n        attachVideo(event.target);\n        enforceInlinePlayback(event.target);\n      }\n    }, true);\n  }\n\n  installInlinePlaybackGuard();\n\n  function attachVideo(video) {\n    if (!video || video === state.video) {\n      if (video) {\n        enforceInlinePlayback(video);\n        suppressDuplicateNativeCaptions(video);\n      }\n      return;\n    }\n    if (state.video) {\n      state.video.removeEventListener('play', onVideoPlay);\n      state.video.removeEventListener('playing', onVideoPlay);\n      state.video.removeEventListener('pause', onVideoPause);\n      state.video.removeEventListener('ended', onVideoPause);\n      state.video.removeEventListener('loadedmetadata', onVideoLoaded);\n      state.video.removeEventListener('timeupdate', onVideoTimeUpdate);\n      for (const eventName of WEBKIT_VIDEO_LIFECYCLE_EVENTS) {\n        state.video.removeEventListener(eventName, onVideoInlineLifecycle, true);\n      }\n    }\n\n    state.video = video;\n    video.setAttribute('data-fyp-video-attached', 'true');\n    state.wantsPlayback = !video.paused && !video.ended;\n    enforceInlinePlayback(video);\n    suppressDuplicateNativeCaptions(video);\n    video.addEventListener('play', onVideoPlay, true);\n    video.addEventListener('playing', onVideoPlay, true);\n    video.addEventListener('pause', onVideoPause, true);\n    video.addEventListener('ended', onVideoPause, true);\n    video.addEventListener('loadedmetadata', onVideoLoaded, true);\n    video.addEventListener('timeupdate', onVideoTimeUpdate, true);\n    for (const eventName of WEBKIT_VIDEO_LIFECYCLE_EVENTS) {\n      video.addEventListener(eventName, onVideoInlineLifecycle, true);\n    }\n    if (!video.paused && !video.ended) claimMediaSessionOwnership(video);\n    installMediaSessionHandlers();\n  }\n\n  const WEBKIT_VIDEO_LIFECYCLE_EVENTS = Object.freeze([\n    'loadstart',\n    'loadeddata',\n    'canplay',\n    'canplaythrough',\n    'emptied',\n    'webkitbeginfullscreen',\n    'webkitendfullscreen',\n    'webkitpresentationmodechanged',\n    'webkitcurrentplaybacktargetiswirelesschanged',\n  ]);\n\n  function onVideoInlineLifecycle(event) {\n    const video = event.currentTarget;\n    if (!(video instanceof HTMLVideoElement)) return;\n    enforceInlinePlayback(video);\n    syncCustomPlayerControls();\n  }\n\n  function onVideoTimeUpdate() {\n    if (!state.video || state.video.paused || state.video.ended) return;\n    persistWatchResume(state.video);\n  }\n\n  function findVideo() {\n    const videos = [...document.querySelectorAll('video')];\n    const activeWatch = findVisibleWatchRoot();\n    const routedVideos = activeWatch\n      ? [...activeWatch.querySelectorAll('video')]\n      : videos.filter((video) => !video.closest('ytd-watch-flexy'));\n    const watchVideos = routedVideos.filter((video) => {\n      if (!(video instanceof HTMLVideoElement)) return false;\n      if (video.hasAttribute('data-no-fullscreen')) return false;\n      if (video.closest('#inline-preview-player, #inline-player')) return false;\n      return Boolean(\n        video.closest('#movie_player, #player-container, ytd-player#ytd-player')\n      );\n    });\n    const candidates = watchVideos.length ? watchVideos : routedVideos;\n    return (\n      candidates.find((video) => video.classList.contains('html5-main-video')) ||\n      candidates.find((video) => !video.ended && video.readyState > 0) ||\n      candidates[0] ||\n      videos.find((video) => video.classList.contains('html5-main-video')) ||\n      videos.find((video) => !video.ended && video.readyState > 0) ||\n      videos[0] ||\n      null\n    );\n  }\n\n  function captionTrackLabel(track) {\n    return `${track.label || ''} ${track.language || ''}`.trim();\n  }\n\n  function isEnglishCaptionTrack(track) {\n    return (\n      /^en(?:[-_]|$)/i.test(track.language || '') ||\n      /\\benglish\\b/i.test(track.label || '')\n    );\n  }\n\n  function isAutoGeneratedCaptionTrack(track) {\n    return /\\b(?:auto(?:matic)?(?:-generated)?|generated|asr)\\b/i.test(\n      captionTrackLabel(track)\n    );\n  }\n\n  function captionTrackScore(track, index) {\n    const english = isEnglishCaptionTrack(track);\n    const automatic = isAutoGeneratedCaptionTrack(track);\n    let score = 0;\n    if (english && !automatic) score += 400;\n    else if (english && automatic) score += 300;\n    else if (!automatic) score += 200;\n    else score += 100;\n    if (track.mode === 'showing') score += 20;\n    else if (track.mode === 'hidden') score += 10;\n    return score - index / 1000;\n  }\n\n  function chooseBestCaptionTrack(tracks) {\n    return tracks\n      .map((track, index) => ({\n        track,\n        score: captionTrackScore(track, index),\n      }))\n      .sort((left, right) => right.score - left.score)[0]?.track;\n  }\n\n  function matchCaptionTrackByMeta(tracks, meta) {\n    if (!meta || !tracks.length) return null;\n    const language = String(\n      meta.languageCode || meta.language || meta.lang || meta.captionLanguage || ''\n    )\n      .trim()\n      .toLowerCase();\n    const label = captionOptionText(\n      meta.displayName || meta.name || meta.label || meta.captionLabel\n    ).toLowerCase();\n    return (\n      tracks.find((track) => {\n        const trackLanguage = String(track.language || '').toLowerCase();\n        const trackLabel = String(track.label || '')\n          .trim()\n          .toLowerCase();\n        return (\n          (label && trackLabel === label) ||\n          (language && trackLanguage === language)\n        );\n      }) || null\n    );\n  }\n\n  function suppressDuplicateNativeCaptions(video = state.video || findVideo()) {\n    if (!(video instanceof HTMLVideoElement)) return;\n    const player = video.closest('#movie_player, .html5-video-player');\n    if (!player) return;\n\n    const tracks = [];\n    for (let index = 0; index < video.textTracks.length; index += 1) {\n      const track = video.textTracks[index];\n      if (track.kind === 'captions' || track.kind === 'subtitles') {\n        tracks.push(track);\n      }\n    }\n    if (!tracks.length) return;\n\n    const customCaptionsVisible = Boolean(\n      player.querySelector('.ytp-caption-window-container .ytp-caption-segment')\n    );\n    const captionsButtonState = player\n      .querySelector('.ytp-subtitles-button')\n      ?.getAttribute('aria-pressed');\n    const captionsButtonPressed = captionsButtonState === 'true';\n    const activeTracks = tracks.filter((track) => track.mode !== 'disabled');\n    const previousTrack = selectedCaptionTrackByVideo.get(video);\n    const captionsIntendedOn =\n      customCaptionsVisible ||\n      captionsButtonPressed ||\n      activeTracks.length > 0;\n\n    /*\n     * Caption contract: YouTube's custom caption DOM is the sole visible owner\n     * once it paints. Hide native WebKit ::cue only while .ytp-caption-segment\n     * exists \u2014 never on button/active-track alone. 2.2.11 early-hide left Orion\n     * with blank captions when the custom module was starved (CPU tamer) or\n     * never painted. Collapse only duplicate sibling TextTracks after a short\n     * delay \u2014 never disable the preferred track. Do not click\n     * .ytp-subtitles-button.\n     */\n    if (customCaptionsVisible) {\n      video.dataset.fypNativeCaptionsHidden = 'true';\n    } else {\n      delete video.dataset.fypNativeCaptionsHidden;\n    }\n\n    if (!captionsIntendedOn) {\n      selectedCaptionTrackByVideo.delete(video);\n      captionDedupeReadyAtByVideo.delete(video);\n      return;\n    }\n\n    if (!captionDedupeReadyAtByVideo.has(video)) {\n      captionDedupeReadyAtByVideo.set(\n        video,\n        Date.now() + CAPTION_DEDUPE_DELAY_MS\n      );\n    }\n    const dedupeReady =\n      customCaptionsVisible ||\n      Date.now() >= captionDedupeReadyAtByVideo.get(video);\n\n    /*\n     * Stay hands-off until activation is stable, then disable siblings only.\n     * Never force the preferred track to hidden/disabled.\n     */\n    if (!dedupeReady) return;\n    if (!activeTracks.length && !customCaptionsVisible) return;\n\n    const newlyActiveTracks = activeTracks.filter(\n      (track) => track !== previousTrack\n    );\n    const youtubeTrack = currentYouTubeCaptionTrack();\n    let selectedTrack;\n    if (previousTrack && newlyActiveTracks.length) {\n      // A native Languages-menu tap selected another track. Respect it while\n      // still disabling every other simultaneously selected subtitle.\n      selectedTrack = chooseBestCaptionTrack(newlyActiveTracks);\n    } else if (\n      previousTrack &&\n      tracks.includes(previousTrack) &&\n      previousTrack.mode !== 'disabled'\n    ) {\n      selectedTrack = previousTrack;\n    } else {\n      selectedTrack =\n        matchCaptionTrackByMeta(\n          activeTracks.length ? activeTracks : tracks,\n          youtubeTrack\n        ) ||\n        chooseBestCaptionTrack(activeTracks.length ? activeTracks : tracks);\n    }\n    if (!selectedTrack) return;\n\n    // Recover a preferred track that earlier builds left disabled.\n    if (selectedTrack.mode === 'disabled') {\n      try {\n        selectedTrack.mode = 'hidden';\n      } catch {\n        // CSS ::cue hiding still covers locked WebKit tracks.\n      }\n    }\n\n    // Disable only siblings. Leave preferred showing/hidden alone so YouTube's\n    // caption module keeps painting. Skip writes when already correct.\n    for (const track of tracks) {\n      if (track === selectedTrack) continue;\n      if (track.mode === 'disabled') continue;\n      try {\n        track.mode = 'disabled';\n      } catch {\n        // CSS ::cue hiding still covers locked WebKit tracks.\n      }\n    }\n    selectedCaptionTrackByVideo.set(video, selectedTrack);\n  }\n\n  function metadataContent(selector) {\n    return document.querySelector(selector)?.getAttribute('content')?.trim() || '';\n  }\n\n  function visibleVideoTitle() {\n    return (\n      document\n        .querySelector(\n          'ytd-watch-metadata h1 yt-formatted-string, ' +\n            'ytd-watch-metadata #title yt-formatted-string, ' +\n            'ytd-video-primary-info-renderer h1 yt-formatted-string'\n        )\n        ?.textContent?.replace(/\\s+/g, ' ')?.trim() || ''\n    );\n  }\n\n  function mediaSessionArtwork(videoId, response) {\n    const candidates = [];\n    if (videoId) {\n      candidates.push(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);\n    }\n    candidates.push(metadataContent('meta[property=\"og:image\"]'));\n    for (const thumbnail of [\n      ...(response?.videoDetails?.thumbnail?.thumbnails || []),\n    ].reverse()) {\n      candidates.push(thumbnail.url);\n    }\n\n    for (const src of candidates) {\n      if (!src) continue;\n      try {\n        const absolute = new URL(src, location.href).href;\n        return [{ src: absolute }];\n      } catch {}\n    }\n    return [];\n  }\n\n  function applyMediaArtworkPoster(video, artwork) {\n    if (!(video instanceof HTMLVideoElement) || !artwork.length) return;\n    const preferred =\n      artwork.find((item) => item.src.includes('/hqdefault.jpg')) ||\n      artwork[artwork.length - 1];\n    if (preferred?.src && video.poster !== preferred.src) {\n      video.poster = preferred.src;\n    }\n  }\n\n  function deactivateMediaSessionForThisTab() {\n    if (!('mediaSession' in navigator) || !mediaSessionHandlersInstalled) {\n      return;\n    }\n    for (const action of [\n      'play',\n      'pause',\n      'seekbackward',\n      'seekforward',\n      'seekto',\n    ]) {\n      try {\n        navigator.mediaSession.setActionHandler(action, null);\n      } catch {}\n    }\n    try {\n      navigator.mediaSession.playbackState = 'none';\n      navigator.mediaSession.metadata = null;\n    } catch {}\n    mediaSessionHandlersInstalled = false;\n    lastMediaSessionHandlerInstallAt = 0;\n    lastMediaSessionMetadataKey = '';\n  }\n\n  function updateMediaSessionMetadata() {\n    if (\n      !('mediaSession' in navigator) ||\n      typeof MediaMetadata !== 'function' ||\n      location.pathname !== '/watch'\n    ) {\n      return;\n    }\n    if (!ownsMediaSession()) return;\n    const response = window.ytInitialPlayerResponse;\n    const details = response?.videoDetails || {};\n    const videoId =\n      details.videoId || new URL(location.href).searchParams.get('v') || '';\n    const title =\n      details.title ||\n      visibleVideoTitle() ||\n      metadataContent('meta[property=\"og:title\"]') ||\n      metadataContent('meta[name=\"title\"]') ||\n      document.title.replace(/\\s*-\\s*YouTube\\s*$/i, '').trim();\n    const artist =\n      details.author ||\n      document\n        .querySelector(\n          'ytd-video-owner-renderer #channel-name a, ' +\n            'ytd-watch-metadata #owner #channel-name a'\n        )\n        ?.textContent?.trim() ||\n      'YouTube';\n    const artwork = mediaSessionArtwork(videoId, response);\n    if (!title || !artwork.length) return;\n    const video = state.video || findVideo();\n    applyMediaArtworkPoster(video, artwork);\n    try {\n      navigator.mediaSession.playbackState =\n        video && !video.paused && !video.ended ? 'playing' : 'paused';\n    } catch {}\n    const metadataKey = JSON.stringify([\n      videoId,\n      title,\n      artist,\n      artwork.map((item) => item.src),\n    ]);\n    const currentMetadata = navigator.mediaSession.metadata;\n    const currentArtwork = Array.from(currentMetadata?.artwork || []);\n    const artworkStillApplied = currentArtwork.some((item) =>\n      artwork.some((candidate) => candidate.src === item.src)\n    );\n    const textStillApplied =\n      currentMetadata?.title?.trim() === title &&\n      currentMetadata?.artist?.trim() === artist;\n    if (\n      metadataKey === lastMediaSessionMetadataKey &&\n      artworkStillApplied &&\n      textStillApplied\n    ) {\n      return;\n    }\n\n    try {\n      navigator.mediaSession.metadata = new MediaMetadata({\n        title,\n        artist,\n        album: 'YouTube',\n        artwork,\n      });\n      lastMediaSessionMetadataKey = metadataKey;\n    } catch {\n      // Media artwork is optional in older Orion/WebKit releases.\n    }\n  }\n\n  function mediaSessionVideo() {\n    if (!ownsMediaSession()) return null;\n    const video = controllableVideo(true);\n    return video instanceof HTMLVideoElement ? video : null;\n  }\n\n  function syncMediaSessionPlayback(video = mediaSessionVideo()) {\n    if (ownsMediaSession()) {\n      try {\n        navigator.mediaSession.playbackState =\n          video && !video.paused && !video.ended ? 'playing' : 'paused';\n      } catch {\n        // playbackState is optional in older Orion/WebKit builds.\n      }\n    }\n    syncCustomPlayerControls();\n  }\n\n  function handleMediaSessionPlay() {\n    const video = mediaSessionVideo();\n    if (!video) return;\n    renewMediaSessionOwnership(video);\n    state.wantsPlayback = true;\n    state.userPauseUntil = 0;\n    configurePlaybackAudioSession();\n    try {\n      findActivePlayerElement()?.playVideo?.();\n    } catch {\n      // Player API is optional; the media element path below remains authoritative.\n    }\n    safePlay(video);\n    syncMediaSessionPlayback(video);\n    setTimeout(() => syncMediaSessionPlayback(video), 0);\n    setTimeout(() => syncMediaSessionPlayback(video), 250);\n  }\n\n  function handleMediaSessionPause() {\n    const video = mediaSessionVideo();\n    if (!video) return;\n    renewMediaSessionOwnership(video);\n    state.wantsPlayback = false;\n    state.userPauseUntil = Date.now() + 5000;\n    clearRecoveryTimers();\n    try {\n      findActivePlayerElement()?.pauseVideo?.();\n    } catch {\n      // Player API is optional; the native pause below remains authoritative.\n    }\n    // Bypass the background pause guard so Lock Screen / Dynamic Island\n    // pause always wins over background-audio recovery.\n    nativeMediaPause.call(video);\n    syncMediaSessionPlayback(video);\n    setTimeout(() => syncMediaSessionPlayback(video), 0);\n    setTimeout(() => syncMediaSessionPlayback(video), 250);\n  }\n\n  function handleMediaSessionSeek(offsetSeconds) {\n    const video = mediaSessionVideo();\n    if (!video || !Number.isFinite(offsetSeconds)) return;\n    const duration = Number.isFinite(video.duration)\n      ? video.duration\n      : Number.POSITIVE_INFINITY;\n    video.currentTime = Math.max(\n      0,\n      Math.min(duration, video.currentTime + offsetSeconds)\n    );\n    syncMediaSessionPlayback(video);\n  }\n\n  function installMediaSessionHandlers({ force = false } = {}) {\n    if (!('mediaSession' in navigator)) return;\n    if (!ownsMediaSession()) {\n      deactivateMediaSessionForThisTab();\n      return;\n    }\n    const now = Date.now();\n    if (\n      !force &&\n      mediaSessionHandlersInstalled &&\n      now - lastMediaSessionHandlerInstallAt < MEDIA_SESSION_REFRESH_MS\n    ) {\n      return;\n    }\n    updateMediaSessionMetadata();\n    try {\n      navigator.mediaSession.setActionHandler('play', handleMediaSessionPlay);\n      navigator.mediaSession.setActionHandler('pause', handleMediaSessionPause);\n      navigator.mediaSession.setActionHandler('seekbackward', (details) => {\n        handleMediaSessionSeek(-(details?.seekOffset || 10));\n      });\n      navigator.mediaSession.setActionHandler('seekforward', (details) => {\n        handleMediaSessionSeek(details?.seekOffset || 10);\n      });\n      navigator.mediaSession.setActionHandler('seekto', (details) => {\n        const video = mediaSessionVideo();\n        if (!video || details?.seekTime == null) return;\n        video.currentTime = details.seekTime;\n        syncMediaSessionPlayback(video);\n      });\n      mediaSessionHandlersInstalled = true;\n      lastMediaSessionHandlerInstallAt = now;\n    } catch {\n      // MediaSession or a particular action is optional in older iOS WebKit.\n    }\n  }\n\n  function prepareForBackground() {\n    const video = state.video || findVideo();\n    if (!video) return;\n    attachVideo(video);\n    if (!video.paused && !video.ended) claimMediaSessionOwnership(video);\n    installMediaSessionHandlers();\n    configurePlaybackAudioSession();\n    // Respect an intentional Now Playing / toolbar pause window so background\n    // recovery cannot immediately undo Lock Screen or Dynamic Island pause.\n    if (\n      !video.paused &&\n      !video.ended &&\n      Date.now() > state.userPauseUntil\n    ) {\n      state.wantsPlayback = true;\n    }\n    if (state.wantsPlayback) recoverPlayback(video);\n  }\n\n  const SKIP_BUTTON_SELECTOR = [\n    '.ytp-ad-skip-button',\n    '.ytp-ad-skip-button-modern',\n    '.ytp-skip-ad-button',\n    '.videoAdUiSkipButton',\n    'button[class*=\"ytp-ad-skip\"]',\n  ].join(',');\n\n  function restoreAdSkipTweaks() {\n    document.querySelectorAll('video[data-fyp-ad-skip-rate]').forEach((video) => {\n      const restored = Number(video.dataset.fypAdSkipRate);\n      if (Number.isFinite(restored) && restored > 0 && restored <= 4) {\n        video.playbackRate = restored;\n      } else {\n        video.playbackRate = 1;\n      }\n      delete video.dataset.fypAdSkipRate;\n    });\n  }\n\n  function playerIsSkippingAd(player) {\n    if (!(player instanceof Element)) return false;\n    if (\n      !player.classList.contains('ad-showing') &&\n      !player.classList.contains('ad-interrupting')\n    ) {\n      return false;\n    }\n    const duration = player.querySelector('video')?.duration;\n    return Boolean(\n      player.querySelector(AD_PLAYER_UI_SELECTOR) ||\n        (Number.isFinite(duration) &&\n          duration > 0 &&\n          duration <= MAX_AD_SEEK_DURATION_S)\n    );\n  }\n\n  function skipPlayerAd() {\n    document.querySelectorAll(SKIP_BUTTON_SELECTOR).forEach((button) => {\n      if (button instanceof HTMLElement) button.click();\n    });\n\n    const player = document.querySelector(AD_PLAYER_SELECTOR);\n    if (!playerIsSkippingAd(player)) {\n      restoreAdSkipTweaks();\n      const video = findVideo();\n      if (video) attachVideo(video);\n      return;\n    }\n\n    const adVideo = player.querySelector('video');\n    if (!(adVideo instanceof HTMLMediaElement)) return;\n    attachVideo(adVideo);\n    if (adVideo.dataset.fypAdSkipRate == null) {\n      adVideo.dataset.fypAdSkipRate = String(adVideo.playbackRate || 1);\n    }\n    const duration = adVideo.duration;\n    if (\n      Number.isFinite(duration) &&\n      duration > 0 &&\n      duration <= MAX_AD_SEEK_DURATION_S &&\n      adVideo.currentTime < duration\n    ) {\n      adVideo.currentTime = duration;\n    } else if (adVideo.playbackRate < 8) {\n      adVideo.playbackRate = 16;\n    }\n  }\n\n  const AD_BLOCK_ENFORCEMENT_PATTERN =\n    /ad blockers? (?:are not allowed|violate)|ad blocker.{0,40}youtube|video playback is blocked|disable (?:your )?ad blocker|allow youtube ads|ad-blocking software/i;\n\n  function guideDrawerIsBusy() {\n    /*\n     * Issue #1: hamburger close can leave YouTube's overlay lock behind.\n     * Treat the drawer as busy while it is open, opening, or peeking so we\n     * never clear overflow / scrim while the user is still in the menu.\n     * Read Polymer state only. Do not set opened / peeking / swipe.\n     */\n    const drawer = document.querySelector(\n      'tp-yt-app-drawer#guide, tp-yt-app-drawer'\n    );\n    if (!(drawer instanceof HTMLElement)) return false;\n    if (\n      drawer.hasAttribute('opened') ||\n      drawer.hasAttribute('opening') ||\n      drawer.hasAttribute('peeking')\n    ) {\n      return true;\n    }\n    try {\n      if (drawer.opened === true) return true;\n    } catch {\n      // Polymer may throw on unready custom elements.\n    }\n    return false;\n  }\n\n  function overlayHostIsOpen() {\n    return Boolean(\n      document.querySelector(\n        'tp-yt-paper-dialog[opened], tp-yt-iron-dropdown[opened], ' +\n          'iron-dropdown[opened]'\n      )\n    );\n  }\n\n  function removeOrphanAdBackdrops() {\n    /*\n     * Ad-blocker dialogs share YouTube's iron overlay backdrop class with the\n     * hamburger drawer. Only remove backdrops that are not inside the drawer\n     * and only when no dialog or drawer is open.\n     */\n    if (guideDrawerIsBusy() || overlayHostIsOpen()) return;\n    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((backdrop) => {\n      if (!(backdrop instanceof HTMLElement)) return;\n      if (backdrop.closest('tp-yt-app-drawer')) return;\n      backdrop.remove();\n    });\n  }\n\n  function restoreScrollAfterGuideClose() {\n    /*\n     * After close, Polymer may keep overflow:hidden on html/body/ytd-app\n     * because the mini-guide rail we hide is the state it expects to restore.\n     * Clear that leftover lock. CSS hides leftover #scrim separately.\n     */\n    if (guideDrawerIsBusy() || overlayHostIsOpen()) return;\n\n    for (const node of [\n      document.documentElement,\n      document.body,\n      document.querySelector('ytd-app'),\n      document.querySelector('ytm-app'),\n      document.querySelector('ytd-page-manager'),\n    ]) {\n      if (!(node instanceof HTMLElement)) continue;\n      if (node.style.overflow === 'hidden' || node.style.overflowY === 'hidden') {\n        node.style.removeProperty('overflow');\n        node.style.removeProperty('overflow-y');\n      }\n    }\n\n    const app = document.querySelector('ytd-app');\n    if (\n      app instanceof HTMLElement &&\n      app.getAttribute('aria-hidden') === 'true'\n    ) {\n      app.removeAttribute('aria-hidden');\n    }\n  }\n\n  function dismissAdBlockEnforcement(root = document) {\n    let removed = false;\n    const candidates = root.querySelectorAll?.(\n      [\n        'ytd-enforcement-message-view-model',\n        'yt-playability-error-supported-renderers',\n        '#error-screen',\n        'tp-yt-paper-dialog',\n      ].join(',')\n    );\n    for (const candidate of candidates || []) {\n      const text = (candidate.textContent || '').replace(/\\s+/g, ' ').trim();\n      if (!AD_BLOCK_ENFORCEMENT_PATTERN.test(text)) continue;\n      const dialog = candidate.closest('tp-yt-paper-dialog') || candidate;\n      dialog.remove();\n      removed = true;\n    }\n    if (!removed) return;\n\n    removeOrphanAdBackdrops();\n    restoreScrollAfterGuideClose();\n\n    const video = findVideo();\n    if (video && video.paused && !video.ended && video.readyState > 0) {\n      attachVideo(video);\n      state.wantsPlayback = true;\n      state.userPauseUntil = 0;\n      safePlay(video);\n    }\n  }\n\n  function removeAdCards(root = document) {\n    const selector = [\n      'ytm-promoted-sparkles-web-renderer',\n      'ytm-companion-ad-renderer',\n      'ytm-display-ad-renderer',\n      'ytm-promoted-video-renderer',\n      'ytm-ad-slot-renderer',\n      'ytd-companion-slot-renderer',\n      'ytd-companion-ad-renderer',\n      'ytd-action-companion-ad-renderer',\n      'ytd-banner-promo-renderer-background',\n      'ytd-video-masthead-ad-v3-renderer',\n      'ytd-video-masthead-ad-renderer',\n      'ytd-video-masthead-ad-primary-video-renderer',\n      'ytd-in-feed-ad-layout-renderer',\n      'ytd-promoted-sparkles-web-renderer',\n      'ytd-promoted-sparkles-text-search-renderer',\n      'ytd-display-ad-renderer',\n      'ytd-promoted-video-renderer',\n      'ytd-ad-slot-renderer',\n      'ytd-banner-promo-renderer',\n      'ytd-statement-banner-renderer',\n      '.ytp-ad-overlay-container',\n      '.ytp-ad-message-container',\n      '.ytp-ad-module',\n      '.ytp-ad-overlay-slot',\n      '.video-ads',\n      '#player-ads',\n      '#masthead-ad',\n    ].join(',');\n    root.querySelectorAll?.(selector).forEach((element) => element.remove());\n  }\n\n  function injectStyle() {\n    let style = document.getElementById(STYLE_ID);\n    if (!style) {\n      style = document.createElement('style');\n      style.id = STYLE_ID;\n      const styleHost = document.head || document.documentElement;\n      if (styleHost) styleHost.appendChild(style);\n    }\n    if (style.dataset.layoutVersion === NAV_LAYOUT_VERSION) return;\n    style.dataset.layoutVersion = NAV_LAYOUT_VERSION;\n    style.textContent = `\n      ytm-promoted-sparkles-web-renderer,\n      ytm-companion-ad-renderer,\n      ytm-display-ad-renderer,\n      ytm-promoted-video-renderer,\n      ytm-ad-slot-renderer,\n      ytd-companion-slot-renderer,\n      ytd-companion-ad-renderer,\n      ytd-action-companion-ad-renderer,\n      ytd-banner-promo-renderer-background,\n      ytd-video-masthead-ad-v3-renderer,\n      ytd-video-masthead-ad-renderer,\n      ytd-video-masthead-ad-primary-video-renderer,\n      ytd-in-feed-ad-layout-renderer,\n      ytd-promoted-sparkles-web-renderer,\n      ytd-promoted-sparkles-text-search-renderer,\n      ytd-display-ad-renderer,\n      ytd-promoted-video-renderer,\n      ytd-ad-slot-renderer,\n      ytd-banner-promo-renderer,\n      ytd-statement-banner-renderer,\n      .ytp-ad-overlay-container,\n      .ytp-ad-message-container,\n      .ytp-ad-player-overlay,\n      .ytp-ad-module,\n      .ytp-ad-overlay-slot,\n      .video-ads,\n      #player-ads,\n      #masthead-ad {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n      }\n\n      /* Burger drawer only \u2014 hide every persistent Home/Shorts/Subs/You rail and mini-games. */\n      ytm-pivot-bar-renderer,\n      ytd-mini-guide-renderer,\n      ytd-mini-guide-entry-renderer,\n      #guide-button-badge,\n      ytd-guide-entry-renderer:has(a[href^='/shorts']),\n      ytd-guide-entry-renderer:has(a[href*='/playables']),\n      ytd-guide-entry-renderer:has(a[title*='Playables' i]),\n      ytd-mini-guide-entry-renderer:has(a[href^='/shorts']),\n      ytd-mini-guide-entry-renderer:has(a[href*='/playables']),\n      ytd-guide-entry-renderer:has(a[title='Shorts']),\n      tp-yt-paper-item:has(a[href^='/shorts']),\n      tp-yt-paper-item:has(a[href*='/playables']),\n      ytd-rich-shelf-renderer:has(a[href*='/shorts']),\n      ytd-rich-shelf-renderer:has(a[href*='/playables']),\n      ytd-rich-shelf-renderer:has([title*='Playables' i]),\n      ytd-rich-shelf-renderer:has([aria-label*='Playables' i]),\n      ytd-reel-shelf-renderer,\n      ytd-rich-section-renderer:has(a[href*='/shorts']),\n      ytd-rich-section-renderer:has(a[href*='/playables']),\n      ytd-rich-section-renderer:has([title*='Playables' i]),\n      ytd-rich-section-renderer:has([aria-label*='Playables' i]),\n      ytm-reel-shelf-renderer,\n      ytm-shorts-lockup-view-model,\n      ytm-shorts-lockup-view-model-v2,\n      ytd-reel-item-renderer,\n      ytm-reel-item-renderer,\n      ytd-rich-item-renderer:has(a[href*='/shorts']),\n      ytd-rich-item-renderer:has(a[href*='/playables']),\n      yt-lockup-view-model:has(a[href*='/shorts']),\n      yt-lockup-view-model:has(a[href*='/playables']),\n      grid-shelf-view-model:has(a[href*='/shorts']),\n      grid-shelf-view-model:has(a[href*='/playables']),\n      grid-shelf-view-model:has([title*='Playables' i]),\n      grid-shelf-view-model:has([aria-label*='Playables' i]),\n      yt-playable-game-renderer,\n      ytd-game-card-renderer,\n      ytd-playable-renderer,\n      ytd-playables-shelf-renderer,\n      yt-playables-shelf-renderer,\n      yt-chip-cloud-chip-renderer:has(yt-formatted-string[title*='Playables' i]),\n      yt-chip-cloud-chip-renderer:has([title*='Playables' i]),\n      ytd-browse[page-subtype='channels'] yt-tab-shape:has(a[href$='/shorts']),\n      ytd-browse[page-subtype='channels'] [role='tab']:has(a[href$='/shorts']),\n      ytd-browse[page-subtype='channels'] ytd-rich-item-renderer:has(a[href*='/shorts']),\n      ytd-browse[page-subtype='channels'] ytd-grid-video-renderer:has(a[href*='/shorts']),\n      ytd-browse[page-subtype='channels'] yt-lockup-view-model:has(a[href*='/shorts']),\n      ytd-browse[page-subtype='channels'] ytd-reel-shelf-renderer,\n      ytd-browse[page-subtype='channels'] ytd-rich-shelf-renderer:has(a[href*='/shorts']),\n      a[href^='/shorts'],\n      a[href*='youtube.com/shorts/'],\n      a[href^='/playables'],\n      a[href*='youtube.com/playables'],\n      [is-shorts],\n      [is-playables],\n      [is-playable],\n      ytd-thumbnail[href*='/shorts'],\n      ytd-thumbnail[href*='/playables'] {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n      }\n\n      /*\n       * Stabilize guide sidebar scrolling:\n       * Prevent vertical scroll gestures inside the drawer from chaining to\n       * window or triggering Polymer's swipe-to-close gesture.\n       */\n      tp-yt-app-drawer#guide {\n        touch-action: pan-y !important;\n      }\n      tp-yt-app-drawer#guide #contentContainer {\n        touch-action: pan-y !important;\n        overscroll-behavior: contain !important;\n        overscroll-behavior-y: contain !important;\n      }\n      tp-yt-app-drawer#guide ytd-guide-renderer,\n      tp-yt-app-drawer#guide #guide-wrapper,\n      tp-yt-app-drawer#guide #guide-inner-content,\n      tp-yt-app-drawer#guide #sections,\n      tp-yt-app-drawer#guide #items {\n        touch-action: pan-y !important;\n        overscroll-behavior: contain !important;\n        overscroll-behavior-y: contain !important;\n        -webkit-overflow-scrolling: touch !important;\n      }\n\n      ytd-app {\n        --ytd-mini-guide-width: 0px !important;\n        --ytd-mini-guide-width-min: 0px !important;\n      }\n\n      ytd-app[guide-persistent],\n      ytd-app[mini-guide-visible] {\n        --ytd-mini-guide-width: 0px !important;\n        --ytd-mini-guide-width-min: 0px !important;\n      }\n\n      /*\n       * 3.1.0 / issue #1: Closing the hamburger can leave #scrim painted over\n       * the page (grey overlay + no scroll) because the mini-guide rail is\n       * hidden. Hide leftover scrim only when the drawer is not open,\n       * opening, or peeking. Do not touch opened / peeking / swipe attributes.\n       */\n      tp-yt-app-drawer#guide:not([opened]):not([opening]):not([peeking]) #scrim,\n      tp-yt-app-drawer:not([opened]):not([opening]):not([peeking]) > #scrim {\n        pointer-events: none !important;\n        opacity: 0 !important;\n        visibility: hidden !important;\n      }\n\n      /* Kill YouTube miniplayer when leaving a video. */\n      ytd-miniplayer,\n      ytd-miniplayer[active],\n      #miniplayer,\n      #miniplayer-container,\n      .ytp-miniplayer-ui,\n      ytd-app[miniplayer-active_] #movie_player,\n      .miniplayer {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n        width: 0 !important;\n        height: 0 !important;\n        opacity: 0 !important;\n      }\n\n      /* Force the guide (burger) button to stay visible on narrow Orion layouts.\n         Do NOT force the drawer itself visible \u2014 that makes it peek while scrolling. */\n      #guide-button,\n      ytd-masthead #guide-button,\n      #guide-button-icon,\n      button#button.yt-icon-button[aria-label='Guide'],\n      ytd-masthead button[aria-label='Guide'] {\n        display: inline-flex !important;\n        visibility: visible !important;\n        opacity: 1 !important;\n        pointer-events: auto !important;\n        width: 40px !important;\n        min-width: 40px !important;\n        height: 40px !important;\n      }\n\n      /* Remove header upload / create. */\n      ytd-masthead ytd-topbar-menu-button-renderer:has(a[href*='upload']),\n      ytd-masthead ytd-button-renderer:has(a[href*='upload']),\n      ytd-masthead a[href='/upload'],\n      ytd-masthead a[href*='upload?'],\n      ytd-masthead button[aria-label='Create'],\n      ytd-masthead button[aria-label*='Create a video'],\n      ytd-masthead [aria-label='Upload video'],\n      ytd-masthead [aria-label='Upload'],\n      #masthead-upload-button,\n      ytm-mobile-topbar-renderer button[aria-label*='Upload'],\n      ytm-mobile-topbar-renderer button[aria-label*='Create'],\n      ytm-mobile-topbar-renderer a[href*='upload'],\n      ytm-topbar-menu-button-renderer:has([aria-label*='Upload']),\n      ytm-topbar-menu-button-renderer:has([aria-label*='Create']) {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n        width: 0 !important;\n        min-width: 0 !important;\n        margin: 0 !important;\n        padding: 0 !important;\n        overflow: hidden !important;\n      }\n\n      /*\n       * Desktop YouTube has a 426px minimum watch-column width. On an iPhone it\n       * centers that wider column and cuts roughly 18px from the left edge.\n       * Collapse only the content column at phone widths; the desktop player\n       * and data model stay untouched.\n       *\n       * 2.2.9: also clip overflow on ytd-app / page-manager (html/body alone\n       * does not stop WebKit horizontal swipe when a child paints past 100vw).\n       * Prefer max-width: 100% over 100vw to avoid the classic vw+padding bleed.\n       */\n      @media (max-width: 700px) {\n        html,\n        body,\n        ytd-app,\n        ytm-app,\n        ytd-page-manager,\n        #content.ytd-app,\n        #page-manager,\n        ytd-watch-flexy,\n        ytd-watch-flexy #columns {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n        }\n\n        html,\n        body,\n        ytd-app,\n        ytm-app,\n        ytd-page-manager,\n        #content.ytd-app,\n        #page-manager {\n          overflow-x: hidden !important;\n          overscroll-behavior-x: none !important;\n        }\n\n        @supports (overflow: clip) {\n          html,\n          body,\n          ytd-app,\n          ytm-app,\n          ytd-page-manager,\n          #content.ytd-app,\n          #page-manager {\n            overflow-x: clip !important;\n          }\n        }\n\n        /* Cap desktop shells that still paint wider than the phone viewport. */\n        ytd-browse,\n        ytd-search,\n        ytd-two-column-browse-results-renderer,\n        ytd-two-column-search-results-renderer,\n        #masthead-container,\n        ytd-masthead,\n        #columns,\n        #primary,\n        #secondary,\n        #primary-inner,\n        #secondary-inner {\n          box-sizing: border-box !important;\n          max-width: 100% !important;\n          min-width: 0 !important;\n        }\n\n        /* Watch must stack: player \u2192 title \u2192 FYP buttons (never side-by-side). */\n        ytd-watch-flexy {\n          --ytd-watch-flexy-height-for-player: auto !important;\n          --ytd-watch-flexy-max-player-height: none !important;\n        }\n\n        ytd-watch-flexy #columns {\n          display: flex !important;\n          flex-direction: column !important;\n          align-items: stretch !important;\n          gap: 0 !important;\n          row-gap: 0 !important;\n        }\n\n        ytd-watch-flexy #secondary,\n        ytd-watch-flexy #secondary-inner {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          min-height: 0 !important;\n          height: auto !important;\n          margin: 0 !important;\n          padding: 0 !important;\n        }\n\n        ytd-watch-flexy[is-single-column] #primary,\n        ytd-watch-flexy #primary {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          min-height: 0 !important;\n          margin: 0 !important;\n          padding: 0 12px !important;\n        }\n\n        /*\n         * Keep the player footprint tight to the video. Desktop theater /\n         * full-bleed CSS vars otherwise reserve a tall empty region under the\n         * video before title + transport controls. Only the active shell gets\n         * a 16:9 box \u2014 the unused sibling collapses to zero.\n         */\n        ytd-watch-flexy[full-bleed-player] #player-full-bleed-container,\n        ytd-watch-flexy:not([full-bleed-player]) #player,\n        ytd-watch-flexy:not([full-bleed-player]) #player-container-outer {\n          box-sizing: border-box !important;\n          display: block !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          height: auto !important;\n          min-height: 0 !important;\n          max-height: none !important;\n          margin: 0 !important;\n          aspect-ratio: 16 / 9 !important;\n          float: none !important;\n          clear: both !important;\n        }\n\n        ytd-watch-flexy #player-container-inner,\n        ytd-watch-flexy ytd-player {\n          box-sizing: border-box !important;\n          display: block !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          height: 100% !important;\n          min-height: 0 !important;\n          margin: 0 !important;\n          float: none !important;\n          clear: both !important;\n        }\n\n        /* Collapse whichever shell is not hosting the video. */\n        ytd-watch-flexy:not([full-bleed-player]) #player-full-bleed-container,\n        ytd-watch-flexy[full-bleed-player] #columns #player,\n        ytd-watch-flexy[theater] #columns #player {\n          height: 0 !important;\n          min-height: 0 !important;\n          max-height: 0 !important;\n          margin: 0 !important;\n          padding: 0 !important;\n          overflow: hidden !important;\n          border: 0 !important;\n          aspect-ratio: auto !important;\n        }\n\n        ytd-watch-flexy #primary-inner,\n        ytd-watch-flexy #below,\n        ytd-watch-flexy ytd-watch-metadata,\n        ytd-watch-flexy #panels {\n          box-sizing: border-box !important;\n          display: block !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          min-height: 0 !important;\n          margin-top: 0 !important;\n          float: none !important;\n          clear: both !important;\n          overflow: visible !important;\n        }\n\n        ytd-watch-flexy ytd-watch-metadata #title,\n        ytd-watch-flexy ytd-watch-metadata h1 {\n          display: block !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          margin-top: clamp(.35rem, 1.5vw, .55rem) !important;\n          margin-bottom: 0 !important;\n        }\n\n        ytd-watch-flexy ytd-menu-renderer,\n        ytd-watch-flexy #actions,\n        ytd-watch-flexy #actions-inner,\n        ytd-watch-flexy #menu {\n          max-width: 100% !important;\n        }\n\n        /*\n         * Native playlist panel lives in #secondary on desktop. After the\n         * phone stack moves it under the description, keep it full-width and\n         * cap the video list so it does not push comments off-screen.\n         */\n        ytd-watch-flexy #below ytd-playlist-panel-renderer,\n        ytd-watch-flexy #below #playlist {\n          box-sizing: border-box !important;\n          display: block !important;\n          visibility: visible !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          height: auto !important;\n          margin: 8px 0 0 !important;\n          overflow: visible !important;\n        }\n\n        ytd-watch-flexy #below ytd-playlist-panel-renderer #items {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          max-height: min(42vh, 22rem) !important;\n          overflow-x: hidden !important;\n          overflow-y: auto !important;\n        }\n\n        /*\n         * Playlist browse pages keep a desktop sidebar header. Stack the\n         * header/description above the video list so the playlist does not\n         * leave the phone viewport.\n         */\n        ytd-browse[page-subtype='playlist'],\n        ytd-browse[page-subtype='playlist']\n          ytd-two-column-browse-results-renderer,\n        ytd-browse[page-subtype='playlist'] #primary,\n        ytd-browse[page-subtype='playlist'] #secondary,\n        ytd-browse[page-subtype='playlist'] ytd-playlist-header-renderer,\n        ytd-browse[page-subtype='playlist'] yt-page-header-renderer {\n          box-sizing: border-box !important;\n          display: block !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin-left: 0 !important;\n          margin-right: 0 !important;\n        }\n\n        ytd-browse[page-subtype='playlist'] ytd-playlist-header-renderer,\n        ytd-browse[page-subtype='playlist'] yt-page-header-renderer {\n          position: relative !important;\n          height: auto !important;\n        }\n\n        /*\n         * Search-only screenshot stack:\n         * channel \u2192 thumbnail \u2192 snippet \u2192 badges \u2192 views \u2192 title+menu \u2192 chapters.\n         * Flatten nested wrappers so those nodes can take named grid areas.\n         * Never target Home feed lockups.\n         */\n        ytd-search,\n        ytd-search ytd-two-column-search-results-renderer,\n        ytd-search #primary,\n        ytd-search #contents {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n        }\n\n        ytd-search ytd-video-renderer,\n        ytd-search ytd-rich-item-renderer:has(a[href*='/watch']),\n        ytd-search yt-lockup-view-model:has(a[href*='/watch']) {\n          box-sizing: border-box !important;\n          display: block !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin: 0 0 14px !important;\n          padding: 0 !important;\n          max-height: none !important;\n          height: auto !important;\n          overflow: visible !important;\n          --ytd-thumbnail-width: 100% !important;\n          --ytd-thumbnail-max-width: 100% !important;\n          --yt-thumbnail-width: 100% !important;\n          --yt-thumbnail-max-width: 100% !important;\n        }\n\n        ytd-search ytd-video-renderer #dismissible.ytd-video-renderer,\n        ytd-search ytd-video-renderer #dismissible,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          :is(\n            .yt-lockup-view-model,\n            .ytLockupViewModelHost,\n            .ytLockupViewModelHorizontal,\n            .yt-lockup-view-model-wiz\n          ) {\n          box-sizing: border-box !important;\n          display: grid !important;\n          grid-template-columns: minmax(0, 1fr) auto !important;\n          grid-template-areas:\n            \"channel channel\"\n            \"thumb thumb\"\n            \"snippet snippet\"\n            \"badges badges\"\n            \"views views\"\n            \"title menu\"\n            \"chapters chapters\" !important;\n          align-items: start !important;\n          justify-items: stretch !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          column-gap: 0 !important;\n          row-gap: 6px !important;\n          max-height: none !important;\n          height: auto !important;\n          overflow: visible !important;\n        }\n\n        ytd-search ytd-video-renderer ytd-thumbnail.ytd-video-renderer,\n        ytd-search ytd-video-renderer ytd-thumbnail,\n        ytd-search ytd-rich-item-renderer ytd-thumbnail,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          ytd-thumbnail,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          yt-thumbnail-view-model,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          [class*='content-image' i],\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          [class*='ContentImage'] {\n          box-sizing: border-box !important;\n          display: block !important;\n          position: relative !important;\n          grid-area: thumb !important;\n          flex: 0 0 auto !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          height: auto !important;\n          max-height: none !important;\n          min-height: 0 !important;\n          margin: 0 !important;\n          overflow: hidden !important;\n          border-radius: 12px !important;\n          aspect-ratio: 16 / 9 !important;\n          visibility: visible !important;\n          opacity: 1 !important;\n          inset: auto !important;\n          left: auto !important;\n          top: auto !important;\n          transform: none !important;\n        }\n\n        ytd-search ytd-video-renderer ytd-thumbnail::before {\n          display: none !important;\n        }\n\n        ytd-search ytd-video-renderer a#thumbnail {\n          position: absolute !important;\n          inset: 0 !important;\n          width: 100% !important;\n          height: 100% !important;\n          margin: 0 !important;\n          aspect-ratio: auto !important;\n          border-radius: inherit !important;\n        }\n\n        ytd-search ytd-video-renderer ytd-thumbnail yt-image,\n        ytd-search ytd-video-renderer a#thumbnail yt-image,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          yt-thumbnail-view-model yt-image,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          [class*='content-image' i] yt-image {\n          position: absolute !important;\n          inset: 0 !important;\n          display: block !important;\n          width: 100% !important;\n          height: 100% !important;\n        }\n\n        ytd-search ytd-video-renderer ytd-thumbnail img,\n        ytd-search ytd-video-renderer a#thumbnail img,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          yt-thumbnail-view-model img,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          [class*='content-image' i] img,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          [class*='ContentImage'] img {\n          position: absolute !important;\n          inset: 0 !important;\n          display: block !important;\n          width: 100% !important;\n          height: 100% !important;\n          max-width: none !important;\n          max-height: none !important;\n          object-fit: cover !important;\n          visibility: visible !important;\n          opacity: 1 !important;\n        }\n\n        ytd-search ytd-video-renderer #details,\n        ytd-search ytd-video-renderer #meta,\n        ytd-search ytd-video-renderer ytd-video-meta-block,\n        ytd-search ytd-video-renderer #title-wrapper,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          yt-lockup-metadata-view-model,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          :is(\n            .yt-lockup-metadata-view-model,\n            .ytLockupMetadataViewModelHost,\n            .yt-content-metadata-view-model,\n            .ytContentMetadataViewModelHost\n          ) {\n          display: contents !important;\n        }\n\n        /*\n         * One channel row only. Desktop search keeps a byline name in\n         * addition to #channel-info; showing both duplicates the name.\n         */\n        ytd-search ytd-video-renderer ytd-video-meta-block #byline-container {\n          display: none !important;\n        }\n\n        ytd-search ytd-video-renderer #channel-info,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          :is(\n            .yt-content-metadata-view-model__metadata-row,\n            .ytContentMetadataViewModelMetadataRow\n          ):first-of-type {\n          grid-area: channel !important;\n          display: flex !important;\n          visibility: visible !important;\n          align-items: center !important;\n          gap: 8px !important;\n          max-width: 100% !important;\n          margin: 0 !important;\n          padding: 0 !important;\n          overflow: visible !important;\n        }\n\n        ytd-search ytd-video-renderer #channel-info yt-img-shadow,\n        ytd-search ytd-video-renderer #avatar,\n        ytd-search ytd-video-renderer #avatar-link,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          yt-decorated-avatar-view-model {\n          display: inline-flex !important;\n          flex: 0 0 24px !important;\n          align-self: center !important;\n          visibility: visible !important;\n          width: 24px !important;\n          height: 24px !important;\n          min-width: 24px !important;\n          min-height: 24px !important;\n          max-width: 24px !important;\n          max-height: 24px !important;\n          aspect-ratio: 1 / 1 !important;\n          overflow: hidden !important;\n          border-radius: 50% !important;\n        }\n\n        ytd-search ytd-video-renderer #channel-info img,\n        ytd-search ytd-video-renderer #avatar img,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          yt-decorated-avatar-view-model img,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          yt-decorated-avatar-view-model yt-image {\n          position: static !important;\n          inset: auto !important;\n          display: block !important;\n          width: 100% !important;\n          height: 100% !important;\n          max-width: 24px !important;\n          max-height: 24px !important;\n          aspect-ratio: 1 / 1 !important;\n          object-fit: cover !important;\n          border-radius: 50% !important;\n        }\n\n        ytd-search ytd-video-renderer #description-text,\n        ytd-search ytd-video-renderer .metadata-snippet-container,\n        ytd-search ytd-video-renderer #description-inner,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          :is(\n            .yt-lockup-metadata-view-model__description,\n            .ytLockupMetadataViewModelDescription\n          ) {\n          grid-area: snippet !important;\n          display: -webkit-box !important;\n          visibility: visible !important;\n          -webkit-line-clamp: 1 !important;\n          -webkit-box-orient: vertical !important;\n          max-width: 100% !important;\n          margin: 0 !important;\n          padding: 0 !important;\n          overflow: hidden !important;\n          font-size: 12px !important;\n          line-height: 1.35 !important;\n          opacity: 0.82 !important;\n        }\n\n        ytd-search ytd-video-renderer ytd-badge-supported-renderer,\n        ytd-search ytd-video-renderer yt-badge-view-model,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          yt-badge-view-model {\n          grid-area: badges !important;\n          display: flex !important;\n          visibility: visible !important;\n          flex-wrap: wrap !important;\n          gap: 6px !important;\n          margin: 0 !important;\n          padding: 0 !important;\n        }\n\n        ytd-search ytd-video-renderer #metadata-line,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          :is(\n            .yt-content-metadata-view-model__metadata-row,\n            .ytContentMetadataViewModelMetadataRow\n          ):not(:first-of-type) {\n          grid-area: views !important;\n          display: block !important;\n          visibility: visible !important;\n          max-width: 100% !important;\n          margin: 0 !important;\n          padding: 0 !important;\n          overflow: hidden !important;\n          font-size: 12px !important;\n          line-height: 1.3 !important;\n          opacity: 0.85 !important;\n        }\n\n        ytd-search ytd-video-renderer h3 {\n          grid-area: title !important;\n          display: block !important;\n          max-height: none !important;\n          margin: 0 !important;\n          padding: 0 !important;\n          overflow: visible !important;\n        }\n\n        ytd-search ytd-video-renderer #video-title,\n        ytd-search ytd-video-renderer h3 #video-title,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          :is(\n            .yt-lockup-metadata-view-model__title,\n            .ytLockupMetadataViewModelTitle\n          ) {\n          grid-area: title !important;\n          display: -webkit-box !important;\n          -webkit-line-clamp: 2 !important;\n          -webkit-box-orient: vertical !important;\n          max-height: none !important;\n          margin: 0 !important;\n          padding: 0 !important;\n          overflow: hidden !important;\n          white-space: normal !important;\n          text-overflow: ellipsis !important;\n          font-size: clamp(16px, 4.4vw, 18px) !important;\n          font-weight: 700 !important;\n          line-height: 1.25 !important;\n        }\n\n        ytd-search ytd-video-renderer #menu {\n          grid-area: menu !important;\n          position: static !important;\n          align-self: start !important;\n          justify-self: end !important;\n          margin: 0 !important;\n        }\n\n        ytd-search ytd-video-renderer ytd-expandable-metadata-renderer,\n        ytd-search\n          yt-lockup-view-model:has(a[href*='/watch'])\n          ytd-expandable-metadata-renderer {\n          grid-area: chapters !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          margin: 2px 0 0 !important;\n        }\n\n        /* Kill AI Summary / Ask chips and preview panels. Keep chapters. */\n        ytd-search button[aria-label*='Summary' i],\n        ytd-search button[aria-label*='Ask' i],\n        ytd-search [aria-label*='AI summary' i],\n        ytd-search [aria-label*='AI overview' i],\n        ytd-search ytd-button-renderer:has([aria-label*='Summary' i]),\n        ytd-search ytd-button-renderer:has([aria-label*='Ask' i]),\n        ytd-search ytd-info-panel-container-renderer,\n        ytd-search ytd-clarification-renderer,\n        ytd-search\n          ytd-expandable-metadata-renderer:has([aria-label*='Summary' i]),\n        ytd-search\n          ytd-expandable-metadata-renderer:has([aria-label*='AI' i]) {\n          display: none !important;\n          visibility: hidden !important;\n          pointer-events: none !important;\n          height: 0 !important;\n          margin: 0 !important;\n          padding: 0 !important;\n          overflow: hidden !important;\n        }\n\n        ytd-rich-grid-renderer {\n          --ytd-rich-grid-items-per-row: 1 !important;\n          --ytd-rich-grid-posts-per-row: 1 !important;\n        }\n\n        ytd-rich-grid-row,\n        ytd-rich-item-renderer {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          margin-left: 0 !important;\n          margin-right: 0 !important;\n        }\n\n        ytd-browse[page-subtype='channels'],\n        ytd-browse[page-subtype='channels'] #primary,\n        ytd-browse[page-subtype='channels']\n          ytd-two-column-browse-results-renderer,\n        ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer,\n        ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer #contents {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin-right: 0 !important;\n          margin-left: 0 !important;\n          overflow-x: hidden !important;\n        }\n\n        ytd-browse[page-subtype='channels'] ytd-rich-grid-renderer {\n          --ytd-rich-grid-items-per-row: 1 !important;\n          --ytd-rich-grid-posts-per-row: 1 !important;\n        }\n\n        ytd-browse[page-subtype='channels'] ytd-rich-grid-row,\n        ytd-browse[page-subtype='channels'] ytd-rich-item-renderer,\n        ytd-browse[page-subtype='channels'] ytd-grid-video-renderer,\n        ytd-browse[page-subtype='channels'] ytd-video-renderer,\n        ytd-browse[page-subtype='channels']\n          ytd-channel-video-player-renderer,\n        ytd-browse[page-subtype='channels'] yt-lockup-view-model,\n        ytd-browse[page-subtype='channels'] ytd-thumbnail {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin-right: 0 !important;\n          margin-left: 0 !important;\n        }\n\n        /*\n         * History: Home-like equal gutters, centered cards/chips, title under\n         * thumbnail, channel avatar restored, Clear/Pause/Manage/Search kept.\n         */\n        ytd-browse[page-subtype='history'],\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          overflow-x: hidden !important;\n        }\n\n        ytd-browse[page-subtype='history']\n          ytd-two-column-browse-results-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          ytd-two-column-browse-results-renderer {\n          box-sizing: border-box !important;\n          display: flex !important;\n          flex-direction: column !important;\n          align-items: center !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin: 0 auto !important;\n          padding: 0 12px !important;\n          overflow-x: hidden !important;\n        }\n\n        ytd-browse[page-subtype='history'] #primary,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #primary,\n        ytd-browse[page-subtype='history'] #secondary,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary,\n        ytd-browse[page-subtype='history'] #secondary-inner,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary-inner,\n        ytd-browse[page-subtype='history'] ytd-section-list-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-section-list-renderer,\n        ytd-browse[page-subtype='history'] ytd-item-section-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-item-section-renderer,\n        ytd-browse[page-subtype='history'] ytd-rich-grid-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-rich-grid-renderer,\n        ytd-browse[page-subtype='history'] ytd-rich-grid-renderer #contents,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          ytd-rich-grid-renderer #contents {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin-left: auto !important;\n          margin-right: auto !important;\n          padding-left: 0 !important;\n          padding-right: 0 !important;\n        }\n\n        /* Keep History tools above the list and centered. */\n        ytd-browse[page-subtype='history'] #secondary,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary,\n        ytd-browse[page-subtype='history'] #secondary-inner,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary-inner,\n        ytd-browse[page-subtype='history'] ytd-browse-feed-actions-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          ytd-browse-feed-actions-renderer {\n          display: flex !important;\n          visibility: visible !important;\n          flex-direction: column !important;\n          align-items: center !important;\n          order: -1 !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          position: static !important;\n          margin: 0 auto 8px !important;\n          padding: 0 !important;\n          text-align: center !important;\n        }\n\n        ytd-browse[page-subtype='history'] #secondary input,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary input,\n        ytd-browse[page-subtype='history'] #secondary yt-searchbox,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary yt-searchbox,\n        ytd-browse[page-subtype='history'] #secondary ytd-searchbox,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary ytd-searchbox {\n          box-sizing: border-box !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          min-width: 0 !important;\n          font-size: 16px !important;\n        }\n\n        /* Center History filter chiplets. */\n        ytd-browse[page-subtype='history'] yt-chip-cloud-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-chip-cloud-renderer,\n        ytd-browse[page-subtype='history'] ytd-feed-filter-chip-bar-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          ytd-feed-filter-chip-bar-renderer,\n        ytd-browse[page-subtype='history'] #chips,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #chips,\n        ytd-browse[page-subtype='history'] #chips-wrapper,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #chips-wrapper,\n        ytd-browse[page-subtype='history'] iron-selector#chips,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] iron-selector#chips {\n          box-sizing: border-box !important;\n          display: flex !important;\n          flex-wrap: wrap !important;\n          justify-content: center !important;\n          align-items: center !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          margin: 0 auto 8px !important;\n          padding: 0 !important;\n          text-align: center !important;\n        }\n\n        ytd-browse[page-subtype='history'] yt-chip-cloud-chip-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-chip-cloud-chip-renderer,\n        ytd-browse[page-subtype='history'] yt-chip-cloud-chip-renderer chip-shape,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          yt-chip-cloud-chip-renderer chip-shape {\n          margin-left: 4px !important;\n          margin-right: 4px !important;\n        }\n\n        ytd-browse[page-subtype='history'] ytd-rich-grid-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-rich-grid-renderer {\n          --ytd-rich-grid-items-per-row: 1 !important;\n          --ytd-rich-grid-posts-per-row: 1 !important;\n        }\n\n        ytd-browse[page-subtype='history'] ytd-video-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-video-renderer,\n        ytd-browse[page-subtype='history'] ytd-rich-item-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-rich-item-renderer,\n        ytd-browse[page-subtype='history'] ytd-grid-video-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-grid-video-renderer {\n          box-sizing: border-box !important;\n          display: block !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin: 0 auto 12px !important;\n          padding: 0 !important;\n          text-align: center !important;\n        }\n\n        /* Classic History rows: stack thumbnail above title. */\n        ytd-browse[page-subtype='history'] ytd-video-renderer #dismissible,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          ytd-video-renderer #dismissible {\n          display: flex !important;\n          flex-direction: column !important;\n          align-items: stretch !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n        }\n\n        /*\n         * Modern History lockups use a multi-column CSS grid (thumb | title).\n         * flex-direction on the custom element alone does nothing \u2014 collapse\n         * the grid to one column and cap the content-image width.\n         */\n        ytd-browse[page-subtype='history'] yt-lockup-view-model,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-lockup-view-model,\n        ytd-browse[page-subtype='history']\n          :is(\n            .yt-lockup-view-model,\n            .ytLockupViewModelHost,\n            .ytLockupViewModelVertical\n          ),\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          :is(\n            .yt-lockup-view-model,\n            .ytLockupViewModelHost,\n            .ytLockupViewModelVertical\n          ) {\n          box-sizing: border-box !important;\n          display: grid !important;\n          grid-template-columns: minmax(0, 1fr) !important;\n          grid-template-rows: auto !important;\n          grid-auto-flow: row !important;\n          align-items: stretch !important;\n          justify-items: stretch !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin: 0 auto 12px !important;\n          column-gap: 0 !important;\n          row-gap: 8px !important;\n          text-align: center !important;\n        }\n\n        /* Inner host div (when lockup wraps one) \u2014 same single-column stack. */\n        ytd-browse[page-subtype='history'] yt-lockup-view-model > div,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-lockup-view-model > div {\n          box-sizing: border-box !important;\n          display: grid !important;\n          grid-template-columns: minmax(0, 1fr) !important;\n          grid-auto-flow: row !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin: 0 !important;\n          column-gap: 0 !important;\n          row-gap: 8px !important;\n        }\n\n        ytd-browse[page-subtype='history'] ytd-thumbnail,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-thumbnail,\n        ytd-browse[page-subtype='history'] a#thumbnail,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] a#thumbnail,\n        ytd-browse[page-subtype='history'] yt-thumbnail-view-model,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-thumbnail-view-model,\n        ytd-browse[page-subtype='history']\n          yt-lockup-view-model a[href*='/watch'],\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          yt-lockup-view-model a[href*='/watch'],\n        ytd-browse[page-subtype='history']\n          :is(\n            .yt-lockup-view-model__content-image,\n            .ytLockupViewModelContentImage\n          ),\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          :is(\n            .yt-lockup-view-model__content-image,\n            .ytLockupViewModelContentImage\n          ) {\n          box-sizing: border-box !important;\n          display: block !important;\n          grid-column: 1 !important;\n          grid-row: auto !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin: 0 auto !important;\n          aspect-ratio: 16 / 9 !important;\n          height: auto !important;\n          overflow: hidden !important;\n          flex: none !important;\n        }\n\n        ytd-browse[page-subtype='history'] ytd-thumbnail img,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-thumbnail img,\n        ytd-browse[page-subtype='history']\n          yt-lockup-view-model a[href*='/watch'] img,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          yt-lockup-view-model a[href*='/watch'] img,\n        ytd-browse[page-subtype='history']\n          :is(\n            .yt-lockup-view-model__content-image,\n            .ytLockupViewModelContentImage\n          )\n          img,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          :is(\n            .yt-lockup-view-model__content-image,\n            .ytLockupViewModelContentImage\n          )\n          img {\n          box-sizing: border-box !important;\n          display: block !important;\n          width: 100% !important;\n          max-width: 100% !important;\n          height: 100% !important;\n          object-fit: cover !important;\n        }\n\n        ytd-browse[page-subtype='history'] #details,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #details,\n        ytd-browse[page-subtype='history'] #meta,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #meta,\n        ytd-browse[page-subtype='history']\n          yt-lockup-metadata-view-model,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          yt-lockup-metadata-view-model,\n        ytd-browse[page-subtype='history']\n          :is(\n            .yt-lockup-view-model__metadata,\n            .ytLockupViewModelMetadata\n          ),\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          :is(\n            .yt-lockup-view-model__metadata,\n            .ytLockupViewModelMetadata\n          ),\n        ytd-browse[page-subtype='history'] h3,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] h3,\n        ytd-browse[page-subtype='history'] #video-title,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #video-title,\n        ytd-browse[page-subtype='history'] a#video-title,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] a#video-title {\n          box-sizing: border-box !important;\n          display: block !important;\n          grid-column: 1 !important;\n          grid-row: auto !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n          margin-left: auto !important;\n          margin-right: auto !important;\n          overflow: visible !important;\n          text-align: center !important;\n          text-overflow: unset !important;\n          white-space: normal !important;\n          -webkit-line-clamp: unset !important;\n        }\n\n        /* Restore channel logo + center it with the channel name. */\n        ytd-browse[page-subtype='history'] #channel-info,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #channel-info,\n        ytd-browse[page-subtype='history'] #channel-name,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #channel-name {\n          box-sizing: border-box !important;\n          display: inline-flex !important;\n          visibility: visible !important;\n          flex-direction: row !important;\n          flex-wrap: wrap !important;\n          align-items: center !important;\n          justify-content: center !important;\n          gap: 8px !important;\n          width: auto !important;\n          max-width: 100% !important;\n          margin: 4px auto 0 !important;\n          text-align: center !important;\n        }\n\n        ytd-browse[page-subtype='history'] #avatar-link,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #avatar-link,\n        ytd-browse[page-subtype='history'] yt-img-shadow#avatar,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-img-shadow#avatar,\n        ytd-browse[page-subtype='history'] yt-decorated-avatar-view-model,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          yt-decorated-avatar-view-model,\n        ytd-browse[page-subtype='history']\n          a[href^='/@'] yt-img-shadow,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          a[href^='/@'] yt-img-shadow,\n        ytd-browse[page-subtype='history']\n          a[href*='/channel/'] yt-img-shadow,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          a[href*='/channel/'] yt-img-shadow {\n          display: inline-flex !important;\n          visibility: visible !important;\n          opacity: 1 !important;\n          width: 36px !important;\n          min-width: 36px !important;\n          max-width: 36px !important;\n          height: 36px !important;\n          margin: 0 !important;\n          overflow: hidden !important;\n          border-radius: 50% !important;\n        }\n\n        ytd-browse[page-subtype='history'] #avatar-link img,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] #avatar-link img,\n        ytd-browse[page-subtype='history'] yt-img-shadow#avatar img,\n        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-img-shadow#avatar img,\n        ytd-browse[page-subtype='history']\n          yt-decorated-avatar-view-model img,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          yt-decorated-avatar-view-model img {\n          display: block !important;\n          visibility: visible !important;\n          width: 36px !important;\n          height: 36px !important;\n          object-fit: cover !important;\n        }\n\n        ytd-browse[page-subtype='history']\n          ytd-item-section-header-renderer,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          ytd-item-section-header-renderer,\n        ytd-browse[page-subtype='history']\n          ytd-item-section-header-renderer #title,\n        ytd-browse[${HISTORY_FEED_ATTR}='history']\n          ytd-item-section-header-renderer #title {\n          width: 100% !important;\n          max-width: 100% !important;\n          margin-left: auto !important;\n          margin-right: auto !important;\n          text-align: center !important;\n        }\n\n        /*\n         * 2.2.1: restore 2.1.2-style native masthead search. Keep the desktop\n         * search form, but present it as a phone-width overlay after the\n         * search icon is tapped. 16px input prevents WebKit keyboard zoom.\n         * Ask/voice/AI clutter stays hidden (critical style + below).\n         *\n         * 3.1.0 (iPhone 16): do not set width:auto on the overlay. WebKit\n         * shrink-to-fit then sizes #center to the collapsed search icon, so\n         * the field becomes a small block on the left and two search buttons\n         * show (header icon + form submit). Pin a viewport width, stretch\n         * yt-searchbox internals, and hide the header search icon while open.\n         */\n        ytd-masthead,\n        ytd-masthead #container,\n        ytd-masthead #start,\n        ytd-masthead #center,\n        ytd-masthead #end {\n          box-sizing: border-box !important;\n          min-width: 0 !important;\n          max-width: 100% !important;\n        }\n\n        ytd-masthead #voice-search-button,\n        ytd-masthead button[aria-label*='Search with your voice' i],\n        ytd-masthead button[aria-label*='Voice search' i],\n        ytd-masthead [aria-label*='Ask YouTube' i],\n        ytd-masthead [aria-label*='Ask Gemini' i],\n        #voice-search-button,\n        button[aria-label*='Search with your voice' i],\n        button[aria-label*='Voice search' i],\n        [aria-label*='Ask YouTube' i],\n        [aria-label*='Ask Gemini' i] {\n          display: none !important;\n          visibility: hidden !important;\n          pointer-events: none !important;\n        }\n\n        /* Mobile Search overlay */\n        #fyp-search-backdrop {\n          display: none;\n        }\n\n        body[data-fyp-search-active='true'] #fyp-search-backdrop,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ~ #fyp-search-backdrop {\n          display: block !important;\n          position: fixed !important;\n          top: 0 !important;\n          left: 0 !important;\n          right: 0 !important;\n          bottom: 0 !important;\n          width: 100vw !important;\n          height: 100vh !important;\n          z-index: 2147483645 !important;\n          background: rgba(0, 0, 0, .4) !important;\n          backdrop-filter: blur(2px) !important;\n          -webkit-backdrop-filter: blur(2px) !important;\n        }\n\n        html[data-fyp-search-active='true'] #start,\n        html[data-fyp-search-active='true'] #guide-button,\n        html[data-fyp-search-active='true'] #guide-button-icon,\n        html[data-fyp-search-active='true'] button[aria-label='Guide'],\n        html[data-fyp-search-active='true'] ytd-masthead #guide-button,\n        html[data-fyp-search-active='true'] ytd-masthead button[aria-label='Guide'],\n        html[data-fyp-search-active='true'] tp-yt-app-drawer#guide,\n        html[data-fyp-search-active='true'] #guide,\n        html[data-fyp-search-active='true'] ytd-mini-guide-renderer,\n        body[data-fyp-search-active='true'] #start,\n        body[data-fyp-search-active='true'] #guide-button,\n        body[data-fyp-search-active='true'] #guide-button-icon,\n        body[data-fyp-search-active='true'] button[aria-label='Guide'],\n        body[data-fyp-search-active='true'] ytd-masthead #guide-button,\n        body[data-fyp-search-active='true'] ytd-masthead button[aria-label='Guide'],\n        body[data-fyp-search-active='true'] tp-yt-app-drawer#guide,\n        body[data-fyp-search-active='true'] #guide,\n        body[data-fyp-search-active='true'] ytd-mini-guide-renderer,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #start,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #guide-button,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #guide-button-icon,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] button[aria-label='Guide'],\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] yt-icon-button#guide-button,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ~ #guide,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ~ tp-yt-app-drawer#guide,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ~ ytd-mini-guide-renderer {\n          display: none !important;\n          visibility: hidden !important;\n          opacity: 0 !important;\n          pointer-events: none !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center {\n          position: fixed !important;\n          top: calc(env(safe-area-inset-top, 0px) + 6px) !important;\n          right: 12px !important;\n          left: 12px !important;\n          z-index: 2147483646 !important;\n          box-sizing: border-box !important;\n          display: flex !important;\n          flex-direction: row !important;\n          flex-wrap: nowrap !important;\n          width: calc(100vw - 24px) !important;\n          min-width: calc(100vw - 24px) !important;\n          max-width: calc(100vw - 24px) !important;\n          height: 48px !important;\n          margin: 0 !important;\n          padding: 4px 6px !important;\n          align-items: center !important;\n          color: var(--yt-spec-text-primary, #0f0f0f) !important;\n          background: var(--yt-spec-base-background, #fff) !important;\n          border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .15)) !important;\n          border-radius: 24px !important;\n          box-shadow: 0 4px 20px rgba(0, 0, 0, .2) !important;\n          overflow: visible !important;\n        }\n\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center,\n        html[dark-theme] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center,\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center {\n          color: #f1f1f1 !important;\n          background: #212121 !important;\n          border: 1px solid rgba(255, 255, 255, .22) !important;\n          box-shadow: 0 4px 20px rgba(0, 0, 0, .5) !important;\n        }\n\n        #fyp-search-back-button,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #fyp-search-back-button {\n          display: none !important;\n          visibility: hidden !important;\n          pointer-events: none !important;\n          width: 0 !important;\n          height: 0 !important;\n          margin: 0 !important;\n          padding: 0 !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end #search-button,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end #search-button-narrow,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end #search-icon-legacy,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end button[aria-label='Search'],\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end [role='button'][aria-label='Search'],\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #end yt-icon-button[aria-label='Search'] {\n          display: none !important;\n          visibility: hidden !important;\n          pointer-events: none !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ytd-searchbox,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] yt-searchbox,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentHost {\n          box-sizing: border-box !important;\n          display: flex !important;\n          flex: 1 1 auto !important;\n          min-width: 0 !important;\n          height: 100% !important;\n          margin: 0 !important;\n          padding: 0 !important;\n          align-items: center !important;\n          position: relative !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #search-form,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center form,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentSearchForm {\n          box-sizing: border-box !important;\n          display: flex !important;\n          flex: 1 1 auto !important;\n          flex-direction: row !important;\n          flex-wrap: nowrap !important;\n          min-width: 0 !important;\n          width: 100% !important;\n          height: 100% !important;\n          margin: 0 !important;\n          padding: 0 !important;\n          align-items: center !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #container,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #search-input,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentInputBox {\n          box-sizing: border-box !important;\n          display: flex !important;\n          flex: 1 1 auto !important;\n          flex-direction: row !important;\n          flex-wrap: nowrap !important;\n          min-width: 0 !important;\n          width: auto !important;\n          max-width: none !important;\n          height: 38px !important;\n          margin: 0 !important;\n          padding: 0 4px 0 14px !important;\n          align-items: center !important;\n          background: transparent !important;\n          border: none !important;\n          box-shadow: none !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center\n          .ytSearchboxComponentInnerSearchIcon,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center\n          #search-icon:not(#search-icon-legacy) {\n          display: none !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input#search,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input[name='search_query'],\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .yt-searchbox-input,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentInput {\n          box-sizing: border-box !important;\n          display: block !important;\n          flex: 1 1 auto !important;\n          width: 100% !important;\n          min-width: 0 !important;\n          height: 38px !important;\n          padding: 0 4px !important;\n          margin: 0 !important;\n          color: var(--yt-spec-text-primary, #0f0f0f) !important;\n          background: transparent !important;\n          border: none !important;\n          outline: none !important;\n          box-shadow: none !important;\n          font-size: 16px !important;\n          line-height: 38px !important;\n          opacity: 1 !important;\n          visibility: visible !important;\n          -webkit-appearance: none !important;\n        }\n\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input#search,\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input[name='search_query'],\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .yt-searchbox-input,\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentInput,\n        html[dark-theme] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input#search,\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input#search,\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input[name='search_query'],\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .yt-searchbox-input,\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentInput {\n          color: #fff !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input::placeholder {\n          color: var(--yt-spec-text-secondary, #717171) !important;\n          opacity: 1 !important;\n        }\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input::placeholder,\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input::placeholder {\n          color: #aaa !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentSearchButton {\n          box-sizing: border-box !important;\n          display: flex !important;\n          align-items: center !important;\n          justify-content: center !important;\n          flex: 0 0 38px !important;\n          width: 38px !important;\n          height: 38px !important;\n          min-width: 38px !important;\n          margin: 0 !important;\n          padding: 6px !important;\n          background: transparent !important;\n          border: none !important;\n          border-radius: 50% !important;\n          color: var(--yt-spec-text-primary, #0f0f0f) !important;\n          cursor: pointer !important;\n          visibility: visible !important;\n          opacity: 1 !important;\n          pointer-events: auto !important;\n        }\n\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy,\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentSearchButton,\n        html[dark-theme] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy,\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy {\n          color: #fff !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy yt-icon,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentSearchButton yt-icon,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #search-icon-legacy svg,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentSearchButton svg {\n          width: 22px !important;\n          height: 22px !important;\n          color: inherit !important;\n          fill: currentColor !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #clear-button,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentClearButton {\n          box-sizing: border-box !important;\n          display: flex !important;\n          align-items: center !important;\n          justify-content: center !important;\n          flex: 0 0 32px !important;\n          width: 32px !important;\n          height: 32px !important;\n          min-width: 32px !important;\n          margin: 0 !important;\n          padding: 4px !important;\n          background: transparent !important;\n          border: none !important;\n          cursor: pointer !important;\n          color: var(--yt-spec-text-secondary, #606060) !important;\n        }\n\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #clear-button,\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center .ytSearchboxComponentClearButton,\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center #clear-button {\n          color: #aaa !important;\n        }\n\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentSuggestionsContainer,\n        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .sbsb_a,\n        .sbdd_a {\n          position: fixed !important;\n          top: calc(env(safe-area-inset-top, 0px) + 56px) !important;\n          left: 12px !important;\n          right: 12px !important;\n          width: calc(100vw - 24px) !important;\n          max-width: calc(100vw - 24px) !important;\n          max-height: calc(100vh - env(safe-area-inset-top, 0px) - 120px) !important;\n          overflow-y: auto !important;\n          -webkit-overflow-scrolling: touch !important;\n          z-index: 2147483647 !important;\n          background: var(--yt-spec-base-background, #fff) !important;\n          border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .15)) !important;\n          border-radius: 16px !important;\n          box-shadow: 0 8px 24px rgba(0, 0, 0, .25) !important;\n        }\n\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentSuggestionsContainer,\n        html[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .sbsb_a,\n        html[dark] .sbdd_a,\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .ytSearchboxComponentSuggestionsContainer,\n        ytd-app[dark] ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .sbsb_a,\n        ytd-app[dark] .sbdd_a {\n          background: #212121 !important;\n          border: 1px solid rgba(255, 255, 255, .2) !important;\n          box-shadow: 0 8px 24px rgba(0, 0, 0, .5) !important;\n        }\n\n      }\n\n      ytd-comment-simplebox-renderer #placeholder-area,\n      ytd-comment-simplebox-renderer #simplebox-placeholder {\n        box-sizing: border-box;\n        min-height: 44px;\n        padding: clamp(.7rem, 3vw, 1rem) !important;\n        touch-action: manipulation;\n      }\n\n      ytd-commentbox textarea,\n      ytd-commentbox input,\n      ytd-commentbox #contenteditable-root,\n      ytd-commentbox [contenteditable='true'],\n      ytd-comment-replies-renderer textarea,\n      ytd-comment-replies-renderer input,\n      ytd-comment-replies-renderer #contenteditable-root,\n      ytd-comment-replies-renderer [contenteditable='true'] {\n        font-size: 16px !important;\n      }\n\n      ytd-comments#comments,\n      ytd-comments {\n        width: 100% !important;\n        max-width: 100% !important;\n        margin: clamp(.35rem, 1.5vw, .75rem) 0 0 !important;\n        order: 4 !important;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} {\n        box-sizing: border-box;\n        position: relative;\n        z-index: 100;\n        display: flex !important;\n        visibility: visible !important;\n        opacity: 1 !important;\n        pointer-events: auto !important;\n        isolation: isolate;\n        flex-wrap: wrap;\n        float: none !important;\n        clear: both !important;\n        width: 100% !important;\n        max-width: 100% !important;\n        min-width: 0;\n        min-height: 4rem;\n        margin: clamp(.25rem, 1.2vw, .45rem) 0 clamp(.5rem, 2.4vw, .8rem) !important;\n        padding: clamp(.45rem, 2vw, .7rem);\n        gap: clamp(.65rem, 3vw, 1rem);\n        justify-content: center;\n        align-items: center;\n        color: var(--yt-spec-text-primary, #0f0f0f);\n        border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .12));\n        border-radius: clamp(.85rem, 4vw, 1.2rem);\n        background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, .06));\n        backdrop-filter: blur(12px);\n        -webkit-backdrop-filter: blur(12px);\n        overflow: visible;\n      }\n\n      html[dark] #${PLAYER_CONTROLS_TOOLBAR_ID},\n      html[dark-theme] #${PLAYER_CONTROLS_TOOLBAR_ID},\n      ytd-app[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} {\n        color: #fff;\n        border: 1px solid rgba(255, 255, 255, .14);\n        background: rgba(255, 255, 255, .08);\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control {\n        appearance: none;\n        box-sizing: border-box;\n        display: inline-flex !important;\n        visibility: visible !important;\n        opacity: 1 !important;\n        flex: 0 0 auto;\n        width: clamp(3rem, 14vw, 3.75rem);\n        min-width: 3rem;\n        height: clamp(3rem, 13vw, 3.5rem);\n        margin: 0;\n        padding: 0;\n        align-items: center;\n        justify-content: center;\n        color: currentColor;\n        background: transparent !important;\n        border: 0 !important;\n        border-radius: 0;\n        cursor: pointer;\n        touch-action: manipulation;\n        -webkit-tap-highlight-color: transparent;\n      }\n\n      html[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control,\n      html[dark-theme] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control,\n      ytd-app[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control {\n        color: #fff;\n        background: transparent !important;\n        border: 0 !important;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID}\n        .fyp-player-control[data-fyp-player-action='play-pause'] {\n        color: currentColor;\n        background: transparent !important;\n        border: 0 !important;\n      }\n\n      html[dark] #${PLAYER_CONTROLS_TOOLBAR_ID}\n        .fyp-player-control[data-fyp-player-action='play-pause'],\n      html[dark-theme] #${PLAYER_CONTROLS_TOOLBAR_ID}\n        .fyp-player-control[data-fyp-player-action='play-pause'],\n      ytd-app[dark] #${PLAYER_CONTROLS_TOOLBAR_ID}\n        .fyp-player-control[data-fyp-player-action='play-pause'] {\n        color: currentColor;\n        background: transparent !important;\n        border: 0 !important;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID}\n        .fyp-player-control[aria-pressed='true']:not(\n          [data-fyp-player-action='play-pause']\n      ) {\n        color: currentColor;\n        background: transparent !important;\n        border: 0 !important;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:active {\n        transform: scale(.92);\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:focus-visible {\n        outline: 2px solid var(--yt-spec-text-primary, #0f0f0f);\n        outline-offset: 2px;\n      }\n\n      html[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:focus-visible,\n      html[dark-theme] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:focus-visible,\n      ytd-app[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:focus-visible {\n        outline-color: #fff;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg {\n        display: block !important;\n        flex: 0 0 auto;\n        width: clamp(1.5rem, 7vw, 1.9rem) !important;\n        height: clamp(1.5rem, 7vw, 1.9rem) !important;\n        max-width: none;\n        max-height: none;\n        overflow: visible;\n        color: currentColor;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID}\n        .fyp-player-control[data-fyp-player-action='play-pause'] svg {\n        fill: currentColor;\n        stroke: none;\n      }\n\n      /* Native settings gear stays available; overflow/more clutter stays hidden. */\n      #movie_player .ytp-overflow-button,\n      .html5-video-player .ytp-overflow-button,\n      #movie_player .ytp-more-button,\n      .html5-video-player .ytp-more-button {\n        display: none !important;\n      }\n\n      #movie_player .ytp-settings-button,\n      .html5-video-player .ytp-settings-button {\n        display: inline-flex !important;\n        visibility: visible !important;\n        opacity: 1 !important;\n        pointer-events: auto !important;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu {\n        box-sizing: border-box;\n        flex: 1 0 100%;\n        display: flex;\n        flex-direction: column;\n        width: min(100vw - 24px, 22rem);\n        min-width: 0;\n        max-height: min(42svh, 18rem);\n        margin-top: clamp(.15rem, .8vw, .3rem);\n        padding: clamp(.4rem, 2vw, .65rem);\n        gap: clamp(.25rem, 1vw, .4rem);\n        color: var(--yt-spec-text-primary, #0f0f0f);\n        background: var(--yt-spec-menu-background, rgba(255, 255, 255, .98));\n        border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .12));\n        border-radius: clamp(.75rem, 3vw, 1rem);\n        box-shadow: 0 .75rem 2rem rgba(0, 0, 0, .18);\n        overflow-x: hidden;\n        overflow-y: auto;\n        -webkit-overflow-scrolling: touch;\n        overscroll-behavior: contain;\n        touch-action: pan-y;\n      }\n\n      html[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu,\n      html[dark-theme] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu,\n      ytd-app[dark] #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu {\n        color: #fff;\n        background: rgba(15, 15, 15, .97);\n        border: 1px solid rgba(255, 255, 255, .16);\n        box-shadow: 0 .75rem 2rem rgba(0, 0, 0, .45);\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-collapse {\n        appearance: none;\n        box-sizing: border-box;\n        align-self: center;\n        display: inline-flex;\n        align-items: center;\n        justify-content: center;\n        width: clamp(2.6rem, 12vw, 3.1rem);\n        min-height: clamp(1.7rem, 7vw, 2rem);\n        margin: 0;\n        padding: 0;\n        color: rgba(255, 255, 255, .88);\n        background: rgba(255, 255, 255, .08);\n        border: 1px solid rgba(255, 255, 255, .14);\n        border-radius: 999px;\n        touch-action: manipulation;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-collapse svg {\n        display: block;\n        width: clamp(1.05rem, 4.5vw, 1.25rem);\n        height: clamp(1.05rem, 4.5vw, 1.25rem);\n        fill: none;\n        stroke: currentColor;\n        stroke-width: 2;\n        stroke-linecap: round;\n        stroke-linejoin: round;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-title {\n        padding: clamp(.25rem, 1vw, .4rem) clamp(.7rem, 3vw, .95rem);\n        color: rgba(255, 255, 255, .72);\n        font: 700 clamp(.78rem, 3.2vw, .9rem)/1.2 Roboto, Arial, sans-serif;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option {\n        appearance: none;\n        box-sizing: border-box;\n        width: 100%;\n        min-height: clamp(2.45rem, 10vw, 2.9rem);\n        margin: 0;\n        padding: 0 clamp(.75rem, 3vw, 1rem);\n        color: #fff;\n        background: rgba(255, 255, 255, .09);\n        border: 1px solid transparent;\n        border-radius: clamp(.6rem, 2.5vw, .8rem);\n        text-align: left;\n        font: 600 clamp(.8rem, 3.4vw, .95rem)/1.25 Roboto, Arial, sans-serif;\n        touch-action: pan-y;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID}\n        .fyp-player-menu-option[aria-checked='true'] {\n        background: #ff0033;\n        border-color: #ff0033;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option:disabled {\n        opacity: .55;\n      }\n\n      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option:focus-visible {\n        outline: 2px solid #fff;\n        outline-offset: -2px;\n      }\n\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-bottom,\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-top,\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-bottom,\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-top {\n        visibility: visible !important;\n        opacity: 1 !important;\n        transform: translateY(0) !important;\n      }\n\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-bottom,\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-top {\n        pointer-events: auto !important;\n      }\n\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-bottom,\n      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-top {\n        pointer-events: none !important;\n      }\n\n      /*\n       * Orion/WebKit may render the native WebVTT cue at the same time as\n       * YouTube's custom caption DOM. Hide the native cue only while custom\n       * segments exist \u2014 never on CC-button alone \u2014 so a starved custom module\n       * cannot leave the screen with zero caption text.\n       */\n      .html5-video-player:has(\n        .ytp-caption-window-container .ytp-caption-segment\n      ) video::cue,\n      video[data-fyp-native-captions-hidden='true']::cue {\n        visibility: hidden !important;\n        opacity: 0 !important;\n        color: transparent !important;\n        background: transparent !important;\n        text-shadow: none !important;\n      }\n\n      .html5-video-player:has(\n        .ytp-caption-window-container .ytp-caption-segment\n      ) video::-webkit-media-text-track-container,\n      .html5-video-player:has(\n        .ytp-caption-window-container .ytp-caption-segment\n      ) video::-webkit-media-text-track-display,\n      video[data-fyp-native-captions-hidden='true']::-webkit-media-text-track-container,\n      video[data-fyp-native-captions-hidden='true']::-webkit-media-text-track-display {\n        display: none !important;\n        visibility: hidden !important;\n        opacity: 0 !important;\n      }\n\n      @media (hover: none) {\n        tp-yt-paper-tooltip,\n        yt-tooltip-renderer {\n          display: none !important;\n          pointer-events: none !important;\n        }\n      }\n\n      /* Floating pill removed \u2014 navigation is burger/guide only. */\n      #${NAV_ID} {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n      }\n\n      ytd-app,\n      ytm-app {\n        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 4.75rem) !important;\n      }\n\n      #${WELCOME_ID} {\n        box-sizing: border-box;\n        position: fixed;\n        top: calc(env(safe-area-inset-top, 0px) + clamp(3.5rem, 10svh, 5rem));\n        left: 50%;\n        z-index: 2147483647;\n        width: min(calc(100% - 2rem), 22rem);\n        padding: clamp(.75rem, 2.8vw, 1rem) clamp(1rem, 4vw, 1.35rem);\n        color: #fff;\n        background: rgba(15, 15, 15, .96);\n        border: 1px solid rgba(255, 255, 255, .18);\n        border-radius: clamp(.65rem, 3vw, 1rem);\n        box-shadow: 0 .5rem 1.5rem rgba(0, 0, 0, .28);\n        font: 600 clamp(.9rem, 3.8vw, 1.05rem)/1.3 Roboto, Arial, sans-serif;\n        text-align: center;\n        transform: translateX(-50%);\n        opacity: 1;\n        transition: opacity .22s ease, transform .22s ease;\n      }\n\n      #${WELCOME_ID}[data-hiding='true'] {\n        opacity: 0;\n        transform: translate(-50%, -.45rem);\n        pointer-events: none;\n      }\n\n      /* Only the action to subscribe is red; an already-subscribed button is untouched. */\n      button[data-vm-subscribe-action='true'],\n      [role='button'][data-vm-subscribe-action='true'] {\n        color: #fff !important;\n        background-color: #ff0033 !important;\n        background-image: none !important;\n        border-color: #ff0033 !important;\n        box-shadow: none !important;\n      }\n\n      [data-vm-subscribe-action='true'] .yt-spec-button-shape-next__button-text-content {\n        color: #fff !important;\n      }\n\n      .ytp-fullscreen-quick-actions button[aria-label^='Ask'],\n      #movie_player button[aria-label*='Ask Gemini'],\n      ytd-watch-metadata button[aria-label^='Ask'],\n      ytd-watch-metadata [title^='Ask Gemini'] {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n      }\n\n    `;\n  }\n\n  /* Lucide icon paths \u2014 Home, ListVideo, CircleUser. Shorts + Create omitted. */\n  const MOBILE_NAV_ITEMS = [\n    {\n      id: 'home',\n      label: 'Home',\n      href: '/',\n      active: (path) => path === '/' || path === '',\n      icon: '<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>',\n    },\n    {\n      id: 'subscriptions',\n      label: 'Subs',\n      href: '/feed/subscriptions',\n      active: (path) => path.startsWith('/feed/subscriptions'),\n      icon: '<path d=\"M12 12H3\"/><path d=\"M16 6H3\"/><path d=\"M12 18H3\"/><path d=\"m16 12 5 3-5 3v-6Z\"/>',\n    },\n    {\n      id: 'you',\n      label: 'You',\n      href: '/feed/you',\n      active: (path) =>\n        path.startsWith('/feed/you') ||\n        path.startsWith('/feed/library') ||\n        path.startsWith('/account'),\n      icon: '<circle cx=\"12\" cy=\"12\" r=\"10\"/><circle cx=\"12\" cy=\"10\" r=\"3\"/><path d=\"M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662\"/>',\n    },\n  ];\n\n  function setImportantStyles(element, declarations) {\n    if (!element) return;\n    for (const [property, value] of Object.entries(declarations)) {\n      element.style.setProperty(property, value, 'important');\n    }\n  }\n\n  function isDarkTheme() {\n    return Boolean(\n      document.documentElement.hasAttribute('dark') ||\n      document.documentElement.hasAttribute('dark-theme') ||\n      document.body?.hasAttribute('dark') ||\n      document.querySelector('ytd-app[dark], ytm-app[dark]') ||\n      window.matchMedia?.('(prefers-color-scheme: dark)').matches\n    );\n  }\n\n  function applyCriticalNavigationLayout(nav) {\n    const dark = isDarkTheme();\n    // Orion iOS: browser chrome is outside the webview \u2014 keep a tight safe-area gap.\n    const clearance = `calc(env(safe-area-inset-bottom, 0px) + ${ORION_NAV_GAP})`;\n    setImportantStyles(nav, {\n      'box-sizing': 'border-box',\n      position: 'fixed',\n      top: 'auto',\n      right: 'auto',\n      bottom: clearance,\n      left: '50%',\n      'z-index': '2147483646',\n      display: 'flex',\n      'flex-direction': 'row',\n      width: 'min(calc(100% - 28px), 352px)',\n      height: 'auto',\n      'min-height': '56px',\n      margin: '0',\n      'padding-top': '5px',\n      'padding-right': '6px',\n      'padding-bottom': '5px',\n      'padding-left': '6px',\n      'align-items': 'stretch',\n      'justify-content': 'space-around',\n      gap: '2px',\n      color: dark ? '#f1f1f1' : '#0f0f0f',\n      background: dark ? 'rgba(28, 28, 28, .9)' : 'rgba(255, 255, 255, .9)',\n      border: dark\n        ? '1px solid rgba(255, 255, 255, .12)'\n        : '1px solid rgba(0, 0, 0, .1)',\n      'border-radius': '999px',\n      'box-shadow': dark\n        ? '0 6px 22px rgba(0, 0, 0, .45)'\n        : '0 6px 20px rgba(0, 0, 0, .18)',\n      'font-family': '\"SF Pro Text\", Roboto, system-ui, sans-serif',\n      overflow: 'hidden',\n      'pointer-events': 'auto',\n      transform: 'translate3d(-50%, 0, 0)',\n      '-webkit-transform': 'translate3d(-50%, 0, 0)',\n      '-webkit-backdrop-filter': 'saturate(1.4) blur(18px)',\n      'backdrop-filter': 'saturate(1.4) blur(18px)',\n      '-webkit-user-select': 'none',\n      'user-select': 'none',\n    });\n\n    for (const link of nav.querySelectorAll('.vm-yt-nav-item')) {\n      setImportantStyles(link, {\n        'box-sizing': 'border-box',\n        display: 'flex',\n        flex: '1 1 33%',\n        'flex-direction': 'column',\n        'min-width': '0',\n        'min-height': '48px',\n        margin: '0',\n        padding: '4px 2px',\n        'align-items': 'center',\n        'justify-content': 'center',\n        gap: '3px',\n        background: 'transparent',\n        border: '0',\n        'border-radius': '999px',\n        'text-decoration': 'none',\n        cursor: 'pointer',\n      });\n\n      const iconWrap = link.querySelector('.vm-yt-nav-icon-wrap');\n      if (iconWrap) {\n        setImportantStyles(iconWrap, {\n          display: 'flex',\n          width: 'auto',\n          height: 'auto',\n          'align-items': 'center',\n          'justify-content': 'center',\n          color: 'inherit',\n          background: 'transparent',\n          'border-radius': '999px',\n        });\n      }\n\n      setImportantStyles(link.querySelector('.vm-yt-nav-icon'), {\n        display: 'block',\n        width: '22px',\n        height: '22px',\n        flex: '0 0 auto',\n        fill: 'none',\n        stroke: 'currentColor',\n        'stroke-linecap': 'round',\n        'stroke-linejoin': 'round',\n        'stroke-width': '2',\n      });\n\n      const label = link.querySelector('.vm-yt-nav-label');\n      if (label) {\n        setImportantStyles(label, {\n          display: 'block',\n          'max-width': '100%',\n          overflow: 'hidden',\n          'font-size': '10px',\n          'font-weight': '500',\n          'line-height': '1.1',\n          'text-overflow': 'ellipsis',\n          'white-space': 'nowrap',\n        });\n      }\n    }\n\n    for (const app of document.querySelectorAll('ytd-app, ytm-app')) {\n      setImportantStyles(app, {\n        width: '100%',\n        'min-width': '0',\n        'padding-bottom': `calc(${clearance} + 64px)`,\n      });\n    }\n  }\n\n  function hideShortsGuideEntries(root = document) {\n    const entrySelector =\n      'ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ytm-pivot-bar-item-renderer, ' +\n      'tp-yt-paper-item, yt-list-item-view-model';\n    const entries = [];\n    if (root instanceof Element && root.matches(entrySelector)) entries.push(root);\n    entries.push(...(root.querySelectorAll?.(entrySelector) || []));\n\n    for (const entry of entries) {\n      const href = [\n        entry.querySelector?.('a#endpoint')?.getAttribute('href'),\n        entry.querySelector?.('a')?.getAttribute('href'),\n        entry.getAttribute?.('href'),\n      ]\n        .filter(Boolean)\n        .join(' ');\n      const label = [\n        entry.getAttribute?.('title'),\n        entry.querySelector?.('[title]')?.getAttribute('title'),\n        entry.querySelector?.('a#endpoint')?.getAttribute('title'),\n        entry.querySelector?.('yt-formatted-string')?.textContent,\n        entry.querySelector?.('.title')?.textContent,\n        entry.getAttribute?.('aria-label'),\n        entry.querySelector?.('[aria-label]')?.getAttribute('aria-label'),\n        entry.textContent,\n      ]\n        .filter(Boolean)\n        .join(' ')\n        .replace(/\\s+/g, ' ')\n        .trim();\n\n      const isShorts =\n        /\\/shorts\\b|\\/playables\\b/i.test(href) ||\n        /^(shorts|playables)\\b/i.test(label) ||\n        (/(\\bshorts\\b|\\bplayables\\b|mini[\\s-]?games)/i.test(label) && label.length < 48) ||\n        /tab_shorts|shorts_fill|shorts_outline/i.test(\n          entry.innerHTML?.slice?.(0, 500) || ''\n        );\n\n      if (!isShorts) continue;\n\n      setImportantStyles(entry, {\n        display: 'none',\n        visibility: 'hidden',\n        'pointer-events': 'none',\n        height: '0',\n        margin: '0',\n        padding: '0',\n        overflow: 'hidden',\n      });\n      entry.setAttribute('aria-hidden', 'true');\n      entry.hidden = true;\n      entry.dataset.vmShortsHidden = 'true';\n    }\n  }\n\n  function isShortsOrPlayablesHref(href) {\n    return /(?:^|\\/)(?:shorts|playables)(?:\\/|$|\\?)/i.test(String(href || ''));\n  }\n\n  function concealShortsElement(element) {\n    if (!(element instanceof Element)) return;\n    if (element.dataset.fypShortsHidden === 'true') return;\n    setImportantStyles(element, {\n      display: 'none',\n      visibility: 'hidden',\n      'pointer-events': 'none',\n      height: '0',\n      margin: '0',\n      padding: '0',\n      overflow: 'hidden',\n    });\n    element.setAttribute('aria-hidden', 'true');\n    element.hidden = true;\n    element.dataset.fypShortsHidden = 'true';\n  }\n\n  function removeShortsAndPlayables(root = document) {\n    const candidates = new Set();\n    const collect = (node) => {\n      if (!(node instanceof Element)) return;\n      if (node.matches(SHORTS_REMOVAL_SELECTOR)) candidates.add(node);\n      node.querySelectorAll?.(SHORTS_REMOVAL_SELECTOR).forEach((element) => {\n        candidates.add(element);\n      });\n\n      node.querySelectorAll?.(\n        'ytd-rich-shelf-renderer, ytd-rich-section-renderer, grid-shelf-view-model'\n      ).forEach((shelf) => {\n        const heading = (\n          shelf.querySelector?.(\n            '#title, #title-text, .title, yt-formatted-string, h2, [id*=\"title\"]'\n          )?.textContent || ''\n        ).trim();\n        const ariaLabel = shelf.getAttribute?.('aria-label') || '';\n        const hasShortsHref = [...(shelf.querySelectorAll?.('a[href]') || [])].some(\n          (link) => isShortsOrPlayablesHref(link.getAttribute('href') || link.href)\n        );\n        if (\n          hasShortsHref ||\n          /shorts|playables|mini[\\s-]?games/i.test(heading) ||\n          /shorts|playables|mini[\\s-]?games/i.test(ariaLabel)\n        ) {\n          candidates.add(shelf);\n        }\n      });\n    };\n\n    if (root instanceof Element) collect(root);\n    root.querySelectorAll?.(SHORTS_REMOVAL_SELECTOR).forEach((element) => {\n      candidates.add(element);\n    });\n    root.querySelectorAll?.(\n      'ytd-rich-shelf-renderer, ytd-rich-section-renderer, grid-shelf-view-model'\n    ).forEach((shelf) => collect(shelf));\n\n    for (const candidate of candidates) {\n      const item =\n        candidate.closest(SHORTS_REMOVAL_CONTAINER_SELECTOR) || candidate;\n      concealShortsElement(item);\n    }\n    hideShortsGuideEntries(root);\n  }\n\n  function installShortsRemovalListener() {\n    if (shortsRemovalObserver) return;\n\n    removeShortsAndPlayables(document);\n    shortsRemovalObserver = new MutationObserver((mutations) => {\n      const roots = new Set();\n      for (const mutation of mutations) {\n        if (mutation.target instanceof Element) roots.add(mutation.target);\n        for (const node of mutation.addedNodes) {\n          if (node instanceof Element) roots.add(node);\n        }\n      }\n      for (const root of roots) removeShortsAndPlayables(root);\n    });\n    shortsRemovalObserver.observe(document.documentElement || document, {\n      childList: true,\n      subtree: true,\n    });\n\n    const cleanShortsOnNavigation = () => removeShortsAndPlayables(document);\n    nativeDocumentAddEventListener(\n      'yt-navigate-start',\n      cleanShortsOnNavigation,\n      true\n    );\n    nativeDocumentAddEventListener(\n      'yt-navigate-finish',\n      cleanShortsOnNavigation,\n      true\n    );\n    nativeWindowAddEventListener('popstate', cleanShortsOnNavigation, true);\n    nativeWindowAddEventListener('pageshow', cleanShortsOnNavigation, true);\n  }\n\n  function hideNativeNavigationAndShorts() {\n    for (const element of document.querySelectorAll(\n      [\n        'ytm-pivot-bar-renderer',\n        'ytd-mini-guide-renderer',\n        'ytd-mini-guide-entry-renderer',\n        'ytd-reel-shelf-renderer',\n        'ytm-reel-shelf-renderer',\n        'ytm-shorts-lockup-view-model',\n        'ytm-shorts-lockup-view-model-v2',\n        'ytd-reel-item-renderer',\n        'ytm-reel-item-renderer',\n        'yt-playable-game-renderer',\n        'ytd-game-card-renderer',\n        'ytd-playable-renderer',\n        'ytd-playables-shelf-renderer',\n        'yt-playables-shelf-renderer',\n      ].join(',')\n    )) {\n      setImportantStyles(element, {\n        display: 'none',\n        visibility: 'hidden',\n        'pointer-events': 'none',\n      });\n      element.setAttribute('aria-hidden', 'true');\n      element.hidden = true;\n    }\n\n    for (const element of document.querySelectorAll(\n      'ytd-rich-shelf-renderer, ytd-rich-section-renderer, grid-shelf-view-model'\n    )) {\n      const titleText = (\n        element.querySelector?.('#title, .title, #title-text, yt-formatted-string, h2, [id*=\"title\"]')\n          ?.textContent || ''\n      ).trim();\n      const ariaLabel = element.getAttribute?.('aria-label') || '';\n      const isShortsShelf =\n        Boolean(element.querySelector?.('a[href*=\"/shorts\"], a[href*=\"/playables\"]')) ||\n        /shorts|playables|mini[\\s-]?games/i.test(titleText) ||\n        /shorts|playables|mini[\\s-]?games/i.test(ariaLabel);\n      if (!isShortsShelf) continue;\n      setImportantStyles(element, {\n        display: 'none',\n        visibility: 'hidden',\n        'pointer-events': 'none',\n        height: '0',\n        margin: '0',\n        padding: '0',\n        overflow: 'hidden',\n      });\n      element.setAttribute('aria-hidden', 'true');\n      element.hidden = true;\n      const section = element.closest('ytd-rich-section-renderer');\n      if (section && section !== element) {\n        setImportantStyles(section, {\n          display: 'none',\n          visibility: 'hidden',\n          'pointer-events': 'none',\n          height: '0',\n          margin: '0',\n          padding: '0',\n          overflow: 'hidden',\n        });\n        section.setAttribute('aria-hidden', 'true');\n        section.hidden = true;\n      }\n    }\n\n    const possibleShortsControls = document.querySelectorAll([\n      '.pivot-shorts',\n      'a[href^=\"/shorts\"]',\n      'a[href*=\"/shorts\"]',\n      'a[href*=\"youtube.com/shorts\"]',\n      'a[href^=\"/playables\"]',\n      'a[href*=\"/playables\"]',\n      'a[href*=\"youtube.com/playables\"]',\n      '[aria-label=\"Shorts\"]',\n      '[title=\"Shorts\"]',\n      '[aria-label*=\"Playables\" i]',\n      '[title*=\"Playables\" i]',\n      '[is-shorts]',\n      '[is-playables]',\n      '[is-playable]',\n    ].join(','));\n\n    for (const control of possibleShortsControls) {\n      const item =\n        control.closest(\n          'ytm-pivot-bar-item-renderer, ytd-guide-entry-renderer, ' +\n            'ytd-mini-guide-entry-renderer, yt-tab-shape, [role=\"tab\"], ' +\n            'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ' +\n            'ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-rich-section-renderer, ' +\n            'ytd-reel-item-renderer, ytm-reel-item-renderer, ' +\n            'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ' +\n            'yt-lockup-view-model, tp-yt-paper-item, grid-shelf-view-model'\n        ) || control;\n      setImportantStyles(item, {\n        display: 'none',\n        visibility: 'hidden',\n        'pointer-events': 'none',\n        height: '0',\n        margin: '0',\n        padding: '0',\n        overflow: 'hidden',\n      });\n      item.setAttribute('aria-hidden', 'true');\n      item.hidden = true;\n      const section = item.closest('ytd-rich-section-renderer');\n      if (section && section !== item) {\n        setImportantStyles(section, {\n          display: 'none',\n          visibility: 'hidden',\n          'pointer-events': 'none',\n          height: '0',\n          margin: '0',\n          padding: '0',\n          overflow: 'hidden',\n        });\n        section.setAttribute('aria-hidden', 'true');\n        section.hidden = true;\n      }\n    }\n\n    for (const chip of document.querySelectorAll('yt-chip-cloud-chip-renderer')) {\n      if (/playables|mini[\\s-]?games/i.test(chip.textContent.trim())) {\n        setImportantStyles(chip, {\n          display: 'none',\n          visibility: 'hidden',\n          'pointer-events': 'none',\n        });\n        chip.hidden = true;\n      }\n    }\n\n    hideShortsGuideEntries(document);\n    removeShortsAndPlayables(document);\n  }\n\n  function blockShortsNavigation(event) {\n    const target = event.target;\n    if (!(target instanceof Element)) return;\n    const link = target.closest('a[href]');\n    if (\n      !link ||\n      !isShortsOrPlayablesHref(link.getAttribute('href') || link.href)\n    ) {\n      return;\n    }\n    event.preventDefault();\n    event.stopImmediatePropagation();\n    location.assign(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);\n  }\n\n  function isSearchField(element) {\n    return (\n      (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement) ||\n      (typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement)\n    );\n  }\n\n  function findNativeSearchInput(masthead = document.querySelector('ytd-masthead')) {\n    const input = masthead?.querySelector(\n      'input#search, input[name=\"search_query\"], textarea[name=\"search_query\"], ' +\n        '.yt-searchbox-input, .ytSearchboxComponentInput'\n    );\n    return isSearchField(input) ? input : null;\n  }\n\n  function ensureMobileSearchElements() {\n    const existing = document.getElementById(SEARCH_OVERLAY_ID);\n    if (existing) return existing;\n\n    const host = document.body || document.documentElement;\n    if (!host) return null;\n\n    const overlay = document.createElement('div');\n    overlay.id = SEARCH_OVERLAY_ID;\n    overlay.hidden = true;\n    overlay.setAttribute('aria-hidden', 'true');\n    overlay.setAttribute('role', 'dialog');\n    overlay.setAttribute('aria-modal', 'true');\n\n    const dialog = document.createElement('div');\n    dialog.setAttribute('data-fyp-search-dialog', 'true');\n\n    const form = document.createElement('form');\n    form.id = SEARCH_OVERLAY_FORM_ID;\n    form.setAttribute('role', 'search');\n\n    const input = document.createElement('input');\n    input.id = SEARCH_OVERLAY_INPUT_ID;\n    input.type = 'search';\n    input.name = 'search_query';\n    input.autocomplete = 'off';\n    input.spellcheck = false;\n    input.placeholder = 'Search YouTube';\n    input.setAttribute('aria-label', 'Search YouTube');\n    input.setAttribute('enterkeyhint', 'search');\n\n    const submit = document.createElement('button');\n    submit.type = 'submit';\n    submit.className = 'fyp-search-submit';\n    submit.setAttribute('aria-label', 'Search');\n    submit.title = 'Search';\n    replaceIconContents(submit, SEARCH_BUTTON_ICON_MARKUP);\n\n    form.append(input, submit);\n    dialog.append(form);\n    overlay.append(dialog);\n    host.append(overlay);\n\n    const dismiss = (event) => {\n      if (event.target !== overlay) return;\n      event.preventDefault();\n      event.stopImmediatePropagation();\n      closeMobileSearch();\n    };\n    overlay.addEventListener('click', dismiss, true);\n    overlay.addEventListener('touchstart', dismiss, { capture: true, passive: false });\n    form.addEventListener(\n      'submit',\n      (event) => {\n        event.preventDefault();\n        event.stopPropagation();\n        submitMobileSearch(input.value);\n      },\n      true\n    );\n    input.addEventListener(\n      'keydown',\n      (event) => {\n        if (event.key !== 'Enter') return;\n        event.preventDefault();\n        event.stopPropagation();\n        submitMobileSearch(input.value);\n      },\n      true\n    );\n    return overlay;\n  }\n\n  function restoreSearchHiddenElements() {\n    for (const element of document.querySelectorAll(\n      '[data-fyp-search-inline-hidden=\"true\"]'\n    )) {\n      element.removeAttribute('data-fyp-search-inline-hidden');\n      element.removeAttribute('aria-hidden');\n      for (const property of [\n        'display',\n        'visibility',\n        'opacity',\n        'pointer-events',\n      ]) {\n        element.style.removeProperty(property);\n      }\n    }\n  }\n\n  function buildYouTubeSearchUrl(query) {\n    const url = new URL(`https://${BACKEND_HOST}/results`);\n    url.search = new URLSearchParams({ search_query: query }).toString();\n    return url.href;\n  }\n\n  function submitMobileSearch(rawQuery) {\n    const query = String(rawQuery || '').replace(/\\s+/g, ' ').trim();\n    const input = document.getElementById(SEARCH_OVERLAY_INPUT_ID);\n    if (!query) {\n      if (isSearchField(input)) input.focus();\n      return;\n    }\n    closeMobileSearch();\n    location.assign(buildYouTubeSearchUrl(query));\n  }\n\n  function closeMobileSearch() {\n    const masthead = document.querySelector('ytd-masthead');\n    if (masthead) {\n      masthead.removeAttribute(MOBILE_SEARCH_OPEN_ATTR);\n      masthead\n        .querySelectorAll(\n          '#search-button, #search-button-narrow, #search-icon-legacy, button[aria-label=\"Search\"], ' +\n            '[role=\"button\"][aria-label=\"Search\"], yt-icon-button[aria-label=\"Search\"]'\n        )\n        .forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));\n    }\n    document.documentElement?.removeAttribute('data-fyp-search-active');\n    document.body?.removeAttribute('data-fyp-search-active');\n\n    const overlay = document.getElementById(SEARCH_OVERLAY_ID);\n    if (overlay) {\n      overlay.hidden = true;\n      overlay.removeAttribute('data-open');\n      overlay.setAttribute('aria-hidden', 'true');\n      const input = overlay.querySelector(`#${SEARCH_OVERLAY_INPUT_ID}`);\n      if (isSearchField(input)) {\n        try { input.blur(); } catch {}\n      }\n    }\n    const nativeInput = findNativeSearchInput(masthead);\n    if (nativeInput) {\n      try { nativeInput.blur(); } catch {}\n    }\n    restoreSearchHiddenElements();\n    ensureGuideButtonVisible();\n  }\n\n  /*\n   * The YouTube masthead is only the trigger. FYP owns a separate, stable\n   * overlay so YouTube can switch between input and textarea implementations\n   * without breaking focus or submit behavior. Synchronous focus keeps the\n   * virtual keyboard eligible on iOS/WebKit.\n   */\n  function handleMobileSearchClick(event) {\n    const target = event.target;\n    if (!(target instanceof Element)) return;\n    if (target.closest(`#${SEARCH_OVERLAY_ID}`)) return;\n\n    const masthead = target.closest('ytd-masthead') || document.querySelector('ytd-masthead');\n    if (!masthead) return;\n\n    const alreadyOpen =\n      document.documentElement?.getAttribute('data-fyp-search-active') === 'true';\n    if (alreadyOpen) return;\n\n    const trigger = target.closest(MOBILE_SEARCH_TRIGGER_SELECTOR);\n    if (!trigger) return;\n\n    event.preventDefault();\n    event.stopImmediatePropagation();\n\n    // Close any open guide drawer so it never peeks/show through the overlay.\n    for (const drawer of document.querySelectorAll('tp-yt-app-drawer#guide, #guide')) {\n      if (typeof drawer.close === 'function') {\n        try { drawer.close(); } catch {}\n      }\n    }\n\n    const overlay = ensureMobileSearchElements();\n    const input = overlay?.querySelector(`#${SEARCH_OVERLAY_INPUT_ID}`);\n    if (!overlay || !isSearchField(input)) return;\n\n    const nativeInput = findNativeSearchInput(masthead);\n    input.value = nativeInput?.value || '';\n    try { nativeInput?.blur(); } catch {}\n\n    masthead.setAttribute(MOBILE_SEARCH_OPEN_ATTR, 'true');\n    document.documentElement?.setAttribute('data-fyp-search-active', 'true');\n    document.body?.setAttribute('data-fyp-search-active', 'true');\n    overlay.hidden = false;\n    overlay.setAttribute('data-open', 'true');\n    overlay.setAttribute('aria-hidden', 'false');\n    trigger.setAttribute('aria-expanded', 'true');\n    hideAskGeminiControls();\n    ensureGuideButtonVisible();\n\n    // Force-hide hamburger menu elements immediately while the overlay is open.\n    for (const btn of document.querySelectorAll(\n      '#guide-button, ytd-masthead #guide-button, button[aria-label=\"Guide\"], ytd-masthead #start, #start'\n    )) {\n      btn.setAttribute('data-fyp-search-inline-hidden', 'true');\n      setImportantStyles(btn, {\n        display: 'none',\n        visibility: 'hidden',\n        opacity: '0',\n        'pointer-events': 'none',\n      });\n      btn.setAttribute('aria-hidden', 'true');\n    }\n\n    // Focus the FYP-owned field synchronously inside the user gesture.\n    try {\n      input.focus({ preventScroll: true });\n    } catch {\n      input.focus();\n    }\n    const end = input.value.length;\n    input.setSelectionRange?.(end, end);\n\n    requestAnimationFrame(() => {\n      if (document.documentElement?.getAttribute('data-fyp-search-active') !== 'true') return;\n      try {\n        input.focus({ preventScroll: true });\n      } catch {\n        // ignore\n      }\n      input.setSelectionRange?.(input.value.length, input.value.length);\n    });\n  }\n\n  function dismissMiniplayer() {\n    const app = document.querySelector('ytd-app');\n    if (app) {\n      app.removeAttribute('miniplayer-active_');\n      app.removeAttribute('miniplayer-active');\n      try {\n        if ('miniplayerActive_' in app) app.miniplayerActive_ = false;\n        if ('miniplayerActive' in app) app.miniplayerActive = false;\n      } catch {\n        // ignore\n      }\n    }\n\n    for (const mini of document.querySelectorAll(\n      'ytd-miniplayer, #miniplayer, #miniplayer-container'\n    )) {\n      setImportantStyles(mini, {\n        display: 'none',\n        visibility: 'hidden',\n        'pointer-events': 'none',\n        opacity: '0',\n        width: '0',\n        height: '0',\n      });\n      mini.removeAttribute('active');\n      mini.removeAttribute('enabled');\n      try {\n        if (typeof mini.minimize === 'function') {\n          // no-op path\n        }\n        if ('active' in mini) mini.active = false;\n      } catch {\n        // ignore\n      }\n    }\n\n    document\n      .querySelectorAll(\n        '.ytp-miniplayer-close-button, ytd-miniplayer button[aria-label*=\"Close\"], ' +\n          '#miniplayer button[aria-label*=\"Close\"]'\n      )\n      .forEach((button) => {\n        if (button instanceof HTMLElement) {\n          try {\n            button.click();\n          } catch {\n            // ignore\n          }\n        }\n      });\n  }\n\n  function removeFloatingPillNav() {\n    const nav = document.getElementById(NAV_ID);\n    if (nav) nav.remove();\n  }\n\n  function applySafeBottomSpacing() {\n    for (const app of document.querySelectorAll('ytd-app, ytm-app')) {\n      setImportantStyles(app, {\n        'padding-bottom': 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)',\n        '--ytd-mini-guide-width': '0px',\n        '--ytd-mini-guide-width-min': '0px',\n      });\n    }\n  }\n\n  function disableGuideSwipe(drawer) {\n    if (!(drawer instanceof HTMLElement)) return;\n    if (!drawer.hasAttribute('disable-swipe')) {\n      drawer.setAttribute('disable-swipe', '');\n    }\n    try {\n      drawer.disableSwipe = true;\n    } catch {}\n  }\n\n  function lockGuideToTapOnly() {\n    for (const mini of document.querySelectorAll('ytd-mini-guide-renderer')) {\n      setImportantStyles(mini, {\n        display: 'none',\n        visibility: 'hidden',\n        'pointer-events': 'none',\n      });\n    }\n\n    for (const app of document.querySelectorAll('ytd-app')) {\n      setImportantStyles(app, {\n        '--ytd-mini-guide-width': '0px',\n        '--ytd-mini-guide-width-min': '0px',\n      });\n    }\n\n    for (const drawer of document.querySelectorAll('tp-yt-app-drawer#guide, #guide')) {\n      disableGuideSwipe(drawer);\n      hideShortsGuideEntries(drawer);\n    }\n\n    hideShortsGuideEntries(document);\n    restoreScrollAfterGuideClose();\n  }\n\n  function ensureGuideButtonVisible() {\n    const candidates = document.querySelectorAll([\n      '#guide-button',\n      'ytd-masthead #guide-button',\n      'ytd-masthead button[aria-label=\"Guide\"]',\n      'ytd-masthead button[aria-label*=\"Guide\"]',\n      'ytd-masthead yt-icon-button#guide-button',\n      'button[aria-label=\"Guide\"]',\n      'button[aria-label*=\"Guide\"]',\n    ].join(','));\n\n    const isSearchActive =\n      document.body?.getAttribute('data-fyp-search-active') === 'true' ||\n      document.querySelector(`ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}=\"true\"]`);\n\n    if (isSearchActive) {\n      for (const button of candidates) {\n        button.setAttribute('aria-hidden', 'true');\n        setImportantStyles(button, {\n          display: 'none',\n          visibility: 'hidden',\n          opacity: '0',\n          'pointer-events': 'none',\n        });\n      }\n      return;\n    }\n\n    for (const button of candidates) {\n      button.removeAttribute('hidden');\n      button.setAttribute('aria-hidden', 'false');\n      setImportantStyles(button, {\n        display: 'inline-flex',\n        visibility: 'visible',\n        opacity: '1',\n        'pointer-events': 'auto',\n        width: '40px',\n        'min-width': '40px',\n        height: '40px',\n      });\n      const icon = button.querySelector('yt-icon, .yt-icon-button, svg');\n      if (icon) {\n        setImportantStyles(icon, {\n          display: 'block',\n          visibility: 'visible',\n          opacity: '1',\n        });\n      }\n    }\n\n    lockGuideToTapOnly();\n  }\n\n  function hideUploadControls(root = document) {\n    const selectors = [\n      'ytd-masthead a[href=\"/upload\"]',\n      'ytd-masthead a[href*=\"upload?\"]',\n      'ytd-masthead a[href*=\"/upload\"]',\n      'ytd-masthead button[aria-label=\"Create\"]',\n      'ytd-masthead button[aria-label*=\"Create a video\"]',\n      'ytd-masthead button[aria-label=\"Upload\"]',\n      'ytd-masthead button[aria-label=\"Upload video\"]',\n      'ytd-masthead [aria-label=\"Create\"]',\n      'ytd-masthead [aria-label=\"Upload video\"]',\n      '#masthead-upload-button',\n      'ytm-mobile-topbar-renderer button[aria-label*=\"Upload\"]',\n      'ytm-mobile-topbar-renderer button[aria-label*=\"Create\"]',\n      'ytm-mobile-topbar-renderer a[href*=\"upload\"]',\n    ].join(',');\n\n    for (const control of root.querySelectorAll?.(selectors) || []) {\n      const host =\n        control.closest(\n          'ytd-topbar-menu-button-renderer, ytd-button-renderer, ' +\n            'ytm-topbar-menu-button-renderer, yt-icon-button, button-view-model'\n        ) || control;\n      setImportantStyles(host, {\n        display: 'none',\n        visibility: 'hidden',\n        'pointer-events': 'none',\n        width: '0',\n        'min-width': '0',\n        margin: '0',\n        padding: '0',\n        overflow: 'hidden',\n      });\n      host.setAttribute('aria-hidden', 'true');\n      host.hidden = true;\n    }\n\n    // Fallback: match by label text when YouTube changes aria attributes.\n    for (const candidate of root.querySelectorAll?.(\n      'ytd-masthead button, ytd-masthead a, ytm-mobile-topbar-renderer button, ytm-mobile-topbar-renderer a'\n    ) || []) {\n      const label = [\n        candidate.getAttribute('aria-label'),\n        candidate.getAttribute('title'),\n        candidate.textContent,\n      ]\n        .filter(Boolean)\n        .join(' ')\n        .replace(/\\s+/g, ' ')\n        .trim()\n        .toLowerCase();\n      if (!label) continue;\n      if (\n        !/^(create|upload)(\\b|$)/.test(label) &&\n        !label.includes('upload video') &&\n        !label.includes('create a video') &&\n        !label.includes('create video or post')\n      ) {\n        continue;\n      }\n      const host =\n        candidate.closest(\n          'ytd-topbar-menu-button-renderer, ytd-button-renderer, ' +\n            'ytm-topbar-menu-button-renderer, yt-icon-button, button-view-model'\n        ) || candidate;\n      setImportantStyles(host, {\n        display: 'none',\n        visibility: 'hidden',\n        'pointer-events': 'none',\n      });\n      host.hidden = true;\n    }\n  }\n\n  function markHistoryFeedBrowse() {\n    const browse = document.querySelector('ytd-browse');\n    if (!(browse instanceof HTMLElement)) return;\n    if (location.pathname.startsWith('/feed/history')) {\n      browse.setAttribute(HISTORY_FEED_ATTR, 'history');\n    } else if (browse.getAttribute(HISTORY_FEED_ATTR) === 'history') {\n      browse.removeAttribute(HISTORY_FEED_ATTR);\n    }\n  }\n\n  function applyMobileShell() {\n    hideNativeNavigationAndShorts();\n    ensureGuideButtonVisible();\n    ensureMobileSearchElements();\n    hideAskGeminiControls();\n    hideUploadControls();\n    dismissMiniplayer();\n    removeFloatingPillNav();\n    applySafeBottomSpacing();\n    markHistoryFeedBrowse();\n\n    for (const video of document.querySelectorAll('video')) {\n      enforceInlinePlayback(video);\n    }\n  }\n\n  function findCommentsRoot() {\n    const watch = document.querySelector('ytd-watch-flexy');\n    return (\n      watch?.querySelector('ytd-comments#comments') ||\n      watch?.querySelector('#comments ytd-comments') ||\n      watch?.querySelector('ytd-comments') ||\n      document.querySelector('ytd-comments#comments') ||\n      document.querySelector('#comments') ||\n      document.querySelector('ytd-comments')\n    );\n  }\n\n  function findWatchPlaylistHost(watch) {\n    if (!(watch instanceof Element)) return null;\n    const hasListParam = new URLSearchParams(location.search).has('list');\n    const watchHasPlaylist =\n      watch.hasAttribute('playlist') || watch.hasAttribute('has-playlist');\n    if (!hasListParam && !watchHasPlaylist) return null;\n\n    const renderer = [...watch.querySelectorAll('ytd-playlist-panel-renderer')].find(\n      (element) =>\n        !element.closest('ytd-miniplayer') && !element.hasAttribute('hidden')\n    );\n    if (renderer instanceof HTMLElement) {\n      const wrapper = renderer.parentElement;\n      if (\n        wrapper instanceof HTMLElement &&\n        wrapper.id === 'playlist' &&\n        wrapper !== watch.querySelector('#secondary') &&\n        wrapper !== watch.querySelector('#secondary-inner') &&\n        wrapper !== watch.querySelector('#below')\n      ) {\n        return wrapper;\n      }\n      return renderer;\n    }\n\n    const playlist = watch.querySelector('#playlist');\n    if (\n      playlist instanceof HTMLElement &&\n      playlist.id === 'playlist' &&\n      !playlist.closest('ytd-miniplayer') &&\n      playlist !== watch.querySelector('#secondary')\n    ) {\n      return playlist;\n    }\n    return null;\n  }\n\n  function positionCommentsAfterRecommendations() {\n    if (location.pathname !== '/watch') return;\n\n    const watch = document.querySelector('ytd-watch-flexy');\n    if (!watch) return;\n\n    let below = watch.querySelector('#below');\n    const primary = watch.querySelector('#primary-inner, #primary');\n    if (!below && primary) {\n      below = primary.querySelector('#below');\n    }\n    if (!below && primary) {\n      below = document.createElement('div');\n      below.id = 'below';\n      primary.appendChild(below);\n    }\n    if (!below) return;\n\n    const descriptionBlock =\n      [...below.children].find((element) =>\n        element.matches(\n          'ytd-watch-metadata, ytd-video-primary-info-renderer, ytd-video-secondary-info-renderer'\n        )\n      ) ||\n      watch.querySelector(\n        'ytd-watch-metadata, ytd-video-primary-info-renderer, ytd-video-secondary-info-renderer'\n      );\n\n    const comments = findCommentsRoot();\n    const playlist = findWatchPlaylistHost(watch);\n    const recommendationsCandidate =\n      watch.querySelector('ytd-watch-next-secondary-results-renderer') ||\n      watch.querySelector('#related');\n    const recommendations =\n      recommendationsCandidate instanceof HTMLElement &&\n      (!playlist || !playlist.contains(recommendationsCandidate))\n        ? recommendationsCandidate\n        : null;\n    if (!descriptionBlock || (!playlist && !recommendations && !comments)) {\n      return;\n    }\n\n    if (descriptionBlock.parentElement !== below) {\n      below.insertAdjacentElement('afterbegin', descriptionBlock);\n    }\n\n    setImportantStyles(below, {\n      display: 'flex',\n      'flex-direction': 'column',\n      width: '100%',\n      'min-width': '0',\n    });\n    setImportantStyles(descriptionBlock, { order: '1' });\n\n    /*\n     * Watch order: description (title + inline buttons) \u2192 playlist \u2192\n     * recommendations \u2192 comments. Do not move #secondary as a whole; that\n     * either buries the playlist after comments or treats it as related.\n     */\n    let insertionAnchor = descriptionBlock;\n    if (playlist) {\n      setImportantStyles(playlist, {\n        order: '2',\n        display: 'block',\n        width: '100%',\n        'min-width': '0',\n        'max-width': '100%',\n        'margin-left': '0',\n      });\n      playlist.removeAttribute('hidden');\n      if (\n        playlist.parentElement !== below ||\n        descriptionBlock.nextElementSibling !== playlist\n      ) {\n        descriptionBlock.insertAdjacentElement('afterend', playlist);\n      }\n      insertionAnchor = playlist;\n    }\n\n    if (recommendations && !recommendations.contains(comments)) {\n      setImportantStyles(recommendations, {\n        order: '3',\n        width: '100%',\n        'max-width': '100%',\n        'margin-left': '0',\n      });\n      if (\n        recommendations.parentElement !== below ||\n        insertionAnchor.nextElementSibling !== recommendations\n      ) {\n        insertionAnchor.insertAdjacentElement('afterend', recommendations);\n      }\n      insertionAnchor = recommendations;\n    }\n\n    if (comments) {\n      setImportantStyles(comments, {\n        order: '4',\n        width: '100%',\n        'min-width': '0',\n        'max-width': '100%',\n        margin: '8px 0 0',\n      });\n      if (\n        comments.parentElement !== below ||\n        insertionAnchor.nextElementSibling !== comments\n      ) {\n        insertionAnchor.insertAdjacentElement('afterend', comments);\n      }\n    }\n\n    /*\n     * Keep the transport strip above the playlist. If it ever lands as a\n     * #below sibling (title mount race), pin it with the metadata block\n     * instead of after playlist/recommendations/comments.\n     */\n    const toolbar = document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID);\n    if (toolbar instanceof HTMLElement) {\n      const titleInMeta = descriptionBlock.querySelector('#title, h1');\n      if (titleInMeta instanceof Element && isUsableWatchMount(titleInMeta)) {\n        if (titleInMeta.nextElementSibling !== toolbar) {\n          titleInMeta.insertAdjacentElement('afterend', toolbar);\n        }\n      } else if (\n        isUsableWatchMount(descriptionBlock) &&\n        descriptionBlock.firstElementChild !== toolbar\n      ) {\n        descriptionBlock.insertAdjacentElement('afterbegin', toolbar);\n      }\n    }\n\n    for (const sibling of below.children) {\n      if (\n        sibling === descriptionBlock ||\n        sibling === playlist ||\n        sibling === recommendations ||\n        (comments && sibling === comments) ||\n        sibling.id === PLAYER_CONTROLS_TOOLBAR_ID\n      ) {\n        continue;\n      }\n      setImportantStyles(sibling, { order: '5' });\n    }\n  }\n\n  function removeLegacyCommentPagination() {\n    document.getElementById(`${SCRIPT_ID}-load-more-comments`)?.remove();\n    document.getElementById(`${SCRIPT_ID}-load-less-comments`)?.remove();\n    document\n      .querySelectorAll('[data-vm-comment-hidden=\"true\"]')\n      .forEach((thread) => {\n        delete thread.dataset.vmCommentHidden;\n        thread.style.removeProperty('display');\n      });\n    document\n      .querySelectorAll('[data-vm-continuation-hidden=\"true\"]')\n      .forEach((continuation) => {\n        delete continuation.dataset.vmContinuationHidden;\n        continuation.style.removeProperty('display');\n      });\n  }\n\n  function arrangeWatchComments() {\n    restoreNativeCommentControls();\n    positionCommentsAfterRecommendations();\n    removeLegacyCommentPagination();\n  }\n\n  function hideAskGeminiControls() {\n    const roots = document.querySelectorAll(\n      '#movie_player, ytd-player, ytd-watch-metadata, ytd-masthead, ytd-app'\n    );\n    for (const root of roots) {\n      const candidates = root.querySelectorAll(\n        'button, [role=\"button\"], yt-button-view-model, button-view-model, a'\n      );\n      for (const candidate of candidates) {\n        const label = [\n          candidate.getAttribute('aria-label'),\n          candidate.getAttribute('title'),\n          candidate.textContent,\n        ]\n          .filter(Boolean)\n          .join(' ')\n          .replace(/\\s+/g, ' ')\n          .trim();\n        if (\n          !/ask(?:\\s+gemini|\\s+youtube|\\s+about|\\s*$)/i.test(label) &&\n          !/search with your voice|voice search/i.test(label)\n        ) {\n          continue;\n        }\n\n        const control =\n          candidate.closest(\n            '.ytp-fullscreen-quick-action, yt-button-view-model, button-view-model, #voice-search-button'\n          ) || candidate;\n        setImportantStyles(control, {\n          display: 'none',\n          visibility: 'hidden',\n          'pointer-events': 'none',\n        });\n        control.setAttribute('aria-hidden', 'true');\n        control.hidden = true;\n      }\n    }\n  }\n\n  function showWelcomeOnce() {\n    if (!document.body || document.getElementById(WELCOME_ID)) return;\n\n    const memoryFlag = '__vmYtWelcomeShown';\n    try {\n      if (localStorage.getItem(WELCOME_KEY) === '1') return;\n      localStorage.setItem(WELCOME_KEY, '1');\n    } catch {\n      if (window[memoryFlag]) return;\n      window[memoryFlag] = true;\n    }\n\n    const welcome = document.createElement('div');\n    welcome.id = WELCOME_ID;\n    welcome.setAttribute('role', 'status');\n    welcome.setAttribute('aria-live', 'polite');\n    welcome.textContent = 'Welcome to Fyoutube';\n    setImportantStyles(welcome, {\n      'box-sizing': 'border-box',\n      position: 'fixed',\n      top: 'calc(env(safe-area-inset-top, 0px) + 64px)',\n      left: '50%',\n      'z-index': '2147483647',\n      width: 'min(calc(100% - 32px), 352px)',\n      margin: '0',\n      padding: '14px 18px',\n      color: '#ffffff',\n      background: 'rgba(15, 15, 15, .96)',\n      border: '1px solid rgba(255, 255, 255, .18)',\n      'border-radius': '14px',\n      'box-shadow': '0 8px 24px rgba(0, 0, 0, .28)',\n      'font-family': 'Roboto, Arial, sans-serif',\n      'font-size': '16px',\n      'font-weight': '600',\n      'line-height': '1.3',\n      'text-align': 'center',\n      transform: 'translateX(-50%)',\n      opacity: '1',\n    });\n    document.body.appendChild(welcome);\n\n    let dismissed = false;\n    const dismiss = () => {\n      if (dismissed) return;\n      dismissed = true;\n      welcome.dataset.hiding = 'true';\n      welcome.style.setProperty('opacity', '0', 'important');\n      welcome.style.setProperty(\n        'transform',\n        'translate(-50%, -8px)',\n        'important'\n      );\n      setTimeout(() => welcome.remove(), 240);\n    };\n    welcome.addEventListener('click', dismiss, { once: true });\n    setTimeout(dismiss, 4200);\n  }\n\n  function updateMobileNavigation() {\n    const nav = document.getElementById(NAV_ID);\n    if (!nav) return;\n    applyCriticalNavigationLayout(nav);\n    const inactiveColor = isDarkTheme() ? '#f1f1f1' : '#0f0f0f';\n    for (const link of nav.querySelectorAll('.vm-yt-nav-item')) {\n      const item = MOBILE_NAV_ITEMS[Number(link.dataset.index)];\n      const isActive = Boolean(item?.active(location.pathname));\n      const isCreate = item?.create === true;\n      link.dataset.active = String(isActive);\n      link.style.setProperty(\n        'color',\n        isActive && !isCreate ? '#ff0033' : inactiveColor,\n        'important'\n      );\n      link.style.setProperty('background', 'transparent', 'important');\n      if (item) {\n        if (isActive) link.setAttribute('aria-current', 'page');\n        else link.removeAttribute('aria-current');\n      }\n    }\n  }\n\n  function buildNavItem(item, index) {\n    const link = document.createElement('a');\n    link.className = 'vm-yt-nav-item';\n    link.href = item.href;\n    link.dataset.index = String(index);\n    link.dataset.id = item.id;\n    if (item.create) link.dataset.create = 'true';\n    link.setAttribute('aria-label', item.label);\n    const iconWrap = document.createElement('span');\n    iconWrap.className = 'vm-yt-nav-icon-wrap';\n    const icon = svgElementFromMarkup(item.icon);\n    if (icon) {\n      icon.classList.add('vm-yt-nav-icon');\n      icon.setAttribute('viewBox', '0 0 24 24');\n      icon.setAttribute('aria-hidden', 'true');\n      iconWrap.appendChild(icon);\n    }\n    const label = document.createElement('span');\n    label.className = 'vm-yt-nav-label';\n    label.textContent = item.label;\n    link.append(iconWrap, label);\n    return link;\n  }\n\n  function ensureMobileNavigation() {\n    // Burger / guide drawer is the only nav \u2014 never reinject the floating pill.\n    removeFloatingPillNav();\n  }\n\n  function markSubscribeButtons(root = document) {\n    const candidates = root.querySelectorAll?.([\n      'ytm-subscribe-button-renderer button',\n      'yt-subscribe-button-view-model button',\n      'ytd-subscribe-button-renderer button',\n      'ytd-subscribe-button-renderer tp-yt-paper-button',\n      'ytd-subscribe-button-renderer [role=\"button\"]',\n      'button[aria-label*=\"Subscribe\"]',\n      'button[aria-label*=\"subscribe\"]',\n      '[role=\"button\"][aria-label*=\"Subscribe\"]',\n      '[role=\"button\"][aria-label*=\"subscribe\"]',\n    ].join(',')) || [];\n\n    for (const button of candidates) {\n      const owner = button.closest(\n        'ytm-subscribe-button-renderer, yt-subscribe-button-view-model, ' +\n          'ytd-subscribe-button-renderer'\n      );\n      const label = [\n        button.getAttribute('aria-label'),\n        button.textContent,\n        owner?.getAttribute('aria-label'),\n        owner?.textContent,\n      ]\n        .filter(Boolean)\n        .join(' ')\n        .replace(/\\s+/g, ' ')\n        .trim()\n        .toLowerCase();\n      const alreadySubscribed =\n        button.getAttribute('aria-pressed') === 'true' ||\n        owner?.hasAttribute('subscribed') ||\n        owner?.getAttribute('subscribed') === 'true' ||\n        label.includes('subscribed') ||\n        label.includes('unsubscribe');\n      const isSubscribeAction =\n        !alreadySubscribed &&\n        /(^|\\s)subscribe(?:\\s|$| to )/.test(label);\n\n      if (isSubscribeAction) {\n        if (!button.dataset.vmSubscribeOriginalStyle) {\n          button.dataset.vmSubscribeOriginalStyle = JSON.stringify(\n            [\n              'color',\n              'background',\n              'background-color',\n              'background-image',\n              'border',\n              'border-color',\n              'box-shadow',\n              '--yt-spec-brand-button-background',\n              '--yt-spec-static-brand-red',\n            ].map((property) => [\n              property,\n              button.style.getPropertyValue(property),\n              button.style.getPropertyPriority(property),\n            ])\n          );\n        }\n        button.dataset.vmSubscribeAction = 'true';\n        owner?.setAttribute('data-vm-subscribe-action', 'true');\n        setImportantStyles(button, {\n          color: '#ffffff',\n          background: '#ff0033',\n          'background-color': '#ff0033',\n          'background-image': 'none',\n          border: '1px solid #ff0033',\n          'border-color': '#ff0033',\n          'box-shadow': 'none',\n          '--yt-spec-brand-button-background': '#ff0033',\n          '--yt-spec-static-brand-red': '#ff0033',\n        });\n        for (const child of button.querySelectorAll(\n          'span, .yt-spec-button-shape-next__button-text-content'\n        )) {\n          child.style.setProperty('color', '#ffffff', 'important');\n        }\n      } else {\n        delete button.dataset.vmSubscribeAction;\n        owner?.removeAttribute('data-vm-subscribe-action');\n        for (const child of button.querySelectorAll(\n          'span, .yt-spec-button-shape-next__button-text-content'\n        )) {\n          child.style.removeProperty('color');\n        }\n        if (button.dataset.vmSubscribeOriginalStyle) {\n          try {\n            const originalStyles = JSON.parse(\n              button.dataset.vmSubscribeOriginalStyle\n            );\n            for (const [property, value, priority] of originalStyles) {\n              if (value) button.style.setProperty(property, value, priority);\n              else button.style.removeProperty(property);\n            }\n          } catch {\n            // A YouTube rerender will restore the native style.\n          }\n          delete button.dataset.vmSubscribeOriginalStyle;\n        }\n      }\n    }\n  }\n\n  function restoreNativeCommentControls(root = document) {\n    const enhancedComments = root.querySelectorAll?.(\n      '[data-vm-comment-enhanced=\"true\"]'\n    ) || [];\n    for (const comment of enhancedComments) {\n      for (const toolbar of comment.querySelectorAll('#toolbar')) {\n        toolbar.style.removeProperty('display');\n        toolbar.style.removeProperty('visibility');\n      }\n      comment.removeAttribute('data-vm-comment-enhanced');\n    }\n    root.querySelectorAll?.('.vm-yt-comment-actions').forEach((actions) => {\n      actions.remove();\n    });\n  }\n\n  function ensureViewport() {\n    if (!document.head) return;\n    let viewport = document.querySelector('meta[name=\"viewport\"]');\n    if (!viewport) {\n      viewport = document.createElement('meta');\n      viewport.name = 'viewport';\n      document.head.appendChild(viewport);\n    }\n    viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';\n  }\n\n  /*\n   * Prefer a mounted watch title/metadata node even when its layout height is\n   * briefly 0 during YouTube remounts. Requiring height > 0 caused the strip to\n   * bounce between #below (order 4 / huge gap) and after-title on every scan.\n   * Issue #2: never treat a hidden ancestor or the player shell as a valid\n   * mount. Reload paints the player before the title; parking there clips the\n   * strip when full-bleed CSS collapses #columns #player.\n   */\n  const COLLAPSED_PLAYER_SHELL_SELECTOR = [\n    'ytd-watch-flexy[full-bleed-player] #columns #player',\n    'ytd-watch-flexy[theater] #columns #player',\n    'ytd-watch-flexy:not([full-bleed-player]) #player-full-bleed-container',\n  ].join(', ');\n\n  function isUsableWatchMount(node) {\n    if (!(node instanceof Element) || !node.isConnected) return false;\n    if (node.closest('[hidden]')) return false;\n    const watch = node.closest('ytd-watch-flexy');\n    if (watch && !isVisibleWatchRoot(watch)) return false;\n    if (node.closest(COLLAPSED_PLAYER_SHELL_SELECTOR)) return false;\n    const style = getComputedStyle(node);\n    if (style.display === 'none' || style.visibility === 'hidden') return false;\n    return true;\n  }\n\n  function isVisibleWatchRoot(watch) {\n    if (!(watch instanceof Element) || !watch.isConnected) return false;\n    for (let node = watch; node instanceof Element; node = node.parentElement) {\n      if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') {\n        return false;\n      }\n      const style = getComputedStyle(node);\n      if (style.display === 'none' || style.visibility === 'hidden') return false;\n    }\n    return true;\n  }\n\n  function findVisibleWatchRoot() {\n    const candidates = [\n      ...document.querySelectorAll(\n        'ytd-app[is-watch-page] ytd-watch-flexy, ytd-watch-flexy[video-id], ytd-watch-flexy'\n      ),\n    ];\n    return candidates.find(isVisibleWatchRoot) || null;\n  }\n\n  function findActivePlayerElement() {\n    const watch = findVisibleWatchRoot();\n    const player = watch?.querySelector('#movie_player, .html5-video-player');\n    if (player instanceof HTMLElement) return player;\n    const video =\n      state.video instanceof HTMLVideoElement && state.video.isConnected\n        ? state.video\n        : null;\n    return video?.closest('#movie_player, .html5-video-player') || null;\n  }\n\n  function findWatchTitleAnchor() {\n    const watch = findVisibleWatchRoot();\n    if (!watch) return null;\n    const selectors = [\n      'ytd-watch-metadata #title',\n      'ytd-video-primary-info-renderer #title',\n      'ytd-watch-metadata h1',\n      '#below h1',\n    ];\n    for (const selector of selectors) {\n      for (const candidate of watch.querySelectorAll(selector)) {\n        if (!isUsableWatchMount(candidate)) continue;\n        return candidate.closest('#title') || candidate;\n      }\n    }\n    return null;\n  }\n\n  function findWatchMetadataHost() {\n    const watch = findVisibleWatchRoot();\n    if (!watch) return null;\n    const selectors = [\n      'ytd-watch-metadata',\n      'ytd-video-primary-info-renderer',\n    ];\n    for (const selector of selectors) {\n      for (const candidate of watch.querySelectorAll(selector)) {\n        if (isUsableWatchMount(candidate)) return candidate;\n      }\n    }\n    return null;\n  }\n\n  function findWatchBelowHost() {\n    const watch = findVisibleWatchRoot();\n    if (!watch) return null;\n    const selectors = [\n      '#below',\n      '#primary-inner',\n    ];\n    for (const selector of selectors) {\n      const candidate = watch.querySelector(selector);\n      if (isUsableWatchMount(candidate)) return candidate;\n    }\n    return null;\n  }\n\n  function findVisibleWatchPlayerHost() {\n    const watch = findVisibleWatchRoot();\n    if (!watch) return null;\n    const fullBleed =\n      watch.hasAttribute('full-bleed-player') ||\n      watch.hasAttribute('theater');\n    const selectors = fullBleed\n      ? [\n          '#player-full-bleed-container',\n          '#player-container-outer',\n          '#player',\n        ]\n      : [\n          '#player-container-outer',\n          '#player',\n          '#player-full-bleed-container',\n        ];\n    for (const selector of selectors) {\n      const candidate = watch.querySelector(selector);\n      if (!(candidate instanceof Element) || !candidate.isConnected) continue;\n      if (candidate.closest(COLLAPSED_PLAYER_SHELL_SELECTOR)) continue;\n      if (candidate.closest('[hidden]')) continue;\n      const style = getComputedStyle(candidate);\n      if (style.display === 'none' || style.visibility === 'hidden') continue;\n      return candidate;\n    }\n    return null;\n  }\n\n  function toolbarIsParkedOnPlayer(toolbar) {\n    /*\n     * CLIPPED only: inside the video engine or a collapsed unused player\n     * shell. Sitting after the visible player host is a valid fallback.\n     */\n    if (!(toolbar instanceof HTMLElement) || !toolbar.isConnected) {\n      return false;\n    }\n    if (toolbar.closest('#movie_player, .html5-video-player')) return true;\n    if (toolbar.closest(COLLAPSED_PLAYER_SHELL_SELECTOR)) return true;\n    return false;\n  }\n\n  function toolbarIsCorrectlyPlaced(\n    toolbar,\n    title,\n    metadata,\n    below,\n    playerHost,\n    watch\n  ) {\n    if (!(toolbar instanceof HTMLElement) || !toolbar.isConnected) {\n      return false;\n    }\n    if (toolbarIsParkedOnPlayer(toolbar)) return false;\n    if (title instanceof Element) {\n      return title.nextElementSibling === toolbar && isUsableWatchMount(title);\n    }\n    if (metadata instanceof Element) {\n      return (\n        toolbar.parentElement === metadata &&\n        metadata.firstElementChild === toolbar &&\n        isUsableWatchMount(metadata)\n      );\n    }\n    if (below instanceof Element) {\n      return (\n        toolbar.parentElement === below &&\n        below.firstElementChild === toolbar &&\n        isUsableWatchMount(below)\n      );\n    }\n    if (playerHost instanceof Element) {\n      return (\n        playerHost.nextElementSibling === toolbar &&\n        !playerHost.closest(COLLAPSED_PLAYER_SHELL_SELECTOR)\n      );\n    }\n    if (watch instanceof Element) {\n      return toolbar.parentElement === watch;\n    }\n    return false;\n  }\n\n  function mountPlayerControlsToolbar(\n    toolbar,\n    title,\n    metadata,\n    below,\n    playerHost,\n    watch\n  ) {\n    if (title instanceof Element) {\n      title.insertAdjacentElement('afterend', toolbar);\n      return true;\n    }\n    if (metadata instanceof Element) {\n      metadata.insertAdjacentElement('afterbegin', toolbar);\n      return true;\n    }\n    if (below instanceof Element) {\n      below.insertAdjacentElement('afterbegin', toolbar);\n      return true;\n    }\n    if (playerHost instanceof Element) {\n      playerHost.insertAdjacentElement('afterend', toolbar);\n      return true;\n    }\n    if (watch instanceof Element) {\n      watch.append(toolbar);\n      return true;\n    }\n    return false;\n  }\n\n  function ensurePlayerControlsToolbar() {\n    if (location.pathname !== '/watch') {\n      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID)?.remove();\n      return;\n    }\n\n    const watch = findVisibleWatchRoot();\n    if (!watch) {\n      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID)?.remove();\n      return;\n    }\n    const title = findWatchTitleAnchor();\n    const metadata = findWatchMetadataHost();\n    const below = findWatchBelowHost();\n    const playerHost = findVisibleWatchPlayerHost();\n    const watchChromeExists =\n      title instanceof Element ||\n      metadata instanceof Element ||\n      below instanceof Element ||\n      playerHost instanceof Element ||\n      isVisibleWatchRoot(watch);\n\n    if (!watchChromeExists) return;\n\n    let toolbar = document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID);\n    if (\n      !(toolbar instanceof HTMLElement) ||\n      toolbar.dataset.fypControlsLayout !== PLAYER_CONTROLS_LAYOUT_VERSION\n    ) {\n      toolbar?.remove();\n      toolbar = document.createElement('div');\n      toolbar.id = PLAYER_CONTROLS_TOOLBAR_ID;\n      toolbar.dataset.fypControlsLayout = PLAYER_CONTROLS_LAYOUT_VERSION;\n      toolbar.setAttribute('role', 'toolbar');\n      toolbar.setAttribute('aria-label', 'Video player controls');\n      toolbar.replaceChildren(...createPlayerControlButtons());\n    }\n\n    if (\n      !toolbarIsCorrectlyPlaced(\n        toolbar,\n        title,\n        metadata,\n        below,\n        playerHost,\n        watch\n      )\n    ) {\n      mountPlayerControlsToolbar(\n        toolbar,\n        title,\n        metadata,\n        below,\n        playerHost,\n        watch\n      );\n    }\n    syncCustomPlayerControls();\n  }\n\n  const PLAYER_CONTROLS_TOOLBAR_RETRY_MS = Object.freeze([\n    0, 60, 160, 400, 900, 1800, 3500,\n  ]);\n  let playerControlsToolbarScheduleToken = 0;\n\n  function schedulePlayerControlsToolbar() {\n    const token = ++playerControlsToolbarScheduleToken;\n    for (const delay of PLAYER_CONTROLS_TOOLBAR_RETRY_MS) {\n      setTimeout(() => {\n        if (token !== playerControlsToolbarScheduleToken) return;\n        ensurePlayerControlsToolbar();\n      }, delay);\n    }\n  }\n\n  function enforceSimpleSearchLayout() {\n    const onResults = location.pathname.startsWith('/results');\n    if (!onResults) {\n      document.documentElement.removeAttribute(SIMPLE_SEARCH_ATTR);\n      return;\n    }\n    document.documentElement.setAttribute(SIMPLE_SEARCH_ATTR, 'true');\n\n    for (const card of document.querySelectorAll('ytd-search ytd-video-renderer')) {\n      if (!(card instanceof HTMLElement)) continue;\n      const dismissible = card.querySelector('#dismissible');\n      const thumb = card.querySelector('ytd-thumbnail');\n      const channel = card.querySelector('#channel-info');\n      if (\n        !(dismissible instanceof HTMLElement) ||\n        !(thumb instanceof HTMLElement) ||\n        !(channel instanceof HTMLElement) ||\n        !dismissible.contains(thumb) ||\n        !dismissible.contains(channel)\n      ) {\n        continue;\n      }\n      if (\n        channel.parentElement !== dismissible ||\n        channel.nextElementSibling !== thumb\n      ) {\n        dismissible.insertBefore(channel, thumb);\n      }\n    }\n\n    const clutter = document.querySelectorAll(\n      [\n        'ytd-search button[aria-label*=\"Summary\" i]',\n        'ytd-search button[aria-label*=\"Ask\" i]',\n        'ytd-search [aria-label*=\"AI summary\" i]',\n        'ytd-search [aria-label*=\"AI overview\" i]',\n        'ytd-search ytd-button-renderer:has([aria-label*=\"Summary\" i])',\n        'ytd-search ytd-button-renderer:has([aria-label*=\"Ask\" i])',\n        'ytd-search ytd-info-panel-container-renderer',\n        'ytd-search ytd-clarification-renderer',\n        'ytd-search ytd-expandable-metadata-renderer:has([aria-label*=\"Summary\" i])',\n        'ytd-search ytd-expandable-metadata-renderer:has([aria-label*=\"AI\" i])',\n      ].join(',')\n    );\n    for (const node of clutter) {\n      if (node instanceof HTMLElement) {\n        node.style.setProperty('display', 'none', 'important');\n        node.style.setProperty('visibility', 'hidden', 'important');\n        node.style.setProperty('pointer-events', 'none', 'important');\n      }\n    }\n\n    for (const panel of document.querySelectorAll(\n      'ytd-search ytd-expandable-metadata-renderer'\n    )) {\n      if (!(panel instanceof HTMLElement)) continue;\n      const text = `${panel.getAttribute('aria-label') || ''} ${\n        panel.textContent || ''\n      }`.toLowerCase();\n      if (text.includes('chapter')) continue;\n      if (\n        text.includes('summary') ||\n        text.includes('ai overview') ||\n        text.includes('ask youtube') ||\n        text.includes('gemini')\n      ) {\n        panel.style.setProperty('display', 'none', 'important');\n        panel.style.setProperty('visibility', 'hidden', 'important');\n        panel.style.setProperty('pointer-events', 'none', 'important');\n      }\n    }\n  }\n\n  let lastPageScanAt = 0;\n\n  function scanPage() {\n    lastPageScanAt = Date.now();\n    ensureViewport();\n    if (\n      location.pathname.startsWith('/shorts') ||\n      location.pathname.startsWith('/playables')\n    ) {\n      location.replace(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);\n      return;\n    }\n    applyMobileShell();\n    enforceSimpleSearchLayout();\n    ensureGuideButtonVisible();\n    restoreScrollAfterGuideClose();\n    hideUploadControls();\n    dismissMiniplayer();\n    removeFloatingPillNav();\n    showWelcomeOnce();\n    markSubscribeButtons();\n    ensurePlayerControlsToolbar();\n    updateMediaSessionMetadata();\n    hideAskGeminiControls();\n    arrangeWatchComments();\n    removeAdCards();\n    const video = findVideo();\n    if (video) attachVideo(video);\n    if (location.pathname === '/watch') void refreshWatchDislikeCount();\n  }\n\n  nativeDocumentAddEventListener('visibilitychange', () => {\n    if (isReallyHidden()) {\n      prepareForBackground();\n    } else if (state.video && !state.video.paused && !state.video.ended) {\n      claimMediaSessionOwnership(state.video);\n      installMediaSessionHandlers({ force: true });\n      updateMediaSessionMetadata();\n    }\n  }, true);\n  nativeDocumentAddEventListener('webkitvisibilitychange', () => {\n    if (isReallyHidden()) prepareForBackground();\n  }, true);\n  nativeDocumentAddEventListener('freeze', prepareForBackground, true);\n  nativeDocumentAddEventListener('yt-guide-close', restoreScrollAfterGuideClose, true);\n  nativeDocumentAddEventListener(\n    'iron-overlay-closed',\n    restoreScrollAfterGuideClose,\n    true\n  );\n  nativeDocumentAddEventListener('yt-navigate-finish', () => {\n    if (redirectChannelRootToVideos()) return;\n    if (\n      location.pathname.startsWith('/shorts') ||\n      location.pathname.startsWith('/playables')\n    ) {\n      location.replace(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);\n      return;\n    }\n    removeFloatingPillNav();\n    updateMobileNavigation();\n    hideNativeNavigationAndShorts();\n    enforceSimpleSearchLayout();\n    ensureGuideButtonVisible();\n    restoreScrollAfterGuideClose();\n    hideUploadControls();\n    dismissMiniplayer();\n    schedulePlayerControlsToolbar();\n    closeMobileSearch();\n    arrangeWatchComments();\n    if (location.pathname === '/watch') {\n      void refreshWatchDislikeCount({ force: true });\n    }\n  }, true);\n  nativeDocumentAddEventListener(\n    'PointerEvent' in window ? 'pointerdown' : 'touchstart',\n    recordPlayerControlIntent,\n    { capture: true, passive: true }\n  );\n  nativeDocumentAddEventListener(\n    'PointerEvent' in window ? 'pointerdown' : 'touchstart',\n    handlePlayerControlActionCapture,\n    { capture: true, passive: false }\n  );\n  nativeDocumentAddEventListener(\n    'PointerEvent' in window ? 'pointerup' : 'touchend',\n    handlePlayerControlActionCapture,\n    { capture: true, passive: false }\n  );\n  nativeDocumentAddEventListener(\n    'PointerEvent' in window ? 'pointercancel' : 'touchcancel',\n    handlePlayerControlActionCapture,\n    { capture: true, passive: true }\n  );\n  nativeDocumentAddEventListener(\n    'PointerEvent' in window ? 'pointerdown' : 'touchstart',\n    closePlayerControlMenuFromOutside,\n    true\n  );\n  // Only use click when PointerEvent is unavailable. Dual pointerdown+click\n  // made option taps close the menu and then re-hit Captions/More underneath.\n  if (!('PointerEvent' in window)) {\n    nativeDocumentAddEventListener(\n      'click',\n      handlePlayerControlActionCapture,\n      true\n    );\n  }\n  nativeDocumentAddEventListener(\n    'scroll',\n    enforceHorizontalViewportLock,\n    { capture: true, passive: true }\n  );\n  nativeWindowAddEventListener('scroll', enforceHorizontalViewportLock, {\n    passive: true,\n  });\n  nativeDocumentAddEventListener('click', blockShortsNavigation, true);\n  nativeDocumentAddEventListener('pointerdown', blockShortsNavigation, {\n    capture: true,\n    passive: false,\n  });\n  nativeDocumentAddEventListener('touchstart', blockShortsNavigation, {\n    capture: true,\n    passive: false,\n  });\n  nativeDocumentAddEventListener('click', redirectChannelLinkToVideos, true);\n  nativeDocumentAddEventListener('click', handleMobileSearchClick, true);\n  nativeDocumentAddEventListener('touchstart', handleMobileSearchClick, {\n    capture: true,\n    passive: false,\n  });\n  nativeDocumentAddEventListener(\n    'submit',\n    (event) => {\n      if (event.target?.closest?.('ytd-masthead')) {\n        setTimeout(closeMobileSearch, 0);\n      }\n    },\n    true\n  );\n  nativeDocumentAddEventListener(\n    'keydown',\n    (event) => {\n      if (event.key !== 'Escape') return;\n      closeMobileSearch();\n    },\n    true\n  );\n  nativeWindowAddEventListener('blur', () => {\n    if (state.video && !state.video.paused) prepareForBackground();\n  }, true);\n  nativeWindowAddEventListener('pagehide', prepareForBackground, true);\n  nativeWindowAddEventListener('storage', (event) => {\n    if (event.key !== MEDIA_SESSION_OWNER_KEY) return;\n    if (ownsMediaSession()) {\n      installMediaSessionHandlers({ force: true });\n      updateMediaSessionMetadata();\n    } else {\n      deactivateMediaSessionForThisTab();\n    }\n  }, true);\n  nativeWindowAddEventListener('popstate', () => {\n    removeFloatingPillNav();\n    dismissMiniplayer();\n    updateMobileNavigation();\n    schedulePlayerControlsToolbar();\n  }, true);\n  nativeWindowAddEventListener('pageshow', () => {\n    schedulePlayerControlsToolbar();\n  }, true);\n\n  injectStyle();\n  installShortsRemovalListener();\n  applyMobileShell();\n  schedulePlayerControlsToolbar();\n\n  if (document.readyState === 'loading') {\n    nativeDocumentAddEventListener('DOMContentLoaded', scanPage, { once: true });\n  } else {\n    scanPage();\n  }\n\n  let scanQueued = false;\n  const observer = new MutationObserver(() => {\n    if (scanQueued) return;\n    scanQueued = true;\n    const delay = Math.max(\n      0,\n      PAGE_SCAN_MIN_INTERVAL_MS - (Date.now() - lastPageScanAt)\n    );\n    setTimeout(() => {\n      scanQueued = false;\n      scanPage();\n    }, delay);\n  });\n  observer.observe(document.documentElement || document, {\n    childList: true,\n    subtree: true,\n  });\n\n  // Player overlays and WebKit caption tracks can change between DOM scans.\n  setInterval(() => {\n    skipPlayerAd();\n    dismissAdBlockEnforcement();\n    suppressDuplicateNativeCaptions();\n  }, 300);\n  setInterval(() => {\n    markSubscribeButtons();\n    ensurePlayerControlsToolbar();\n    syncCustomPlayerControls();\n    hideAskGeminiControls();\n    ensureGuideButtonVisible();\n    restoreScrollAfterGuideClose();\n    hideUploadControls();\n    hideNativeNavigationAndShorts();\n    dismissMiniplayer();\n    removeFloatingPillNav();\n    hideShortsGuideEntries(document);\n    for (const video of document.querySelectorAll('video')) {\n      enforceInlinePlayback(video);\n    }\n    if (location.pathname === '/watch') arrangeWatchComments();\n  }, 1200);\n  setInterval(() => {\n    if (ownsMediaSession()) {\n      renewMediaSessionOwnership(state.video);\n      installMediaSessionHandlers({ force: true });\n      updateMediaSessionMetadata();\n    } else {\n      deactivateMediaSessionForThisTab();\n    }\n  }, MEDIA_SESSION_REFRESH_MS);\n})();\n";

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
