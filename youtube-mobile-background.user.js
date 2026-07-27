// ==UserScript==
// @name         Fuck YouTube Premium
// @namespace    https://github.com/violentmonkey
// @version      2.1.8
// @release-label 2.1.8
// @description  Orion iOS: inline playback, explicit fullscreen, native hamburger drawer, no mini-guide/Shorts/miniplayer, and update checks.
// @author       You
// @match        *://youtube.com/*
// @match        *://www.youtube.com/*
// @match        *://m.youtube.com/*
// @match        *://youtu.be/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  document.documentElement?.setAttribute('data-fyp-page-ready', '2.1.8');

  const SCRIPT_ID = 'vm-yt-mobile-background';
  const STYLE_ID = `${SCRIPT_ID}-style`;
  const NAV_ID = `${SCRIPT_ID}-nav`;
  const WELCOME_ID = `${SCRIPT_ID}-welcome`;
  const PLAYER_CONTROLS_TOOLBAR_ID = `${SCRIPT_ID}-controls-toolbar`;
  const PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v216-centered-inline-quality';
  const SEARCH_OVERLAY_ID = `${SCRIPT_ID}-search-overlay`;
  const SEARCH_TRIGGER_ID = `${SCRIPT_ID}-search-trigger`;
  const WELCOME_KEY = `${SCRIPT_ID}:welcome-shown`;
  const BACKEND_HOST = 'www.youtube.com';
  const CHANNEL_ROOT_PATH_PATTERN =
    /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/;
  const NAV_LAYOUT_VERSION = 'ext-v217-search-overlay-suggest';
  const SEARCH_TRIGGER_LAYOUT_VERSION = 'capsule-v217';
  const SEARCH_OVERLAY_LAYOUT_VERSION = 'suggest-recents-v217';
  const SEARCH_RECENTS_KEY = `${SCRIPT_ID}:search-recents`;
  const SEARCH_RECENTS_MAX = 8;
  const SEARCH_SUGGEST_MAX = 8;
  const HISTORY_FEED_ATTR = 'data-fyp-feed';
  const MOBILE_SEARCH_OPEN_ATTR = 'data-fyp-mobile-search-open';
  const NATIVE_SEARCH_HIDE_SELECTOR = [
    'ytd-masthead #search-button',
    'ytd-masthead #search-button-narrow',
    'ytd-masthead #search-icon-legacy',
    'ytd-masthead button[aria-label="Search"]',
    'ytd-masthead [role="button"][aria-label="Search"]',
    'ytd-masthead yt-icon-button[aria-label="Search"]',
    'ytd-masthead #center',
    'ytd-masthead ytd-searchbox',
    'ytd-masthead yt-searchbox',
  ].join(',');
  const PLAYER_CONTROLS_VISIBLE_MS = 10000;
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
  /*
   * Orion's floating address bar overlays the bottom of the page (like Safari).
   * Keep floating controls above that chrome so they stay tappable.
   */
  const ORION_NAV_GAP = '72px';
  let searchSuggestTimer = null;
  let searchSuggestRequestId = 0;
  let playerControlsHideTimer = null;
  const selectedCaptionTrackByVideo = new WeakMap();
  const selectedQualityByVideo = new WeakMap();
  let ignorePlayerControlActionsUntil = 0;
  let pendingMenuOptionGesture = null;
  let lastMediaSessionMetadataKey = '';
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
    target.hostname = BACKEND_HOST;
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
  /*
   * Normalize every normal and short YouTube link onto the desktop host.
   * Orion can then use the full desktop player underneath the mobile-only UI
   * provided by this script.
   */
  if (location.hostname === 'youtu.be') {
    const videoId = location.pathname.split('/').filter(Boolean)[0];
    if (videoId) {
      const target = new URL(`https://${BACKEND_HOST}/watch`);
      target.searchParams.set('v', videoId);
      for (const [key, value] of new URL(location.href).searchParams) {
        target.searchParams.set(key, value);
      }
      target.searchParams.set('app', 'desktop');
      target.searchParams.set('persist_app', '1');
      target.hash = location.hash;
      location.replace(target.href);
      return;
    }
  }

  if (location.hostname !== BACKEND_HOST) {
    const target = new URL(location.href);
    target.protocol = 'https:';
    target.hostname = BACKEND_HOST;
    target.port = '';
    target.searchParams.set('app', 'desktop');
    target.searchParams.set('persist_app', '1');
    location.replace(target.href);
    return;
  }

  if (redirectChannelRootToVideos()) return;

  // Never land on Shorts — send those URLs to Home.
  if (location.pathname.startsWith('/shorts')) {
    location.replace(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);
    return;
  }

  const AD_RESPONSE_KEYS = new Set(['adPlacements', 'adSlots', 'playerAds']);

  function pruneAdsFromPlayerResponse(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => pruneAdsFromPlayerResponse(item, seen));
      return value;
    }

    for (const key of Object.keys(value)) {
      if (AD_RESPONSE_KEYS.has(key)) {
        value[key] = [];
        continue;
      }
      if (key === 'adBreakHeartbeatParams') {
        delete value[key];
        continue;
      }
      pruneAdsFromPlayerResponse(value[key], seen);
    }

    if (value.playerConfig && typeof value.playerConfig === 'object') {
      if ('adPlacementConfig' in value.playerConfig) {
        value.playerConfig.adPlacementConfig = {};
      }
      if ('adSignalsConfig' in value.playerConfig) {
        value.playerConfig.adSignalsConfig = {};
      }
    }
    return value;
  }

  function sanitizePlayerResponseText(text) {
    if (typeof text !== 'string' || !text.includes('"ad')) return text;
    try {
      return JSON.stringify(pruneAdsFromPlayerResponse(JSON.parse(text)));
    } catch {
      return text;
    }
  }

  function isPlayerResponseUrl(input) {
    const url = String(input?.url || input || '');
    return (
      url.includes('/youtubei/v1/player') ||
      url.includes('/youtubei/v1/get_watch') ||
      /\/playlist(?:\?|$)/.test(url)
    );
  }

  function installPlayerResponseAdFilter() {
    const installFlag = '__vmYtPlayerResponseFilterV2';
    if (window[installFlag]) return;
    Object.defineProperty(window, installFlag, {
      configurable: false,
      value: true,
    });

    let initialPlayerResponse = pruneAdsFromPlayerResponse(
      window.ytInitialPlayerResponse
    );
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get: () => initialPlayerResponse,
        set: (value) => {
          initialPlayerResponse = pruneAdsFromPlayerResponse(value);
        },
      });
    } catch {
      if (window.ytInitialPlayerResponse) {
        pruneAdsFromPlayerResponse(window.ytInitialPlayerResponse);
      }
    }

    const nativeFetch = window.fetch;
    if (typeof nativeFetch === 'function') {
      window.fetch = async function filteredYouTubeFetch(input, init) {
        const response = await nativeFetch.call(this, input, init);
        if (!isPlayerResponseUrl(response.url || input)) return response;
        try {
          const originalText = await response.clone().text();
          const filteredText = sanitizePlayerResponseText(originalText);
          if (filteredText === originalText) return response;

          const filteredResponse = new Response(filteredText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
          for (const property of ['url', 'redirected', 'type']) {
            try {
              Object.defineProperty(filteredResponse, property, {
                configurable: true,
                value: response[property],
              });
            } catch {
              // These metadata properties are optional to the player.
            }
          }
          return filteredResponse;
        } catch {
          return response;
        }
      };
    }

    const NativeXHR = window.XMLHttpRequest;
    if (typeof NativeXHR !== 'function') return;
    const xhrUrls = new WeakMap();
    const nativeOpen = NativeXHR.prototype.open;
    NativeXHR.prototype.open = function filteredYouTubeOpen(method, url) {
      xhrUrls.set(this, String(url || ''));
      return nativeOpen.apply(this, arguments);
    };

    const responseTextDescriptor = Object.getOwnPropertyDescriptor(
      NativeXHR.prototype,
      'responseText'
    );
    const responseDescriptor = Object.getOwnPropertyDescriptor(
      NativeXHR.prototype,
      'response'
    );

    if (responseTextDescriptor?.get && responseTextDescriptor.configurable) {
      Object.defineProperty(NativeXHR.prototype, 'responseText', {
        ...responseTextDescriptor,
        get() {
          const text = responseTextDescriptor.get.call(this);
          return isPlayerResponseUrl(xhrUrls.get(this))
            ? sanitizePlayerResponseText(text)
            : text;
        },
      });
    }

    if (responseDescriptor?.get && responseDescriptor.configurable) {
      Object.defineProperty(NativeXHR.prototype, 'response', {
        ...responseDescriptor,
        get() {
          const response = responseDescriptor.get.call(this);
          if (!isPlayerResponseUrl(xhrUrls.get(this))) return response;
          if (typeof response === 'string') return sanitizePlayerResponseText(response);
          return pruneAdsFromPlayerResponse(response);
        },
      });
    }
  }

  installPlayerResponseAdFilter();

  const nativeDocumentAddEventListener = document.addEventListener.bind(document);
  const nativeWindowAddEventListener = window.addEventListener.bind(window);

  function inheritedDescriptor(object, property) {
    let current = object;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, property);
      if (descriptor) return descriptor;
      current = Object.getPrototypeOf(current);
    }
    return null;
  }

  const nativeHiddenDescriptor = inheritedDescriptor(document, 'hidden');
  const nativeVisibilityDescriptor = inheritedDescriptor(document, 'visibilityState');

  function readNativeDescriptor(descriptor, fallback) {
    try {
      return descriptor?.get ? descriptor.get.call(document) : fallback;
    } catch {
      return fallback;
    }
  }

  function isReallyHidden() {
    const nativeHidden = readNativeDescriptor(nativeHiddenDescriptor, null);
    if (typeof nativeHidden === 'boolean') return nativeHidden;
    return readNativeDescriptor(nativeVisibilityDescriptor, 'visible') === 'hidden';
  }

  /*
   * YouTube normally receives visibility events when iOS backgrounds the tab.
   * Reporting "visible" prevents its page code from treating that transition
   * as a reason to stop playback. The native values above remain available to
   * this script so it can still request PiP and recover playback.
   */
  function spoofDocumentProperty(property, value) {
    try {
      Object.defineProperty(document, property, {
        configurable: true,
        enumerable: true,
        get: () => value,
      });
    } catch {
      // Some WebKit builds make these properties non-configurable.
    }
  }

  spoofDocumentProperty('hidden', false);
  spoofDocumentProperty('webkitHidden', false);
  spoofDocumentProperty('visibilityState', 'visible');
  spoofDocumentProperty('webkitVisibilityState', 'visible');

  const state = {
    video: null,
    wantsPlayback: false,
    recoveryTimers: new Set(),
    userPauseUntil: 0,
    fullscreenIntentUntil: 0,
  };

  const nativeMediaPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function guardedMediaPause() {
    const isActiveVideo =
      this === state.video || this.classList?.contains('html5-main-video');
    const shouldKeepPlaying =
      isActiveVideo &&
      state.wantsPlayback &&
      Date.now() > state.userPauseUntil &&
      isReallyHidden() &&
      !this.ended;
    if (shouldKeepPlaying) return;
    return nativeMediaPause.apply(this, arguments);
  };

  function safePlay(video = state.video) {
    if (!video || video.ended || video.error) return;
    const result = video.play();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  }

  function clearRecoveryTimers() {
    for (const timer of state.recoveryTimers) clearTimeout(timer);
    state.recoveryTimers.clear();
  }

  function configurePlaybackAudioSession() {
    try {
      if (navigator.audioSession) {
        navigator.audioSession.type = 'playback';
      }
    } catch {
      // AudioSession is an optional WebKit API.
    }
  }

  function recoverPlayback(video = state.video) {
    if (!video || !state.wantsPlayback || video.ended) return;
    safePlay(video);
    clearRecoveryTimers();
    for (const delay of [80, 250, 750, 1500]) {
      const timer = setTimeout(() => {
        state.recoveryTimers.delete(timer);
        if (state.wantsPlayback && isReallyHidden()) safePlay(video);
      }, delay);
      state.recoveryTimers.add(timer);
    }
  }

  function onVideoPlay() {
    state.wantsPlayback = true;
    state.userPauseUntil = 0;
    configurePlaybackAudioSession();
    enforceInlinePlayback(state.video);
    updateMediaSessionMetadata();
    syncCustomPlayerControls();
  }

  function onVideoPause() {
    if (Date.now() <= state.userPauseUntil || !state.wantsPlayback) {
      state.wantsPlayback = false;
      clearRecoveryTimers();
      syncCustomPlayerControls();
      return;
    }
    if (isReallyHidden() && state.wantsPlayback && !state.video?.ended) {
      recoverPlayback();
    } else if (!isReallyHidden()) {
      // A pause while the page is visible is treated as an intentional pause.
      state.wantsPlayback = false;
      clearRecoveryTimers();
    }
    syncCustomPlayerControls();
  }

  function recordPlayerControlIntent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        `#movie_player, .html5-video-player, .html5-video-container, #${PLAYER_CONTROLS_TOOLBAR_ID}`
      )
    ) {
      holdPlayerControlsVisible();
    }
    const control = target.closest([
      '.ytp-play-button',
      'button[aria-label^="Pause"]',
      'button[aria-label^="Play"]',
      'button[data-title-no-tooltip="Pause"]',
      'button[data-title-no-tooltip="Play"]',
    ].join(','));
    if (!control) return;

    const video = state.video || findVideo();
    if (!video) return;
    attachVideo(video);
    if (video.paused || video.ended) {
      state.wantsPlayback = true;
      state.userPauseUntil = 0;
    } else {
      state.wantsPlayback = false;
      state.userPauseUntil = Date.now() + 3000;
      clearRecoveryTimers();
    }
  }

  function holdPlayerControlsVisible() {
    const player = document.querySelector(
      '#movie_player, .html5-video-player'
    );
    if (!(player instanceof HTMLElement)) return;

    player.dataset.fypControlsVisible = 'true';
    if (playerControlsHideTimer) clearTimeout(playerControlsHideTimer);
    playerControlsHideTimer = setTimeout(() => {
      delete player.dataset.fypControlsVisible;
      playerControlsHideTimer = null;
    }, PLAYER_CONTROLS_VISIBLE_MS);
  }

  const PLAYER_CONTROL_ICONS = Object.freeze({
    rewind: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="11 19 2 12 11 5 11 19"></polygon><polygon points="22 19 13 12 22 5 22 19"></polygon></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="4" height="16" rx="1"></rect><rect x="15" y="4" width="4" height="16" rx="1"></rect></svg>',
    forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13 19 22 12 13 5 13 19"></polygon><polygon points="2 19 11 12 2 5 2 19"></polygon></svg>',
    pip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><rect width="10" height="7" x="11" y="14" rx="1"></rect></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>',
    speed:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
    quality:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    search:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search" aria-hidden="true"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>',
    close:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    recent:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    collapse:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg>',
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
      playerControlButtonMarkup(
        'speed',
        'Playback speed',
        PLAYER_CONTROL_ICONS.speed
      ),
      playerControlButtonMarkup(
        'quality',
        'Video quality',
        PLAYER_CONTROL_ICONS.quality
      ),
    ].join('');
  }

  function controllableVideo(shouldAttach = true) {
    const stateVideo =
      state.video instanceof HTMLVideoElement && state.video.isConnected
        ? state.video
        : null;
    const video = stateVideo || findVideo();
    if (!(video instanceof HTMLVideoElement)) return null;
    if (shouldAttach) attachVideo(video);
    return video;
  }

  function syncCustomPlayerControls() {
    const toolbar = document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID);
    if (!(toolbar instanceof HTMLElement)) return;
    const video = controllableVideo(false);
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
      const pipActive =
        document.pictureInPictureElement === video ||
        video?.webkitPresentationMode === 'picture-in-picture';
      pipButton.setAttribute('aria-pressed', String(pipActive));
    }

    const fullscreenButton = toolbar.querySelector(
      '[data-fyp-player-action="fullscreen"]'
    );
    if (fullscreenButton instanceof HTMLButtonElement) {
      const fullscreenActive = Boolean(
        document.fullscreenElement ||
          document.webkitFullscreenElement ||
          video?.webkitDisplayingFullscreen
      );
      fullscreenButton.setAttribute('aria-pressed', String(fullscreenActive));
    }
  }

  function playerMenuHosts() {
    return [
      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID),
    ].filter((node) => node instanceof HTMLElement);
  }

  function closePlayerControlMenu(host) {
    const hosts = host instanceof HTMLElement ? [host] : playerMenuHosts();
    for (const menuHost of hosts) {
      menuHost.querySelector('.fyp-player-menu')?.remove();
      menuHost
        .querySelectorAll('[aria-haspopup="menu"]')
        .forEach((button) => button.setAttribute('aria-expanded', 'false'));
    }
  }

  function createPlayerControlMenu(host, sourceButton, label) {
    if (!(host instanceof HTMLElement)) return null;
    const current = host.querySelector('.fyp-player-menu');
    if (
      current?.dataset.fypMenuOwner === sourceButton.dataset.fypPlayerAction
    ) {
      closePlayerControlMenu(host);
      return null;
    }
    closePlayerControlMenu();
    const menu = document.createElement('div');
    menu.className = 'fyp-player-menu';
    menu.dataset.fypMenuOwner = sourceButton.dataset.fypPlayerAction || '';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    sourceButton.setAttribute('aria-expanded', 'true');
    host.appendChild(menu);
    return menu;
  }

  function appendPlayerMenuTitle(menu, text) {
    const title = document.createElement('div');
    title.className = 'fyp-player-menu-title';
    title.textContent = text;
    menu.appendChild(title);
  }

  function appendPlayerMenuCollapse(menu) {
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

  function appendPlayerMenuOption(
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

  function captionTracks(video) {
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

  function captionOptionText(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value?.simpleText === 'string') return value.simpleText.trim();
    if (Array.isArray(value?.runs)) {
      return value.runs.map((run) => run.text || '').join('').trim();
    }
    return '';
  }

  function youtubeCaptionTrackList() {
    const player = document.querySelector('#movie_player');
    if (!player || typeof player.getOption !== 'function') return [];
    try {
      const tracks = player.getOption('captions', 'tracklist');
      return Array.isArray(tracks) ? tracks : [];
    } catch {
      return [];
    }
  }

  function selectYouTubeCaptionTrack(selectedTrack) {
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
    const youtubeTrackList = youtubeCaptionTrackList();
    let youtubeTrack =
      youtubeTrackList.find((track) => {
        const label = captionOptionText(
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
      // Drive YouTube's caption module exclusively; do not click the native
      // subtitles button or force textTrack mode here.
      player.setOption('captions', 'track', youtubeTrack);
      player.setOption('captions', 'reload', true);
      return true;
    } catch {
      return false;
    }
  }

  function currentYouTubeCaptionTrack() {
    const player = document.querySelector('#movie_player');
    if (!player || typeof player.getOption !== 'function') return null;
    try {
      const track = player.getOption('captions', 'track');
      if (!track || typeof track !== 'object') return null;
      const language = String(
        track.languageCode || track.language || track.lang || ''
      ).trim();
      const label = captionOptionText(
        track.displayName || track.name || track.label
      );
      if (!language && !label) return null;
      return track;
    } catch {
      return null;
    }
  }

  function qualityOptionLabel(quality) {
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

  function youtubeQualityLevels() {
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
    // Orion sometimes reports only "auto" before levels settle; keep a usable ladder.
    if (normalized.length <= 1) return [...FALLBACK_QUALITY_LEVELS];
    return normalized;
  }

  function currentYouTubeQuality(video) {
    if (video && selectedQualityByVideo.has(video)) {
      return selectedQualityByVideo.get(video);
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

  function applyYouTubeQuality(quality) {
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

  function menuHostForButton(sourceButton) {
    return sourceButton.closest(`#${PLAYER_CONTROLS_TOOLBAR_ID}`);
  }

  function toggleSpeedMenu(video, sourceButton) {
    const host = menuHostForButton(sourceButton);
    if (!(host instanceof HTMLElement)) return;
    const menu = createPlayerControlMenu(
      host,
      sourceButton,
      'Playback speed'
    );
    if (!menu) return;

    appendPlayerMenuCollapse(menu);
    appendPlayerMenuTitle(menu, 'Playback speed');
    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      appendPlayerMenuOption(menu, {
        action: 'playback-speed',
        label: speed === 1 ? 'Normal' : `${speed}×`,
        checked: Math.abs(video.playbackRate - speed) < 0.01,
        speed,
      });
    }
  }

  function toggleQualityMenu(video, sourceButton) {
    const host = menuHostForButton(sourceButton);
    if (!(host instanceof HTMLElement)) return;
    const menu = createPlayerControlMenu(
      host,
      sourceButton,
      'Video quality'
    );
    if (!menu) return;

    appendPlayerMenuCollapse(menu);
    appendPlayerMenuTitle(menu, 'Video quality');
    const qualities = youtubeQualityLevels();
    const currentQuality = String(currentYouTubeQuality(video) || 'auto');
    for (const quality of qualities) {
      appendPlayerMenuOption(menu, {
        action: 'playback-quality',
        label: qualityOptionLabel(quality),
        checked: currentQuality === quality,
        quality,
      });
    }
  }

  async function runPlayerControlOption(option) {
    const video = controllableVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    const preservePlayback = !video.paused;
    const action = option.dataset.fypPlayerOption;

    /*
     * Playback-speed is the known-good Orion pattern: apply immediately, retry
     * once at 120ms, avoid native UI clicks that steal the gesture. Captions
     * and quality follow that same shape. Caption ownership stays with YouTube's
     * caption module — never click .ytp-subtitles-button from this menu.
     */
    if (action === 'menu-collapse') {
      // Close only; shared cleanup below still runs.
    } else if (action === 'captions-off') {
      const applyCaptionsOff = () => {
        try {
          const player = document.querySelector('#movie_player');
          player?.loadModule?.('captions');
          player?.setOption?.('captions', 'track', {});
        } catch {}
        selectedCaptionTrackByVideo.delete(video);
        delete video.dataset.fypNativeCaptionsHidden;
      };
      applyCaptionsOff();
      setTimeout(applyCaptionsOff, 120);
    } else if (action === 'caption-track') {
      const language = String(option.dataset.fypCaptionLanguage || '').trim();
      const label = String(option.dataset.fypCaptionLabel || '').trim();
      const trackIndex = Number(option.dataset.fypTrackIndex);
      const youtubeTracks = youtubeCaptionTrackList();
      const textTracks = captionTracks(video);
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
        selectYouTubeCaptionTrack(selectedMeta);
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
          selectedCaptionTrackByVideo.set(video, matchedTextTrack);
        } else {
          selectedCaptionTrackByVideo.set(video, selectedMeta);
        }
        // Deduplicate only after YouTube's custom caption layer can paint.
        setTimeout(() => suppressDuplicateNativeCaptions(video), 250);
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
          applyYouTubeQuality(quality);
          selectedQualityByVideo.set(video, quality);
        };
        applyQuality();
        setTimeout(applyQuality, 120);
      }
    }

    if (preservePlayback) {
      state.wantsPlayback = true;
      state.userPauseUntil = 0;
      for (const delay of [0, 120, 350]) {
        setTimeout(() => {
          if (video.paused && !video.ended) safePlay(video);
        }, delay);
      }
    }
    closePlayerControlMenu();
    setTimeout(syncCustomPlayerControls, 0);
    setTimeout(syncCustomPlayerControls, 250);
  }

  async function runPlayerControlAction(action, sourceButton) {
    const video = controllableVideo();
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
        state.wantsPlayback = true;
        state.userPauseUntil = 0;
        try {
          await video.play();
        } catch {
          document.querySelector('.ytp-play-button')?.click();
        }
      } else {
        state.wantsPlayback = false;
        state.userPauseUntil = Date.now() + 3000;
        clearRecoveryTimers();
        video.pause();
      }
    } else if (
      action === 'speed' &&
      sourceButton instanceof HTMLButtonElement
    ) {
      toggleSpeedMenu(video, sourceButton);
    } else if (action === 'quality' && sourceButton instanceof HTMLButtonElement) {
      toggleQualityMenu(video, sourceButton);
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
      state.fullscreenIntentUntil = Date.now() + 2000;
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
      state.wantsPlayback = true;
      state.userPauseUntil = 0;
      for (const delay of [0, 120, 350]) {
        setTimeout(() => {
          if (video.paused && !video.ended) safePlay(video);
        }, delay);
      }
    }
    setTimeout(syncCustomPlayerControls, 0);
    setTimeout(syncCustomPlayerControls, 250);
  }

  function acceptSinglePlayerControlAction(button) {
    if (!(button instanceof HTMLElement)) return false;
    const now = Date.now();
    const previous = Number(button.dataset.fypLastActionAt || 0);
    if (now - previous < 450) return false;
    button.dataset.fypLastActionAt = String(now);
    return true;
  }

  function eventClientPoint(event) {
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

  function handlePlayerControlActionCapture(event) {
    if (Date.now() < ignorePlayerControlActionsUntil) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;

    const optionButton = target.closest('[data-fyp-player-option]');
    if (optionButton instanceof HTMLButtonElement) {
      /*
       * Dropdown options must remain scrollable on Orion/iOS. Do not
       * preventDefault on pointerdown/touchstart — that kills overflow-y
       * scrolling. Activate only on a short, low-slop pointerup/touchend.
       */
      if (event.type === 'pointerdown' || event.type === 'touchstart') {
        const point = eventClientPoint(event);
        pendingMenuOptionGesture = {
          button: optionButton,
          x: point.x,
          y: point.y,
        };
        event.stopPropagation();
        return;
      }
      if (
        event.type === 'pointercancel' ||
        event.type === 'touchcancel'
      ) {
        pendingMenuOptionGesture = null;
        return;
      }
      if (event.type === 'pointerup' || event.type === 'touchend') {
        const gesture = pendingMenuOptionGesture;
        pendingMenuOptionGesture = null;
        if (!gesture || gesture.button !== optionButton) return;
        const point = eventClientPoint(event);
        const moved =
          Math.abs(point.x - gesture.x) > MENU_OPTION_TAP_SLOP_PX ||
          Math.abs(point.y - gesture.y) > MENU_OPTION_TAP_SLOP_PX;
        if (moved) return;
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
        if (!acceptSinglePlayerControlAction(optionButton)) return;
        ignorePlayerControlActionsUntil = Date.now() + 500;
        void runPlayerControlOption(optionButton);
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
    if (!acceptSinglePlayerControlAction(button)) return;
    void runPlayerControlAction(button.dataset.fypPlayerAction, button);
  }

  function closePlayerControlMenuFromOutside(event) {
    const target = event.target;
    if (
      target instanceof Element &&
      !target.closest(`#${PLAYER_CONTROLS_TOOLBAR_ID}`)
    ) {
      closePlayerControlMenu();
    }
  }

  function enforceHorizontalViewportLock() {
    const scrollingElement = document.scrollingElement;
    if (scrollingElement?.scrollLeft) scrollingElement.scrollLeft = 0;
    if (document.documentElement.scrollLeft) {
      document.documentElement.scrollLeft = 0;
    }
    if (document.body?.scrollLeft) document.body.scrollLeft = 0;
  }

  function enforceInlinePlayback(video) {
    if (!video) return;
    if (!video.hasAttribute('playsinline')) video.setAttribute('playsinline', '');
    if (!video.hasAttribute('webkit-playsinline')) {
      video.setAttribute('webkit-playsinline', '');
    }
    try {
      video.playsInline = true;
    } catch {}
    try {
      video.webkitPlaysInline = true;
    } catch {}
    try {
      video.removeAttribute('disablepictureinpicture');
      video.disablePictureInPicture = false;
    } catch {}
  }

  function onVideoLoaded() {
    enforceInlinePlayback(state.video);
    updateMediaSessionMetadata();
  }

  function hasExplicitFullscreenIntent() {
    return Date.now() <= state.fullscreenIntentUntil;
  }

  function isVideoFullscreenTarget(target) {
    if (target instanceof HTMLVideoElement) return true;
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.matches?.(
        '#movie_player, .html5-video-player, .html5-video-container, ytd-player'
      ) || target.querySelector?.('video')
    );
  }

  function recordFullscreenIntent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest([
      '.ytp-fullscreen-button',
      'button[aria-label="Full screen"]',
      'button[aria-label="Fullscreen"]',
      'button[title="Full screen"]',
      'button[title="Fullscreen"]',
      '[data-tooltip-target-id="ytp-fullscreen-button"]',
      '[data-fyp-player-action="fullscreen"]',
    ].join(','));
    if (!control) return;
    state.fullscreenIntentUntil = Date.now() + 2000;
  }

  /*
   * WebKit can choose native fullscreen before a late play() patch takes
   * effect. Mark video elements at creation time, then repeat immediately
   * before native play(). Fullscreen entry remains available only for the two
   * seconds following a real tap on YouTube's fullscreen control.
   */
  function installInlinePlaybackGuard() {
    const flag = '__ytMobileOrionInlinePlaybackGuardV2';
    if (window[flag]) return;
    Object.defineProperty(window, flag, { value: true });

    const replacePrototypeMethod = (prototype, method, createReplacement) => {
      const nativeMethod = prototype?.[method];
      if (typeof nativeMethod !== 'function') return;
      const replacement = createReplacement(nativeMethod);
      try {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
        Object.defineProperty(prototype, method, {
          configurable: descriptor?.configurable ?? true,
          enumerable: descriptor?.enumerable ?? false,
          writable: descriptor?.writable ?? true,
          value: replacement,
        });
      } catch {
        try {
          prototype[method] = replacement;
        } catch {}
      }
    };

    const patchVideoCreation = (prototype, method) => {
      replacePrototypeMethod(
        prototype,
        method,
        (nativeMethod) =>
          function inlineVideoCreation(name) {
            const element = nativeMethod.apply(this, arguments);
            if (
              element instanceof HTMLVideoElement ||
              String(name).toLowerCase() === 'video'
            ) {
              enforceInlinePlayback(element);
            }
            return element;
          }
      );
    };

    patchVideoCreation(Document.prototype, 'createElement');
    patchVideoCreation(Document.prototype, 'createElementNS');

    replacePrototypeMethod(
      Element.prototype,
      'setAttribute',
      (nativeSetAttribute) =>
        function inlineBeforeVideoSource(name) {
          if (
            this instanceof HTMLVideoElement &&
            String(name).toLowerCase() === 'src'
          ) {
            enforceInlinePlayback(this);
          }
          return nativeSetAttribute.apply(this, arguments);
        }
    );

    try {
      const srcDescriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'src'
      );
      if (srcDescriptor?.set && srcDescriptor.configurable) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
          ...srcDescriptor,
          set(value) {
            if (this instanceof HTMLVideoElement) enforceInlinePlayback(this);
            return srcDescriptor.set.call(this, value);
          },
        });
      }
    } catch {}

    replacePrototypeMethod(
      HTMLMediaElement.prototype,
      'play',
      (nativePlay) =>
        function inlinePlay() {
          if (this instanceof HTMLVideoElement) {
            enforceInlinePlayback(this);
            if (
              this.classList?.contains('html5-main-video') ||
              this === state.video
            ) {
              attachVideo(this);
            }
          }
          return nativePlay.apply(this, arguments);
        }
    );

    const guardFullscreenMethod = (prototype, method, promiseResult = false) => {
      replacePrototypeMethod(
        prototype,
        method,
        (nativeMethod) =>
          function explicitFullscreenOnly() {
            if (
              isVideoFullscreenTarget(this) &&
              !hasExplicitFullscreenIntent()
            ) {
              return promiseResult ? Promise.resolve(undefined) : undefined;
            }
            return nativeMethod.apply(this, arguments);
          }
      );
    };

    guardFullscreenMethod(HTMLVideoElement.prototype, 'webkitEnterFullscreen');
    guardFullscreenMethod(HTMLVideoElement.prototype, 'webkitEnterFullScreen');
    guardFullscreenMethod(Element.prototype, 'requestFullscreen', true);
    guardFullscreenMethod(Element.prototype, 'webkitRequestFullscreen');
    guardFullscreenMethod(Element.prototype, 'webkitRequestFullScreen');

    replacePrototypeMethod(
      HTMLVideoElement.prototype,
      'webkitSetPresentationMode',
      (nativePresentationMode) =>
        function explicitPresentationModeOnly(mode) {
          if (mode === 'fullscreen' && !hasExplicitFullscreenIntent()) {
            return undefined;
          }
          return nativePresentationMode.apply(this, arguments);
        }
    );

    nativeDocumentAddEventListener(
      'PointerEvent' in window ? 'pointerdown' : 'touchstart',
      recordFullscreenIntent,
      { capture: true, passive: true }
    );
    nativeDocumentAddEventListener('click', recordFullscreenIntent, true);

    const enforceVideoTree = (root) => {
      if (root instanceof HTMLVideoElement) enforceInlinePlayback(root);
      root.querySelectorAll?.('video').forEach(enforceInlinePlayback);
    };
    enforceVideoTree(document);
    const videoObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) enforceVideoTree(node);
        });
      }
    });
    videoObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
    nativeDocumentAddEventListener('play', (event) => {
      if (event.target instanceof HTMLVideoElement) {
        attachVideo(event.target);
        enforceInlinePlayback(event.target);
      }
    }, true);
  }

  installInlinePlaybackGuard();

  function attachVideo(video) {
    if (!video || video === state.video) {
      if (video) {
        enforceInlinePlayback(video);
        suppressDuplicateNativeCaptions(video);
      }
      return;
    }
    if (state.video) {
      state.video.removeEventListener('play', onVideoPlay);
      state.video.removeEventListener('playing', onVideoPlay);
      state.video.removeEventListener('pause', onVideoPause);
      state.video.removeEventListener('ended', onVideoPause);
      state.video.removeEventListener('loadedmetadata', onVideoLoaded);
    }

    state.video = video;
    state.wantsPlayback = !video.paused && !video.ended;
    enforceInlinePlayback(video);
    suppressDuplicateNativeCaptions(video);
    video.addEventListener('play', onVideoPlay, true);
    video.addEventListener('playing', onVideoPlay, true);
    video.addEventListener('pause', onVideoPause, true);
    video.addEventListener('ended', onVideoPause, true);
    video.addEventListener('loadedmetadata', onVideoLoaded, true);
    installMediaSessionHandlers();
  }

  function findVideo() {
    const videos = [...document.querySelectorAll('video')];
    return (
      videos.find((video) => video.classList.contains('html5-main-video')) ||
      videos.find((video) => !video.ended && video.readyState > 0) ||
      videos[0] ||
      null
    );
  }

  function captionTrackLabel(track) {
    return `${track.label || ''} ${track.language || ''}`.trim();
  }

  function isEnglishCaptionTrack(track) {
    return (
      /^en(?:[-_]|$)/i.test(track.language || '') ||
      /\benglish\b/i.test(track.label || '')
    );
  }

  function isAutoGeneratedCaptionTrack(track) {
    return /\b(?:auto(?:matic)?(?:-generated)?|generated|asr)\b/i.test(
      captionTrackLabel(track)
    );
  }

  function captionTrackScore(track, index) {
    const english = isEnglishCaptionTrack(track);
    const automatic = isAutoGeneratedCaptionTrack(track);
    let score = 0;
    if (english && !automatic) score += 400;
    else if (english && automatic) score += 300;
    else if (!automatic) score += 200;
    else score += 100;
    if (track.mode === 'showing') score += 20;
    else if (track.mode === 'hidden') score += 10;
    return score - index / 1000;
  }

  function chooseBestCaptionTrack(tracks) {
    return tracks
      .map((track, index) => ({
        track,
        score: captionTrackScore(track, index),
      }))
      .sort((left, right) => right.score - left.score)[0]?.track;
  }

  function suppressDuplicateNativeCaptions(video = state.video || findVideo()) {
    if (!(video instanceof HTMLVideoElement)) return;
    const player = video.closest('#movie_player, .html5-video-player');
    if (!player) return;

    const customCaptionsVisible = Boolean(
      player.querySelector('.ytp-caption-window-container .ytp-caption-segment')
    );

    /*
     * Caption contract: YouTube's custom caption DOM is the sole visible owner.
     * Only hide WebKit's native ::cue when custom segments exist. Do not click
     * .ytp-subtitles-button, do not globally disable captions, and do not force
     * a competing TextTrack selection that fights YouTube's caption module.
     */
    if (!customCaptionsVisible) {
      delete video.dataset.fypNativeCaptionsHidden;
      return;
    }

    video.dataset.fypNativeCaptionsHidden = 'true';
    for (let index = 0; index < video.textTracks.length; index += 1) {
      const track = video.textTracks[index];
      if (
        (track.kind === 'captions' || track.kind === 'subtitles') &&
        track.mode === 'showing'
      ) {
        try {
          track.mode = 'hidden';
        } catch {
          // CSS ::cue hiding still covers locked WebKit tracks.
        }
      }
    }
  }

  function metadataContent(selector) {
    return document.querySelector(selector)?.getAttribute('content')?.trim() || '';
  }

  function visibleVideoTitle() {
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

  function mediaSessionArtwork(videoId, response) {
    const candidates = [];
    if (videoId) {
      candidates.push(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
    }
    candidates.push(metadataContent('meta[property="og:image"]'));
    for (const thumbnail of [
      ...(response?.videoDetails?.thumbnail?.thumbnails || []),
    ].reverse()) {
      candidates.push(thumbnail.url);
    }

    for (const src of candidates) {
      if (!src) continue;
      try {
        const absolute = new URL(src, location.href).href;
        return [{ src: absolute }];
      } catch {}
    }
    return [];
  }

  function applyMediaArtworkPoster(video, artwork) {
    if (!(video instanceof HTMLVideoElement) || !artwork.length) return;
    const preferred =
      artwork.find((item) => item.src.includes('/hqdefault.jpg')) ||
      artwork[artwork.length - 1];
    if (preferred?.src && video.poster !== preferred.src) {
      video.poster = preferred.src;
    }
  }

  function updateMediaSessionMetadata() {
    if (
      !('mediaSession' in navigator) ||
      typeof MediaMetadata !== 'function' ||
      location.pathname !== '/watch'
    ) {
      return;
    }
    const response = window.ytInitialPlayerResponse;
    const details = response?.videoDetails || {};
    const videoId =
      details.videoId || new URL(location.href).searchParams.get('v') || '';
    const title =
      details.title ||
      visibleVideoTitle() ||
      metadataContent('meta[property="og:title"]') ||
      metadataContent('meta[name="title"]') ||
      document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
    const artist =
      details.author ||
      document
        .querySelector(
          'ytd-video-owner-renderer #channel-name a, ' +
            'ytd-watch-metadata #owner #channel-name a'
        )
        ?.textContent?.trim() ||
      'YouTube';
    const artwork = mediaSessionArtwork(videoId, response);
    if (!title || !artwork.length) return;
    const video = state.video || findVideo();
    applyMediaArtworkPoster(video, artwork);
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
      metadataKey === lastMediaSessionMetadataKey &&
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
      lastMediaSessionMetadataKey = metadataKey;
    } catch {
      // Media artwork is optional in older Orion/WebKit releases.
    }
  }

  function mediaSessionVideo() {
    const video = controllableVideo(true);
    return video instanceof HTMLVideoElement ? video : null;
  }

  function syncMediaSessionPlayback(video = mediaSessionVideo()) {
    try {
      navigator.mediaSession.playbackState =
        video && !video.paused && !video.ended ? 'playing' : 'paused';
    } catch {
      // playbackState is optional in older Orion/WebKit builds.
    }
    syncCustomPlayerControls();
  }

  function handleMediaSessionPlay() {
    const video = mediaSessionVideo();
    if (!video) return;
    state.wantsPlayback = true;
    state.userPauseUntil = 0;
    configurePlaybackAudioSession();
    try {
      document.querySelector('#movie_player')?.playVideo?.();
    } catch {
      // Player API is optional; the media element path below remains authoritative.
    }
    safePlay(video);
    syncMediaSessionPlayback(video);
    setTimeout(() => syncMediaSessionPlayback(video), 0);
    setTimeout(() => syncMediaSessionPlayback(video), 250);
  }

  function handleMediaSessionPause() {
    const video = mediaSessionVideo();
    if (!video) return;
    state.wantsPlayback = false;
    state.userPauseUntil = Date.now() + 5000;
    clearRecoveryTimers();
    try {
      document.querySelector('#movie_player')?.pauseVideo?.();
    } catch {
      // Player API is optional; the native pause below remains authoritative.
    }
    // Bypass the background pause guard so Lock Screen / Dynamic Island
    // pause always wins over background-audio recovery.
    nativeMediaPause.call(video);
    syncMediaSessionPlayback(video);
    setTimeout(() => syncMediaSessionPlayback(video), 0);
    setTimeout(() => syncMediaSessionPlayback(video), 250);
  }

  function handleMediaSessionSeek(offsetSeconds) {
    const video = mediaSessionVideo();
    if (!video || !Number.isFinite(offsetSeconds)) return;
    const duration = Number.isFinite(video.duration)
      ? video.duration
      : Number.POSITIVE_INFINITY;
    video.currentTime = Math.max(
      0,
      Math.min(duration, video.currentTime + offsetSeconds)
    );
    syncMediaSessionPlayback(video);
  }

  function installMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    updateMediaSessionMetadata();
    try {
      navigator.mediaSession.setActionHandler('play', handleMediaSessionPlay);
      navigator.mediaSession.setActionHandler('pause', handleMediaSessionPause);
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        handleMediaSessionSeek(-(details?.seekOffset || 10));
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        handleMediaSessionSeek(details?.seekOffset || 10);
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        const video = mediaSessionVideo();
        if (!video || details?.seekTime == null) return;
        video.currentTime = details.seekTime;
        syncMediaSessionPlayback(video);
      });
    } catch {
      // MediaSession or a particular action is optional in older iOS WebKit.
    }
  }

  function prepareForBackground() {
    const video = state.video || findVideo();
    if (!video) return;
    attachVideo(video);
    installMediaSessionHandlers();
    configurePlaybackAudioSession();
    // Respect an intentional Now Playing / toolbar pause window so background
    // recovery cannot immediately undo Lock Screen or Dynamic Island pause.
    if (
      !video.paused &&
      !video.ended &&
      Date.now() > state.userPauseUntil
    ) {
      state.wantsPlayback = true;
    }
    if (state.wantsPlayback) recoverPlayback(video);
  }

  const SKIP_BUTTON_SELECTOR = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    'button[class*="ytp-ad-skip"]',
  ].join(',');

  function skipPlayerAd() {
    document.querySelectorAll(SKIP_BUTTON_SELECTOR).forEach((button) => {
      if (button instanceof HTMLElement) button.click();
    });

    const video = findVideo();
    if (video) attachVideo(video);
  }

  const AD_BLOCK_ENFORCEMENT_PATTERN =
    /ad blockers? (?:are not allowed|violate)|ad blocker.{0,40}youtube|video playback is blocked|disable (?:your )?ad blocker|allow youtube ads|ad-blocking software/i;

  function dismissAdBlockEnforcement(root = document) {
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
      if (!AD_BLOCK_ENFORCEMENT_PATTERN.test(text)) continue;
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

    const video = findVideo();
    if (video && video.paused && !video.ended && video.readyState > 0) {
      attachVideo(video);
      state.wantsPlayback = true;
      state.userPauseUntil = 0;
      safePlay(video);
    }
  }

  function removeAdCards(root = document) {
    const selector = [
      'ytm-promoted-sparkles-web-renderer',
      'ytm-companion-ad-renderer',
      'ytm-display-ad-renderer',
      'ytm-promoted-video-renderer',
      'ytm-ad-slot-renderer',
      'ytd-companion-slot-renderer',
      'ytd-companion-ad-renderer',
      'ytd-action-companion-ad-renderer',
      'ytd-banner-promo-renderer-background',
      'ytd-video-masthead-ad-v3-renderer',
      'ytd-video-masthead-ad-renderer',
      'ytd-video-masthead-ad-primary-video-renderer',
      'ytd-in-feed-ad-layout-renderer',
      'ytd-promoted-sparkles-web-renderer',
      'ytd-promoted-sparkles-text-search-renderer',
      'ytd-display-ad-renderer',
      'ytd-promoted-video-renderer',
      'ytd-ad-slot-renderer',
      '.ytp-ad-overlay-container',
      '.ytp-ad-message-container',
    ].join(',');
    root.querySelectorAll?.(selector).forEach((element) => element.remove());
  }

  function injectStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      const styleHost = document.head || document.documentElement;
      if (styleHost) styleHost.appendChild(style);
    }
    if (style.dataset.layoutVersion === NAV_LAYOUT_VERSION) return;
    style.dataset.layoutVersion = NAV_LAYOUT_VERSION;
    style.textContent = `
      ytm-promoted-sparkles-web-renderer,
      ytm-companion-ad-renderer,
      ytm-display-ad-renderer,
      ytm-promoted-video-renderer,
      ytm-ad-slot-renderer,
      ytd-companion-slot-renderer,
      ytd-companion-ad-renderer,
      ytd-action-companion-ad-renderer,
      ytd-banner-promo-renderer-background,
      ytd-video-masthead-ad-v3-renderer,
      ytd-video-masthead-ad-renderer,
      ytd-video-masthead-ad-primary-video-renderer,
      ytd-in-feed-ad-layout-renderer,
      ytd-promoted-sparkles-web-renderer,
      ytd-promoted-sparkles-text-search-renderer,
      ytd-display-ad-renderer,
      ytd-promoted-video-renderer,
      ytd-ad-slot-renderer,
      .ytp-ad-overlay-container,
      .ytp-ad-message-container,
      .ytp-ad-player-overlay {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      /* Burger drawer only — hide every persistent Home/Shorts/Subs/You rail. */
      ytm-pivot-bar-renderer,
      ytd-mini-guide-renderer,
      ytd-mini-guide-entry-renderer,
      #guide-button-badge,
      ytd-guide-entry-renderer:has(a[href^='/shorts']),
      ytd-mini-guide-entry-renderer:has(a[href^='/shorts']),
      ytd-guide-entry-renderer:has(a[title='Shorts']),
      tp-yt-paper-item:has(a[href^='/shorts']),
      ytd-rich-shelf-renderer:has(a[href*='/shorts']),
      ytd-reel-shelf-renderer,
      ytd-rich-section-renderer:has(a[href*='/shorts']),
      ytm-reel-shelf-renderer,
      ytm-shorts-lockup-view-model,
      ytm-shorts-lockup-view-model-v2,
      ytd-reel-item-renderer,
      ytm-reel-item-renderer,
      ytd-rich-item-renderer:has(a[href*='/shorts']),
      yt-lockup-view-model:has(a[href*='/shorts']),
      grid-shelf-view-model:has(a[href*='/shorts']),
      ytd-browse[page-subtype='channels'] yt-tab-shape:has(a[href$='/shorts']),
      ytd-browse[page-subtype='channels'] [role='tab']:has(a[href$='/shorts']),
      ytd-browse[page-subtype='channels'] ytd-rich-item-renderer:has(a[href*='/shorts']),
      ytd-browse[page-subtype='channels'] ytd-grid-video-renderer:has(a[href*='/shorts']),
      ytd-browse[page-subtype='channels'] yt-lockup-view-model:has(a[href*='/shorts']),
      ytd-browse[page-subtype='channels'] ytd-reel-shelf-renderer,
      ytd-browse[page-subtype='channels'] ytd-rich-shelf-renderer:has(a[href*='/shorts']),
      a[href^='/shorts'],
      a[href*='youtube.com/shorts/'],
      [is-shorts],
      ytd-thumbnail[href*='/shorts'] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      ytd-app {
        --ytd-mini-guide-width: 0px !important;
        --ytd-mini-guide-width-min: 0px !important;
      }

      ytd-app[guide-persistent],
      ytd-app[mini-guide-visible] {
        --ytd-mini-guide-width: 0px !important;
        --ytd-mini-guide-width-min: 0px !important;
      }

      /* Kill YouTube miniplayer when leaving a video. */
      ytd-miniplayer,
      ytd-miniplayer[active],
      #miniplayer,
      #miniplayer-container,
      .ytp-miniplayer-ui,
      ytd-app[miniplayer-active_] #movie_player,
      .miniplayer {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
        opacity: 0 !important;
      }

      /* Force the guide (burger) button to stay visible on narrow Orion layouts.
         Do NOT force the drawer itself visible — that makes it peek while scrolling. */
      #guide-button,
      ytd-masthead #guide-button,
      #guide-button-icon,
      button#button.yt-icon-button[aria-label='Guide'],
      ytd-masthead button[aria-label='Guide'] {
        display: inline-flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        width: 40px !important;
        min-width: 40px !important;
        height: 40px !important;
      }

      /* Remove header upload / create. */
      ytd-masthead ytd-topbar-menu-button-renderer:has(a[href*='upload']),
      ytd-masthead ytd-button-renderer:has(a[href*='upload']),
      ytd-masthead a[href='/upload'],
      ytd-masthead a[href*='upload?'],
      ytd-masthead button[aria-label='Create'],
      ytd-masthead button[aria-label*='Create a video'],
      ytd-masthead [aria-label='Upload video'],
      ytd-masthead [aria-label='Upload'],
      #masthead-upload-button,
      ytm-mobile-topbar-renderer button[aria-label*='Upload'],
      ytm-mobile-topbar-renderer button[aria-label*='Create'],
      ytm-mobile-topbar-renderer a[href*='upload'],
      ytm-topbar-menu-button-renderer:has([aria-label*='Upload']),
      ytm-topbar-menu-button-renderer:has([aria-label*='Create']) {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        width: 0 !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }

      /*
       * Desktop YouTube has a 426px minimum watch-column width. On an iPhone it
       * centers that wider column and cuts roughly 18px from the left edge.
       * Collapse only the content column at phone widths; the desktop player
       * and data model stay untouched.
       */
      @media (max-width: 700px) {
        html,
        body,
        ytd-app,
        ytd-page-manager,
        ytd-watch-flexy,
        ytd-watch-flexy #columns {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
        }

        html,
        body {
          overflow-x: hidden !important;
          overscroll-behavior-x: none !important;
        }

        @supports (overflow: clip) {
          html,
          body {
            overflow-x: clip !important;
          }
        }

        ytd-watch-flexy[is-single-column] #primary,
        ytd-watch-flexy #primary {
          box-sizing: border-box !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 12px !important;
        }

        ytd-watch-flexy #primary-inner,
        ytd-watch-flexy #below,
        ytd-watch-flexy ytd-watch-metadata,
        ytd-watch-flexy #panels {
          box-sizing: border-box !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
        }

        ytd-watch-flexy ytd-menu-renderer,
        ytd-watch-flexy #actions,
        ytd-watch-flexy #actions-inner,
        ytd-watch-flexy #menu {
          max-width: 100% !important;
        }

        ytd-rich-grid-renderer {
          --ytd-rich-grid-items-per-row: 1 !important;
          --ytd-rich-grid-posts-per-row: 1 !important;
        }

        ytd-rich-grid-row,
        ytd-rich-item-renderer {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
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

        /*
         * History: Home-like equal gutters, centered cards/chips, title under
         * thumbnail, channel avatar restored, Clear/Pause/Manage/Search kept.
         */
        ytd-browse[page-subtype='history'],
        ytd-browse[${HISTORY_FEED_ATTR}='history'] {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100vw !important;
          overflow-x: hidden !important;
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
          min-width: 0 !important;
          max-width: 100vw !important;
          margin: 0 auto !important;
          padding: 0 12px !important;
          overflow-x: hidden !important;
        }

        ytd-browse[page-subtype='history'] #primary,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #primary,
        ytd-browse[page-subtype='history'] #secondary,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary,
        ytd-browse[page-subtype='history'] #secondary-inner,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary-inner,
        ytd-browse[page-subtype='history'] ytd-section-list-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-section-list-renderer,
        ytd-browse[page-subtype='history'] ytd-item-section-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-item-section-renderer,
        ytd-browse[page-subtype='history'] ytd-rich-grid-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-rich-grid-renderer,
        ytd-browse[page-subtype='history'] ytd-rich-grid-renderer #contents,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          ytd-rich-grid-renderer #contents {
          box-sizing: border-box !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin-left: auto !important;
          margin-right: auto !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }

        /* Keep History tools above the list and centered. */
        ytd-browse[page-subtype='history'] #secondary,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary,
        ytd-browse[page-subtype='history'] #secondary-inner,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary-inner,
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
          margin: 0 auto 8px !important;
          padding: 0 !important;
          text-align: center !important;
        }

        ytd-browse[page-subtype='history'] #secondary input,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary input,
        ytd-browse[page-subtype='history'] #secondary yt-searchbox,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary yt-searchbox,
        ytd-browse[page-subtype='history'] #secondary ytd-searchbox,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #secondary ytd-searchbox {
          box-sizing: border-box !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          font-size: 16px !important;
        }

        /* Center History filter chiplets. */
        ytd-browse[page-subtype='history'] yt-chip-cloud-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-chip-cloud-renderer,
        ytd-browse[page-subtype='history'] ytd-feed-filter-chip-bar-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          ytd-feed-filter-chip-bar-renderer,
        ytd-browse[page-subtype='history'] #chips,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #chips,
        ytd-browse[page-subtype='history'] #chips-wrapper,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #chips-wrapper,
        ytd-browse[page-subtype='history'] iron-selector#chips,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] iron-selector#chips {
          box-sizing: border-box !important;
          display: flex !important;
          flex-wrap: wrap !important;
          justify-content: center !important;
          align-items: center !important;
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 auto 8px !important;
          padding: 0 !important;
          text-align: center !important;
        }

        ytd-browse[page-subtype='history'] yt-chip-cloud-chip-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-chip-cloud-chip-renderer,
        ytd-browse[page-subtype='history'] yt-chip-cloud-chip-renderer chip-shape,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          yt-chip-cloud-chip-renderer chip-shape {
          margin-left: 4px !important;
          margin-right: 4px !important;
        }

        ytd-browse[page-subtype='history'] ytd-rich-grid-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-rich-grid-renderer {
          --ytd-rich-grid-items-per-row: 1 !important;
          --ytd-rich-grid-posts-per-row: 1 !important;
        }

        ytd-browse[page-subtype='history'] ytd-video-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-video-renderer,
        ytd-browse[page-subtype='history'] ytd-rich-item-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-rich-item-renderer,
        ytd-browse[page-subtype='history'] ytd-grid-video-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-grid-video-renderer {
          box-sizing: border-box !important;
          display: block !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin: 0 auto 12px !important;
          padding: 0 !important;
          text-align: center !important;
        }

        /* Classic History rows: stack thumbnail above title. */
        ytd-browse[page-subtype='history'] ytd-video-renderer #dismissible,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          ytd-video-renderer #dismissible {
          display: flex !important;
          flex-direction: column !important;
          align-items: stretch !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
        }

        /*
         * Modern History lockups use a multi-column CSS grid (thumb | title).
         * flex-direction on the custom element alone does nothing — collapse
         * the grid to one column and cap the content-image width.
         */
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
          grid-template-rows: auto !important;
          grid-auto-flow: row !important;
          align-items: stretch !important;
          justify-items: stretch !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin: 0 auto 12px !important;
          column-gap: 0 !important;
          row-gap: 8px !important;
          text-align: center !important;
        }

        /* Inner host div (when lockup wraps one) — same single-column stack. */
        ytd-browse[page-subtype='history'] yt-lockup-view-model > div,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-lockup-view-model > div {
          box-sizing: border-box !important;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) !important;
          grid-auto-flow: row !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin: 0 !important;
          column-gap: 0 !important;
          row-gap: 8px !important;
        }

        ytd-browse[page-subtype='history'] ytd-thumbnail,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-thumbnail,
        ytd-browse[page-subtype='history'] a#thumbnail,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] a#thumbnail,
        ytd-browse[page-subtype='history'] yt-thumbnail-view-model,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-thumbnail-view-model,
        ytd-browse[page-subtype='history']
          yt-lockup-view-model a[href*='/watch'],
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          yt-lockup-view-model a[href*='/watch'],
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
          box-sizing: border-box !important;
          display: block !important;
          grid-column: 1 !important;
          grid-row: auto !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin: 0 auto !important;
          aspect-ratio: 16 / 9 !important;
          height: auto !important;
          overflow: hidden !important;
          flex: none !important;
        }

        ytd-browse[page-subtype='history'] ytd-thumbnail img,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] ytd-thumbnail img,
        ytd-browse[page-subtype='history']
          yt-lockup-view-model a[href*='/watch'] img,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          yt-lockup-view-model a[href*='/watch'] img,
        ytd-browse[page-subtype='history']
          :is(
            .yt-lockup-view-model__content-image,
            .ytLockupViewModelContentImage
          )
          img,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          :is(
            .yt-lockup-view-model__content-image,
            .ytLockupViewModelContentImage
          )
          img {
          box-sizing: border-box !important;
          display: block !important;
          width: 100% !important;
          max-width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }

        ytd-browse[page-subtype='history'] #details,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #details,
        ytd-browse[page-subtype='history'] #meta,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #meta,
        ytd-browse[page-subtype='history']
          yt-lockup-metadata-view-model,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          yt-lockup-metadata-view-model,
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
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #video-title,
        ytd-browse[page-subtype='history'] a#video-title,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] a#video-title {
          box-sizing: border-box !important;
          display: block !important;
          grid-column: 1 !important;
          grid-row: auto !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin-left: auto !important;
          margin-right: auto !important;
          overflow: visible !important;
          text-align: center !important;
          text-overflow: unset !important;
          white-space: normal !important;
          -webkit-line-clamp: unset !important;
        }

        /* Restore channel logo + center it with the channel name. */
        ytd-browse[page-subtype='history'] #channel-info,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #channel-info,
        ytd-browse[page-subtype='history'] #channel-name,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #channel-name {
          box-sizing: border-box !important;
          display: inline-flex !important;
          visibility: visible !important;
          flex-direction: row !important;
          flex-wrap: wrap !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 8px !important;
          width: auto !important;
          max-width: 100% !important;
          margin: 4px auto 0 !important;
          text-align: center !important;
        }

        ytd-browse[page-subtype='history'] #avatar-link,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #avatar-link,
        ytd-browse[page-subtype='history'] yt-img-shadow#avatar,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-img-shadow#avatar,
        ytd-browse[page-subtype='history'] yt-decorated-avatar-view-model,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          yt-decorated-avatar-view-model,
        ytd-browse[page-subtype='history']
          a[href^='/@'] yt-img-shadow,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          a[href^='/@'] yt-img-shadow,
        ytd-browse[page-subtype='history']
          a[href*='/channel/'] yt-img-shadow,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          a[href*='/channel/'] yt-img-shadow {
          display: inline-flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          width: 36px !important;
          min-width: 36px !important;
          max-width: 36px !important;
          height: 36px !important;
          margin: 0 !important;
          overflow: hidden !important;
          border-radius: 50% !important;
        }

        ytd-browse[page-subtype='history'] #avatar-link img,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] #avatar-link img,
        ytd-browse[page-subtype='history'] yt-img-shadow#avatar img,
        ytd-browse[${HISTORY_FEED_ATTR}='history'] yt-img-shadow#avatar img,
        ytd-browse[page-subtype='history']
          yt-decorated-avatar-view-model img,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          yt-decorated-avatar-view-model img {
          display: block !important;
          visibility: visible !important;
          width: 36px !important;
          height: 36px !important;
          object-fit: cover !important;
        }

        ytd-browse[page-subtype='history']
          ytd-item-section-header-renderer,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          ytd-item-section-header-renderer,
        ytd-browse[page-subtype='history']
          ytd-item-section-header-renderer #title,
        ytd-browse[${HISTORY_FEED_ATTR}='history']
          ytd-item-section-header-renderer #title {
          width: 100% !important;
          max-width: 100% !important;
          margin-left: auto !important;
          margin-right: auto !important;
          text-align: center !important;
        }

        /*
         * Hide native masthead search chrome and use the extension overlay
         * everywhere. 16px input font prevents iOS keyboard zoom.
         */
        ytd-masthead,
        ytd-masthead #container,
        ytd-masthead #start,
        ytd-masthead #end {
          box-sizing: border-box !important;
          min-width: 0 !important;
          max-width: 100vw !important;
        }

        ytd-masthead #center,
        ytd-masthead #search-button,
        ytd-masthead #search-button-narrow,
        ytd-masthead #search-icon-legacy,
        ytd-masthead ytd-searchbox,
        ytd-masthead yt-searchbox,
        ytd-masthead button[aria-label='Search'],
        ytd-masthead [role='button'][aria-label='Search'],
        ytd-masthead yt-icon-button[aria-label='Search'] {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

      }

      /* Closed search trigger: black capsule, Search + Lucide icon centered. */
      #${SEARCH_TRIGGER_ID} {
        appearance: none !important;
        box-sizing: border-box !important;
        position: fixed !important;
        left: 50% !important;
        right: auto !important;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 14px) !important;
        top: auto !important;
        z-index: 2147483645 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        width: auto !important;
        min-width: 9.5rem !important;
        height: 48px !important;
        margin: 0 !important;
        padding: 0 1.35rem !important;
        color: #fff !important;
        background: #000 !important;
        border: 0 !important;
        border-radius: 999px !important;
        box-shadow: 0 8px 28px rgba(0, 0, 0, .45) !important;
        cursor: pointer !important;
        touch-action: manipulation !important;
        transform: translate3d(-50%, 0, 0) !important;
        -webkit-transform: translate3d(-50%, 0, 0) !important;
        font: 600 15px/1 "SF Pro Text", Roboto, system-ui, sans-serif !important;
        letter-spacing: .01em !important;
        transition:
          opacity .28s ease-in-out,
          transform .28s ease-in-out,
          visibility .28s ease-in-out !important;
      }

      html[${MOBILE_SEARCH_OPEN_ATTR}='true'] #${SEARCH_TRIGGER_ID} {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transform: translate3d(-50%, 10px, 0) !important;
        -webkit-transform: translate3d(-50%, 10px, 0) !important;
      }

      #${SEARCH_TRIGGER_ID} .fyp-search-trigger-label {
        display: inline-block !important;
        color: inherit !important;
        font: inherit !important;
        line-height: 1 !important;
        white-space: nowrap !important;
      }

      #${SEARCH_TRIGGER_ID} svg {
        display: block !important;
        width: 20px !important;
        height: 20px !important;
        flex: 0 0 auto !important;
        fill: none !important;
        stroke: currentColor !important;
        stroke-width: 2 !important;
        stroke-linecap: round !important;
        stroke-linejoin: round !important;
      }

      #${SEARCH_OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 12px;
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transition:
          opacity .28s ease-in-out,
          visibility .28s ease-in-out;
      }

      #${SEARCH_OVERLAY_ID}.is-open {
        pointer-events: auto;
        opacity: 1;
        visibility: visible;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, .52);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        opacity: 0;
        transition: opacity .28s ease-in-out;
      }

      #${SEARCH_OVERLAY_ID}.is-open .fyp-search-backdrop {
        opacity: 1;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-panel {
        position: relative;
        z-index: 1;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: min(100%, 28rem);
        margin-top: 0;
        padding: 4px;
        align-items: stretch;
        gap: 0;
        color: #fff;
        background: rgba(18, 18, 18, .96);
        border: 1px solid rgba(255, 255, 255, .2);
        border-radius: 24px;
        box-shadow: 0 10px 32px rgba(0, 0, 0, .45);
        transform: translateY(-12px) scale(.98);
        opacity: 0;
        overflow: hidden;
        transition:
          transform .28s ease-in-out,
          opacity .28s ease-in-out;
      }

      #${SEARCH_OVERLAY_ID}.is-open .fyp-search-panel {
        transform: translateY(0) scale(1);
        opacity: 1;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-row {
        display: flex;
        align-items: center;
        gap: 2px;
        width: 100%;
        min-height: 48px;
        padding: 0;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-icon-btn {
        appearance: none;
        box-sizing: border-box;
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        margin: 0;
        padding: 8px;
        color: #fff;
        background: transparent;
        border: 0;
        border-radius: 999px;
        cursor: pointer;
        touch-action: manipulation;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-icon-btn svg {
        display: block;
        width: 20px;
        height: 20px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-input {
        box-sizing: border-box;
        display: block;
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        height: 40px;
        margin: 0;
        padding: 0 8px;
        color: #fff;
        background: transparent;
        border: 0;
        outline: none;
        font-size: 16px;
        line-height: 40px;
        text-align: center;
        -webkit-appearance: none;
        appearance: none;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-input::-webkit-search-decoration,
      #${SEARCH_OVERLAY_ID} .fyp-search-input::-webkit-search-cancel-button {
        -webkit-appearance: none;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-suggestions {
        display: none;
        box-sizing: border-box;
        width: 100%;
        margin: 0;
        padding: 4px 4px 8px;
        list-style: none;
        max-height: min(48vh, 22rem);
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        border-top: 1px solid rgba(255, 255, 255, .1);
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-suggestions.is-visible {
        display: block;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-suggestions-label {
        padding: 8px 12px 4px;
        color: rgba(255, 255, 255, .55);
        font: 600 11px/1.2 "SF Pro Text", Roboto, system-ui, sans-serif;
        letter-spacing: .04em;
        text-transform: uppercase;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-suggestion {
        appearance: none;
        box-sizing: border-box;
        display: flex;
        width: 100%;
        min-height: 44px;
        margin: 0;
        padding: 0 10px;
        align-items: center;
        gap: 10px;
        color: #fff;
        background: transparent;
        border: 0;
        border-radius: 14px;
        text-align: left;
        font: 500 15px/1.25 "SF Pro Text", Roboto, system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-suggestion:active,
      #${SEARCH_OVERLAY_ID} .fyp-search-suggestion:focus-visible {
        background: rgba(255, 255, 255, .1);
        outline: none;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-suggestion svg {
        display: block;
        width: 18px;
        height: 18px;
        flex: 0 0 auto;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        opacity: .72;
      }

      #${SEARCH_OVERLAY_ID} .fyp-search-suggestion-text {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      ytd-comment-view-model[data-vm-comment-enhanced='true'],
      ytd-comment-renderer[data-vm-comment-enhanced='true'] {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        padding: clamp(.65rem, 2.8vw, 1rem) clamp(.6rem, 3vw, 1rem);
        border-bottom: 1px solid rgba(127, 127, 127, .2);
        touch-action: manipulation;
      }

      [data-vm-comment-enhanced='true'] > #toolbar,
      [data-vm-comment-enhanced='true'] #toolbar.ytd-comment-view-model,
      [data-vm-comment-enhanced='true'] #toolbar.ytd-comment-renderer {
        display: none !important;
      }

      .vm-yt-comment-actions {
        box-sizing: border-box;
        display: flex;
        width: 100%;
        margin-top: clamp(.45rem, 2vw, .75rem);
        gap: clamp(.4rem, 2vw, .75rem);
      }

      .vm-yt-comment-action {
        appearance: none;
        -webkit-appearance: none;
        box-sizing: border-box;
        display: inline-flex;
        flex: 1 1 50%;
        min-width: 0;
        min-height: 44px;
        padding: clamp(.55rem, 2.5vw, .75rem) clamp(.7rem, 3vw, 1rem);
        align-items: center;
        justify-content: center;
        gap: .4rem;
        color: inherit;
        background: rgba(127, 127, 127, .12);
        border: 1px solid rgba(127, 127, 127, .22);
        border-radius: clamp(.6rem, 3vw, .9rem);
        font: 600 clamp(.78rem, 3.2vw, .9rem)/1 Roboto, Arial, sans-serif;
        touch-action: manipulation;
      }

      .vm-yt-comment-action[data-pressed='true'] {
        color: #ff0033;
        background: rgba(255, 0, 51, .1);
        border-color: rgba(255, 0, 51, .32);
      }

      .vm-yt-comment-action svg {
        width: 1.15rem;
        height: 1.15rem;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 1.8;
      }

      ytd-comment-simplebox-renderer #placeholder-area,
      ytd-comment-simplebox-renderer #simplebox-placeholder {
        box-sizing: border-box;
        min-height: 44px;
        padding: clamp(.7rem, 3vw, 1rem) !important;
        touch-action: manipulation;
      }

      ytd-commentbox textarea,
      ytd-commentbox input,
      ytd-commentbox #contenteditable-root,
      ytd-commentbox [contenteditable='true'],
      ytd-comment-replies-renderer textarea,
      ytd-comment-replies-renderer input,
      ytd-comment-replies-renderer #contenteditable-root,
      ytd-comment-replies-renderer [contenteditable='true'] {
        font-size: 16px !important;
      }

      ytd-comments#comments,
      ytd-comments {
        width: 100% !important;
        max-width: 100% !important;
        margin: clamp(.35rem, 1.5vw, .75rem) 0 0 !important;
        order: 3 !important;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} {
        box-sizing: border-box;
        position: relative;
        z-index: 5;
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        flex-wrap: wrap;
        width: fit-content;
        max-width: 100%;
        min-width: 0;
        margin: clamp(.5rem, 2.4vw, .8rem) auto;
        padding: clamp(.35rem, 1.8vw, .55rem);
        gap: clamp(.25rem, 1.4vw, .55rem);
        justify-content: center;
        align-items: center;
        border: 1px solid rgba(255, 255, 255, .14);
        border-radius: clamp(.85rem, 4vw, 1.2rem);
        background: rgba(255, 255, 255, .08);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        overflow: visible;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control {
        appearance: none;
        box-sizing: border-box;
        display: inline-flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        flex: 0 0 auto;
        width: clamp(2.45rem, 11vw, 3rem);
        min-width: 0;
        height: clamp(2.35rem, 10vw, 2.85rem);
        margin: 0;
        padding: clamp(.48rem, 2.2vw, .7rem);
        align-items: center;
        justify-content: center;
        color: #fff;
        background: rgba(255, 255, 255, .12);
        border: 1px solid rgba(255, 255, 255, .12);
        border-radius: 999px;
        cursor: pointer;
        touch-action: manipulation;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID}
        .fyp-player-control[data-fyp-player-action='play-pause'] {
        color: #0f0f0f;
        background: #fff;
        border-color: #fff;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID}
        .fyp-player-control[aria-pressed='true']:not(
          [data-fyp-player-action='play-pause']
        ) {
        color: #fff;
        background: #ff0033;
        border-color: #ff0033;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:active {
        transform: scale(.92);
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg {
        display: block;
        width: 100%;
        height: 100%;
        max-width: clamp(1.05rem, 4.8vw, 1.35rem);
        max-height: clamp(1.05rem, 4.8vw, 1.35rem);
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID}
        .fyp-player-control[data-fyp-player-action='play-pause'] svg {
        fill: currentColor;
      }

      #movie_player .ytp-settings-button,
      .html5-video-player .ytp-settings-button,
      #movie_player .ytp-overflow-button,
      .html5-video-player .ytp-overflow-button,
      #movie_player .ytp-more-button,
      .html5-video-player .ytp-more-button {
        display: none !important;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu {
        box-sizing: border-box;
        flex: 1 0 100%;
        display: flex;
        flex-direction: column;
        width: min(100vw - 24px, 22rem);
        min-width: 0;
        max-height: min(42svh, 18rem);
        margin-top: clamp(.15rem, .8vw, .3rem);
        padding: clamp(.4rem, 2vw, .65rem);
        gap: clamp(.25rem, 1vw, .4rem);
        color: #fff;
        background: rgba(15, 15, 15, .97);
        border: 1px solid rgba(255, 255, 255, .16);
        border-radius: clamp(.75rem, 3vw, 1rem);
        box-shadow: 0 .75rem 2rem rgba(0, 0, 0, .45);
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        touch-action: pan-y;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-collapse {
        appearance: none;
        box-sizing: border-box;
        align-self: center;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: clamp(2.6rem, 12vw, 3.1rem);
        min-height: clamp(1.7rem, 7vw, 2rem);
        margin: 0;
        padding: 0;
        color: rgba(255, 255, 255, .88);
        background: rgba(255, 255, 255, .08);
        border: 1px solid rgba(255, 255, 255, .14);
        border-radius: 999px;
        touch-action: manipulation;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-collapse svg {
        display: block;
        width: clamp(1.05rem, 4.5vw, 1.25rem);
        height: clamp(1.05rem, 4.5vw, 1.25rem);
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-title {
        padding: clamp(.25rem, 1vw, .4rem) clamp(.7rem, 3vw, .95rem);
        color: rgba(255, 255, 255, .72);
        font: 700 clamp(.78rem, 3.2vw, .9rem)/1.2 Roboto, Arial, sans-serif;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option {
        appearance: none;
        box-sizing: border-box;
        width: 100%;
        min-height: clamp(2.45rem, 10vw, 2.9rem);
        margin: 0;
        padding: 0 clamp(.75rem, 3vw, 1rem);
        color: #fff;
        background: rgba(255, 255, 255, .09);
        border: 1px solid transparent;
        border-radius: clamp(.6rem, 2.5vw, .8rem);
        text-align: left;
        font: 600 clamp(.8rem, 3.4vw, .95rem)/1.25 Roboto, Arial, sans-serif;
        touch-action: pan-y;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID}
        .fyp-player-menu-option[aria-checked='true'] {
        background: #ff0033;
        border-color: #ff0033;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option:disabled {
        opacity: .55;
      }

      #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-menu-option:focus-visible {
        outline: 2px solid #fff;
        outline-offset: -2px;
      }

      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-bottom,
      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-top,
      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-bottom,
      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-top {
        visibility: visible !important;
        opacity: 1 !important;
        transform: translateY(0) !important;
      }

      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-bottom,
      .html5-video-player[data-fyp-controls-visible='true'] .ytp-chrome-top {
        pointer-events: auto !important;
      }

      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-bottom,
      .html5-video-player[data-fyp-controls-visible='true'] .ytp-gradient-top {
        pointer-events: none !important;
      }

      /*
       * Orion/WebKit may render the native WebVTT cue at the same time as
       * YouTube's custom caption DOM. Hide only the native cue while a custom
       * YouTube caption segment exists, leaving YouTube's caption layer intact.
       */
      .html5-video-player:has(
        .ytp-caption-window-container .ytp-caption-segment
      ) video::cue,
      video[data-fyp-native-captions-hidden='true']::cue {
        visibility: hidden !important;
        opacity: 0 !important;
        color: transparent !important;
        background: transparent !important;
        text-shadow: none !important;
      }

      .html5-video-player:has(
        .ytp-caption-window-container .ytp-caption-segment
      ) video::-webkit-media-text-track-container,
      .html5-video-player:has(
        .ytp-caption-window-container .ytp-caption-segment
      ) video::-webkit-media-text-track-display,
      video[data-fyp-native-captions-hidden='true']::-webkit-media-text-track-container,
      video[data-fyp-native-captions-hidden='true']::-webkit-media-text-track-display {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }

      @media (hover: none) {
        tp-yt-paper-tooltip,
        yt-tooltip-renderer {
          display: none !important;
          pointer-events: none !important;
        }
      }

      /* Floating pill removed — navigation is burger/guide only. */
      #${NAV_ID} {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      ytd-app,
      ytm-app {
        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 4.75rem) !important;
      }

      #${WELCOME_ID} {
        box-sizing: border-box;
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + clamp(3.5rem, 10svh, 5rem));
        left: 50%;
        z-index: 2147483647;
        width: min(calc(100% - 2rem), 22rem);
        padding: clamp(.75rem, 2.8vw, 1rem) clamp(1rem, 4vw, 1.35rem);
        color: #fff;
        background: rgba(15, 15, 15, .96);
        border: 1px solid rgba(255, 255, 255, .18);
        border-radius: clamp(.65rem, 3vw, 1rem);
        box-shadow: 0 .5rem 1.5rem rgba(0, 0, 0, .28);
        font: 600 clamp(.9rem, 3.8vw, 1.05rem)/1.3 Roboto, Arial, sans-serif;
        text-align: center;
        transform: translateX(-50%);
        opacity: 1;
        transition: opacity .22s ease, transform .22s ease;
      }

      #${WELCOME_ID}[data-hiding='true'] {
        opacity: 0;
        transform: translate(-50%, -.45rem);
        pointer-events: none;
      }

      /* Only the action to subscribe is red; an already-subscribed button is untouched. */
      button[data-vm-subscribe-action='true'],
      [role='button'][data-vm-subscribe-action='true'] {
        color: #fff !important;
        background-color: #ff0033 !important;
        background-image: none !important;
        border-color: #ff0033 !important;
        box-shadow: none !important;
      }

      [data-vm-subscribe-action='true'] .yt-spec-button-shape-next__button-text-content {
        color: #fff !important;
      }

      .ytp-fullscreen-quick-actions button[aria-label^='Ask'],
      #movie_player button[aria-label*='Ask Gemini'],
      ytd-watch-metadata button[aria-label^='Ask'],
      ytd-watch-metadata [title^='Ask Gemini'] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

    `;
  }

  /* Lucide icon paths — Home, ListVideo, CircleUser. Shorts + Create omitted. */
  const MOBILE_NAV_ITEMS = [
    {
      id: 'home',
      label: 'Home',
      href: '/',
      active: (path) => path === '/' || path === '',
      icon: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    },
    {
      id: 'subscriptions',
      label: 'Subs',
      href: '/feed/subscriptions',
      active: (path) => path.startsWith('/feed/subscriptions'),
      icon: '<path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/><path d="m16 12 5 3-5 3v-6Z"/>',
    },
    {
      id: 'you',
      label: 'You',
      href: '/feed/you',
      active: (path) =>
        path.startsWith('/feed/you') ||
        path.startsWith('/feed/library') ||
        path.startsWith('/account'),
      icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>',
    },
  ];

  function setImportantStyles(element, declarations) {
    if (!element) return;
    for (const [property, value] of Object.entries(declarations)) {
      element.style.setProperty(property, value, 'important');
    }
  }

  function isDarkTheme() {
    return Boolean(
      document.documentElement.hasAttribute('dark') ||
      document.documentElement.hasAttribute('dark-theme') ||
      document.body?.hasAttribute('dark') ||
      document.querySelector('ytd-app[dark], ytm-app[dark]') ||
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
    );
  }

  function applyCriticalNavigationLayout(nav) {
    const dark = isDarkTheme();
    // Orion iOS: browser chrome is outside the webview — keep a tight safe-area gap.
    const clearance = `calc(env(safe-area-inset-bottom, 0px) + ${ORION_NAV_GAP})`;
    setImportantStyles(nav, {
      'box-sizing': 'border-box',
      position: 'fixed',
      top: 'auto',
      right: 'auto',
      bottom: clearance,
      left: '50%',
      'z-index': '2147483646',
      display: 'flex',
      'flex-direction': 'row',
      width: 'min(calc(100% - 28px), 352px)',
      height: 'auto',
      'min-height': '56px',
      margin: '0',
      'padding-top': '5px',
      'padding-right': '6px',
      'padding-bottom': '5px',
      'padding-left': '6px',
      'align-items': 'stretch',
      'justify-content': 'space-around',
      gap: '2px',
      color: dark ? '#f1f1f1' : '#0f0f0f',
      background: dark ? 'rgba(28, 28, 28, .9)' : 'rgba(255, 255, 255, .9)',
      border: dark
        ? '1px solid rgba(255, 255, 255, .12)'
        : '1px solid rgba(0, 0, 0, .1)',
      'border-radius': '999px',
      'box-shadow': dark
        ? '0 6px 22px rgba(0, 0, 0, .45)'
        : '0 6px 20px rgba(0, 0, 0, .18)',
      'font-family': '"SF Pro Text", Roboto, system-ui, sans-serif',
      overflow: 'hidden',
      'pointer-events': 'auto',
      transform: 'translate3d(-50%, 0, 0)',
      '-webkit-transform': 'translate3d(-50%, 0, 0)',
      '-webkit-backdrop-filter': 'saturate(1.4) blur(18px)',
      'backdrop-filter': 'saturate(1.4) blur(18px)',
      '-webkit-user-select': 'none',
      'user-select': 'none',
    });

    for (const link of nav.querySelectorAll('.vm-yt-nav-item')) {
      setImportantStyles(link, {
        'box-sizing': 'border-box',
        display: 'flex',
        flex: '1 1 33%',
        'flex-direction': 'column',
        'min-width': '0',
        'min-height': '48px',
        margin: '0',
        padding: '4px 2px',
        'align-items': 'center',
        'justify-content': 'center',
        gap: '3px',
        background: 'transparent',
        border: '0',
        'border-radius': '999px',
        'text-decoration': 'none',
        cursor: 'pointer',
      });

      const iconWrap = link.querySelector('.vm-yt-nav-icon-wrap');
      if (iconWrap) {
        setImportantStyles(iconWrap, {
          display: 'flex',
          width: 'auto',
          height: 'auto',
          'align-items': 'center',
          'justify-content': 'center',
          color: 'inherit',
          background: 'transparent',
          'border-radius': '999px',
        });
      }

      setImportantStyles(link.querySelector('.vm-yt-nav-icon'), {
        display: 'block',
        width: '22px',
        height: '22px',
        flex: '0 0 auto',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-width': '2',
      });

      const label = link.querySelector('.vm-yt-nav-label');
      if (label) {
        setImportantStyles(label, {
          display: 'block',
          'max-width': '100%',
          overflow: 'hidden',
          'font-size': '10px',
          'font-weight': '500',
          'line-height': '1.1',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        });
      }
    }

    for (const app of document.querySelectorAll('ytd-app, ytm-app')) {
      setImportantStyles(app, {
        width: '100%',
        'min-width': '0',
        'padding-bottom': `calc(${clearance} + 64px)`,
      });
    }
  }

  function hideShortsGuideEntries(root = document) {
    const entries = root.querySelectorAll?.(
      'ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ytm-pivot-bar-item-renderer, ' +
        'tp-yt-paper-item, yt-list-item-view-model'
    ) || [];

    for (const entry of entries) {
      const href = [
        entry.querySelector?.('a#endpoint')?.getAttribute('href'),
        entry.querySelector?.('a')?.getAttribute('href'),
        entry.getAttribute?.('href'),
      ]
        .filter(Boolean)
        .join(' ');
      const label = [
        entry.getAttribute?.('title'),
        entry.querySelector?.('[title]')?.getAttribute('title'),
        entry.querySelector?.('a#endpoint')?.getAttribute('title'),
        entry.querySelector?.('yt-formatted-string')?.textContent,
        entry.querySelector?.('.title')?.textContent,
        entry.getAttribute?.('aria-label'),
        entry.querySelector?.('[aria-label]')?.getAttribute('aria-label'),
        entry.textContent,
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      const isShorts =
        /\/shorts\b/i.test(href) ||
        /^shorts\b/i.test(label) ||
        (/\bshorts\b/i.test(label) && label.length < 48) ||
        /tab_shorts|shorts_fill|shorts_outline/i.test(
          entry.innerHTML?.slice?.(0, 500) || ''
        );

      if (!isShorts) continue;

      setImportantStyles(entry, {
        display: 'none',
        visibility: 'hidden',
        'pointer-events': 'none',
        height: '0',
        margin: '0',
        padding: '0',
        overflow: 'hidden',
      });
      entry.setAttribute('aria-hidden', 'true');
      entry.hidden = true;
      entry.dataset.vmShortsHidden = 'true';
    }
  }

  function hideNativeNavigationAndShorts() {
    for (const element of document.querySelectorAll(
      [
        'ytm-pivot-bar-renderer',
        'ytd-mini-guide-renderer',
        'ytd-mini-guide-entry-renderer',
        'ytd-reel-shelf-renderer',
        'ytm-reel-shelf-renderer',
        'ytm-shorts-lockup-view-model',
        'ytm-shorts-lockup-view-model-v2',
        'ytd-reel-item-renderer',
        'ytm-reel-item-renderer',
      ].join(',')
    )) {
      setImportantStyles(element, {
        display: 'none',
        visibility: 'hidden',
        'pointer-events': 'none',
      });
      element.setAttribute('aria-hidden', 'true');
      element.hidden = true;
    }

    for (const element of document.querySelectorAll(
      'ytd-rich-shelf-renderer, ytd-rich-section-renderer, grid-shelf-view-model'
    )) {
      const isShortsShelf =
        Boolean(element.querySelector?.('a[href*="/shorts"]')) ||
        /shorts/i.test(
          (element.querySelector?.('#title, .title, yt-formatted-string')
            ?.textContent || '')
            .trim()
        );
      if (!isShortsShelf) continue;
      setImportantStyles(element, {
        display: 'none',
        visibility: 'hidden',
        'pointer-events': 'none',
      });
      element.hidden = true;
    }

    const possibleShortsControls = document.querySelectorAll([
      '.pivot-shorts',
      'a[href^="/shorts"]',
      'a[href*="/shorts"]',
      'a[href*="youtube.com/shorts"]',
      '[aria-label="Shorts"]',
      '[title="Shorts"]',
      '[is-shorts]',
    ].join(','));

    for (const control of possibleShortsControls) {
      const item =
        control.closest(
          'ytm-pivot-bar-item-renderer, ytd-guide-entry-renderer, ' +
            'ytd-mini-guide-entry-renderer, yt-tab-shape, [role="tab"], ' +
            'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ' +
            'ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-rich-section-renderer, ' +
            'ytd-reel-item-renderer, ytm-reel-item-renderer, ' +
            'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ' +
            'yt-lockup-view-model, tp-yt-paper-item'
        ) || control;
      setImportantStyles(item, {
        display: 'none',
        visibility: 'hidden',
        'pointer-events': 'none',
      });
      item.setAttribute('aria-hidden', 'true');
      item.hidden = true;
    }

    hideShortsGuideEntries(document);
  }

  function blockShortsNavigation(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a[href*="/shorts"]');
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);
  }

  function isSearchOverlayOpen() {
    return document.documentElement.getAttribute(MOBILE_SEARCH_OPEN_ATTR) === 'true';
  }

  function closeMobileSearch() {
    const overlay = document.getElementById(SEARCH_OVERLAY_ID);
    const trigger = document.getElementById(SEARCH_TRIGGER_ID);
    document.documentElement.removeAttribute(MOBILE_SEARCH_OPEN_ATTR);
    trigger?.setAttribute('aria-expanded', 'false');
    if (searchSuggestTimer) {
      clearTimeout(searchSuggestTimer);
      searchSuggestTimer = null;
    }
    if (!(overlay instanceof HTMLElement)) return;
    overlay.classList.remove('is-open');
    const finalize = () => {
      if (!isSearchOverlayOpen()) overlay.hidden = true;
    };
    overlay.addEventListener('transitionend', finalize, { once: true });
    setTimeout(finalize, 320);
  }

  function readRecentSearches() {
    try {
      const raw = localStorage.getItem(SEARCH_RECENTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, SEARCH_RECENTS_MAX);
    } catch {
      return [];
    }
  }

  function writeRecentSearches(items) {
    try {
      localStorage.setItem(
        SEARCH_RECENTS_KEY,
        JSON.stringify(items.slice(0, SEARCH_RECENTS_MAX))
      );
    } catch {
      // Private mode / quota — ignore.
    }
  }

  function rememberRecentSearch(query) {
    const normalized = String(query || '').trim();
    if (!normalized) return;
    const next = [
      normalized,
      ...readRecentSearches().filter(
        (item) => item.toLowerCase() !== normalized.toLowerCase()
      ),
    ].slice(0, SEARCH_RECENTS_MAX);
    writeRecentSearches(next);
  }

  function searchOverlayMarkup() {
    return (
      `<div class="fyp-search-backdrop" data-fyp-search-action="close"></div>` +
      `<div class="fyp-search-panel" role="dialog" aria-label="Search YouTube">` +
      `<div class="fyp-search-row">` +
      `<button type="button" class="fyp-search-icon-btn" data-fyp-search-action="close" ` +
      `aria-label="Close search" title="Close">${PLAYER_CONTROL_ICONS.close}</button>` +
      `<input type="search" class="fyp-search-input" enterkeyhint="search" ` +
      `autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" ` +
      `placeholder="Search YouTube" aria-label="Search YouTube" />` +
      `<button type="button" class="fyp-search-icon-btn" data-fyp-search-action="submit" ` +
      `aria-label="Search" title="Search">${PLAYER_CONTROL_ICONS.search}</button>` +
      `</div>` +
      `<div class="fyp-search-suggestions" role="listbox" aria-label="Search suggestions"></div>` +
      `</div>`
    );
  }

  function ensureSearchOverlay() {
    let overlay = document.getElementById(SEARCH_OVERLAY_ID);
    if (
      overlay instanceof HTMLElement &&
      overlay.dataset.fypSearchOverlayLayout === SEARCH_OVERLAY_LAYOUT_VERSION
    ) {
      return overlay;
    }
    if (overlay instanceof HTMLElement) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = SEARCH_OVERLAY_ID;
    overlay.hidden = true;
    overlay.dataset.fypSearchOverlayLayout = SEARCH_OVERLAY_LAYOUT_VERSION;
    overlay.innerHTML = searchOverlayMarkup();
    const input = overlay.querySelector('.fyp-search-input');
    if (input instanceof HTMLInputElement) {
      input.addEventListener('input', handleMobileSearchInput);
      input.addEventListener('focus', () => {
        refreshSearchSuggestions(input.value);
      });
    }
    (document.body || document.documentElement).appendChild(overlay);
    return overlay;
  }

  function ensureSearchTrigger() {
    const host = document.body || document.documentElement;
    if (!(host instanceof Element)) return;

    let trigger = document.getElementById(SEARCH_TRIGGER_ID);
    if (!(trigger instanceof HTMLButtonElement)) {
      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.id = SEARCH_TRIGGER_ID;
      trigger.className = 'fyp-search-trigger';
      trigger.setAttribute('aria-label', 'Search');
      trigger.title = 'Search';
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-expanded', 'false');
    }

    if (trigger.dataset.fypSearchLayout !== SEARCH_TRIGGER_LAYOUT_VERSION) {
      trigger.dataset.fypSearchLayout = SEARCH_TRIGGER_LAYOUT_VERSION;
      trigger.innerHTML =
        `<span class="fyp-search-trigger-label">Search</span>` +
        PLAYER_CONTROL_ICONS.search;
    }

    if (trigger.parentElement !== host) {
      host.appendChild(trigger);
    }
  }

  function renderSearchSuggestions(items, mode) {
    const overlay = document.getElementById(SEARCH_OVERLAY_ID);
    const list = overlay?.querySelector('.fyp-search-suggestions');
    if (!(list instanceof HTMLElement)) return;

    const rows = Array.isArray(items) ? items.slice(0, SEARCH_SUGGEST_MAX) : [];
    if (!rows.length) {
      list.classList.remove('is-visible');
      list.innerHTML = '';
      return;
    }

    const label = mode === 'suggest' ? 'Suggestions' : 'Recent searches';
    const icon =
      mode === 'suggest'
        ? PLAYER_CONTROL_ICONS.search
        : PLAYER_CONTROL_ICONS.recent;
    list.innerHTML =
      `<div class="fyp-search-suggestions-label">${label}</div>` +
      rows
        .map((query) => {
          const safe = String(query)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
          return (
            `<button type="button" class="fyp-search-suggestion" role="option" ` +
            `data-fyp-search-action="suggest" data-fyp-search-query="${safe}">` +
            `${icon}<span class="fyp-search-suggestion-text">${safe}</span>` +
            `</button>`
          );
        })
        .join('');
    list.classList.add('is-visible');
  }

  function fetchYouTubeSuggestions(query) {
    const q = String(query || '').trim();
    if (!q) return Promise.resolve([]);

    return new Promise((resolve) => {
      const callbackName = `__fypSearchSuggest_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      let settled = false;
      const finish = (items) => {
        if (settled) return;
        settled = true;
        try {
          delete window[callbackName];
        } catch {
          window[callbackName] = undefined;
        }
        script.remove();
        resolve(Array.isArray(items) ? items : []);
      };

      window[callbackName] = (payload) => {
        const list = Array.isArray(payload?.[1]) ? payload[1] : [];
        const suggestions = list
          .map((entry) => {
            if (typeof entry === 'string') return entry;
            if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0];
            return '';
          })
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, SEARCH_SUGGEST_MAX);
        finish(suggestions);
      };

      const script = document.createElement('script');
      script.async = true;
      script.src =
        'https://suggestqueries.google.com/complete/search' +
        `?client=youtube&ds=yt&q=${encodeURIComponent(q)}&callback=${callbackName}`;
      script.onerror = () => finish([]);
      setTimeout(() => finish([]), 1800);
      (document.head || document.documentElement).appendChild(script);
    });
  }

  async function refreshSearchSuggestions(rawQuery) {
    const query = String(rawQuery || '').trim();
    const requestId = ++searchSuggestRequestId;

    if (!query) {
      renderSearchSuggestions(readRecentSearches(), 'recent');
      return;
    }

    const suggestions = await fetchYouTubeSuggestions(query);
    if (requestId !== searchSuggestRequestId || !isSearchOverlayOpen()) return;

    if (suggestions.length) {
      renderSearchSuggestions(suggestions, 'suggest');
      return;
    }

    const recents = readRecentSearches().filter((item) =>
      item.toLowerCase().includes(query.toLowerCase())
    );
    renderSearchSuggestions(recents, 'recent');
  }

  function handleMobileSearchInput(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (searchSuggestTimer) clearTimeout(searchSuggestTimer);
    searchSuggestTimer = setTimeout(() => {
      searchSuggestTimer = null;
      refreshSearchSuggestions(input.value);
    }, 160);
  }

  function openMobileSearch() {
    ensureSearchTrigger();
    const overlay = ensureSearchOverlay();
    const trigger = document.getElementById(SEARCH_TRIGGER_ID);
    const input = overlay.querySelector('.fyp-search-input');
    overlay.hidden = false;
    document.documentElement.setAttribute(MOBILE_SEARCH_OPEN_ATTR, 'true');
    trigger?.setAttribute('aria-expanded', 'true');
    refreshSearchSuggestions(
      input instanceof HTMLInputElement ? input.value : ''
    );
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      if (input instanceof HTMLInputElement) {
        try {
          input.focus({ preventScroll: true });
        } catch {
          input.focus();
        }
        const end = input.value.length;
        input.setSelectionRange?.(end, end);
      }
    });
  }

  function submitMobileSearch(forcedQuery) {
    const overlay = document.getElementById(SEARCH_OVERLAY_ID);
    const input = overlay?.querySelector('.fyp-search-input');
    const query =
      typeof forcedQuery === 'string' && forcedQuery.trim()
        ? forcedQuery.trim()
        : input instanceof HTMLInputElement
          ? input.value.trim()
          : '';
    if (!query) {
      if (input instanceof HTMLInputElement) {
        try {
          input.focus({ preventScroll: true });
        } catch {
          input.focus();
        }
      }
      return;
    }
    if (input instanceof HTMLInputElement) input.value = query;
    rememberRecentSearch(query);
    const target = new URL('https://www.youtube.com/results');
    target.searchParams.set('search_query', query);
    target.searchParams.set('app', 'desktop');
    target.searchParams.set('persist_app', '1');
    closeMobileSearch();
    location.assign(target.href);
  }

  function handleMobileSearchClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const trigger = target.closest(`#${SEARCH_TRIGGER_ID}`);
    if (trigger) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isSearchOverlayOpen()) closeMobileSearch();
      else openMobileSearch();
      return;
    }

    const actionNode = target.closest('[data-fyp-search-action]');
    if (actionNode instanceof HTMLElement) {
      const action = actionNode.dataset.fypSearchAction;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === 'close') closeMobileSearch();
      else if (action === 'submit') submitMobileSearch();
      else if (action === 'suggest') {
        submitMobileSearch(actionNode.dataset.fypSearchQuery || '');
      }
      return;
    }

    // Block native search chrome so it cannot fight the overlay.
    if (target.closest(NATIVE_SEARCH_HIDE_SELECTOR)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openMobileSearch();
    }
  }

  function handleMobileSearchKeydown(event) {
    if (event.key === 'Escape' && isSearchOverlayOpen()) {
      event.preventDefault();
      closeMobileSearch();
      return;
    }
    if (event.key !== 'Enter') return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.classList.contains('fyp-search-input')
    ) {
      event.preventDefault();
      submitMobileSearch();
    }
  }

  function dismissMiniplayer() {
    const app = document.querySelector('ytd-app');
    if (app) {
      app.removeAttribute('miniplayer-active_');
      app.removeAttribute('miniplayer-active');
      try {
        if ('miniplayerActive_' in app) app.miniplayerActive_ = false;
        if ('miniplayerActive' in app) app.miniplayerActive = false;
      } catch {
        // ignore
      }
    }

    for (const mini of document.querySelectorAll(
      'ytd-miniplayer, #miniplayer, #miniplayer-container'
    )) {
      setImportantStyles(mini, {
        display: 'none',
        visibility: 'hidden',
        'pointer-events': 'none',
        opacity: '0',
        width: '0',
        height: '0',
      });
      mini.removeAttribute('active');
      mini.removeAttribute('enabled');
      try {
        if (typeof mini.minimize === 'function') {
          // no-op path
        }
        if ('active' in mini) mini.active = false;
      } catch {
        // ignore
      }
    }

    document
      .querySelectorAll(
        '.ytp-miniplayer-close-button, ytd-miniplayer button[aria-label*="Close"], ' +
          '#miniplayer button[aria-label*="Close"]'
      )
      .forEach((button) => {
        if (button instanceof HTMLElement) {
          try {
            button.click();
          } catch {
            // ignore
          }
        }
      });
  }

  function removeFloatingPillNav() {
    const nav = document.getElementById(NAV_ID);
    if (nav) nav.remove();
  }

  function applySafeBottomSpacing() {
    for (const app of document.querySelectorAll('ytd-app, ytm-app')) {
      setImportantStyles(app, {
        'padding-bottom': 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)',
        '--ytd-mini-guide-width': '0px',
        '--ytd-mini-guide-width-min': '0px',
      });
    }
  }

  function lockGuideToTapOnly() {
    for (const mini of document.querySelectorAll('ytd-mini-guide-renderer')) {
      setImportantStyles(mini, {
        display: 'none',
        visibility: 'hidden',
        'pointer-events': 'none',
      });
    }

    for (const app of document.querySelectorAll('ytd-app')) {
      setImportantStyles(app, {
        '--ytd-mini-guide-width': '0px',
        '--ytd-mini-guide-width-min': '0px',
      });
    }

    for (const drawer of document.querySelectorAll('tp-yt-app-drawer#guide, #guide')) {
      hideShortsGuideEntries(drawer);
    }

    hideShortsGuideEntries(document);
  }

  function ensureGuideButtonVisible() {
    const candidates = document.querySelectorAll([
      '#guide-button',
      'ytd-masthead #guide-button',
      'ytd-masthead button[aria-label="Guide"]',
      'ytd-masthead button[aria-label*="Guide"]',
      'ytd-masthead yt-icon-button#guide-button',
      'button[aria-label="Guide"]',
      'button[aria-label*="Guide"]',
    ].join(','));

    for (const button of candidates) {
      button.removeAttribute('hidden');
      button.setAttribute('aria-hidden', 'false');
      setImportantStyles(button, {
        display: 'inline-flex',
        visibility: 'visible',
        opacity: '1',
        'pointer-events': 'auto',
        width: '40px',
        'min-width': '40px',
        height: '40px',
      });
      const icon = button.querySelector('yt-icon, .yt-icon-button, svg');
      if (icon) {
        setImportantStyles(icon, {
          display: 'block',
          visibility: 'visible',
          opacity: '1',
        });
      }
    }

    lockGuideToTapOnly();
  }

  function hideUploadControls(root = document) {
    const selectors = [
      'ytd-masthead a[href="/upload"]',
      'ytd-masthead a[href*="upload?"]',
      'ytd-masthead a[href*="/upload"]',
      'ytd-masthead button[aria-label="Create"]',
      'ytd-masthead button[aria-label*="Create a video"]',
      'ytd-masthead button[aria-label="Upload"]',
      'ytd-masthead button[aria-label="Upload video"]',
      'ytd-masthead [aria-label="Create"]',
      'ytd-masthead [aria-label="Upload video"]',
      '#masthead-upload-button',
      'ytm-mobile-topbar-renderer button[aria-label*="Upload"]',
      'ytm-mobile-topbar-renderer button[aria-label*="Create"]',
      'ytm-mobile-topbar-renderer a[href*="upload"]',
    ].join(',');

    for (const control of root.querySelectorAll?.(selectors) || []) {
      const host =
        control.closest(
          'ytd-topbar-menu-button-renderer, ytd-button-renderer, ' +
            'ytm-topbar-menu-button-renderer, yt-icon-button, button-view-model'
        ) || control;
      setImportantStyles(host, {
        display: 'none',
        visibility: 'hidden',
        'pointer-events': 'none',
        width: '0',
        'min-width': '0',
        margin: '0',
        padding: '0',
        overflow: 'hidden',
      });
      host.setAttribute('aria-hidden', 'true');
      host.hidden = true;
    }

    // Fallback: match by label text when YouTube changes aria attributes.
    for (const candidate of root.querySelectorAll?.(
      'ytd-masthead button, ytd-masthead a, ytm-mobile-topbar-renderer button, ytm-mobile-topbar-renderer a'
    ) || []) {
      const label = [
        candidate.getAttribute('aria-label'),
        candidate.getAttribute('title'),
        candidate.textContent,
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (!label) continue;
      if (
        !/^(create|upload)(\b|$)/.test(label) &&
        !label.includes('upload video') &&
        !label.includes('create a video') &&
        !label.includes('create video or post')
      ) {
        continue;
      }
      const host =
        candidate.closest(
          'ytd-topbar-menu-button-renderer, ytd-button-renderer, ' +
            'ytm-topbar-menu-button-renderer, yt-icon-button, button-view-model'
        ) || candidate;
      setImportantStyles(host, {
        display: 'none',
        visibility: 'hidden',
        'pointer-events': 'none',
      });
      host.hidden = true;
    }
  }

  function markHistoryFeedBrowse() {
    const browse = document.querySelector('ytd-browse');
    if (!(browse instanceof HTMLElement)) return;
    if (location.pathname.startsWith('/feed/history')) {
      browse.setAttribute(HISTORY_FEED_ATTR, 'history');
    } else if (browse.getAttribute(HISTORY_FEED_ATTR) === 'history') {
      browse.removeAttribute(HISTORY_FEED_ATTR);
    }
  }

  function applyMobileShell() {
    hideNativeNavigationAndShorts();
    ensureGuideButtonVisible();
    hideUploadControls();
    dismissMiniplayer();
    removeFloatingPillNav();
    applySafeBottomSpacing();
    markHistoryFeedBrowse();

    for (const video of document.querySelectorAll('video')) {
      enforceInlinePlayback(video);
    }
  }

  function findCommentsRoot() {
    const watch = document.querySelector('ytd-watch-flexy');
    return (
      watch?.querySelector('ytd-comments#comments') ||
      watch?.querySelector('#comments ytd-comments') ||
      watch?.querySelector('ytd-comments') ||
      document.querySelector('ytd-comments#comments') ||
      document.querySelector('#comments') ||
      document.querySelector('ytd-comments')
    );
  }

  function positionCommentsAfterRecommendations() {
    if (location.pathname !== '/watch') return;

    const watch = document.querySelector('ytd-watch-flexy');
    if (!watch) return;

    let below = watch.querySelector('#below');
    const primary = watch.querySelector('#primary-inner, #primary');
    if (!below && primary) {
      below = primary.querySelector('#below');
    }
    if (!below && primary) {
      below = document.createElement('div');
      below.id = 'below';
      primary.appendChild(below);
    }
    if (!below) return;

    const descriptionBlock =
      [...below.children].find((element) =>
        element.matches(
          'ytd-watch-metadata, ytd-video-primary-info-renderer, ytd-video-secondary-info-renderer'
        )
      ) ||
      watch.querySelector(
        'ytd-watch-metadata, ytd-video-primary-info-renderer, ytd-video-secondary-info-renderer'
      );

    const comments = findCommentsRoot();
    if (!descriptionBlock || !comments) return;

    if (descriptionBlock.parentElement !== below) {
      below.insertAdjacentElement('afterbegin', descriptionBlock);
    }

    setImportantStyles(below, {
      display: 'flex',
      'flex-direction': 'column',
      width: '100%',
      'min-width': '0',
    });
    setImportantStyles(descriptionBlock, { order: '1' });

    // Recommendations must stay before comments so a comment loader cannot
    // block access to YouTube's related-video feed.
    const recommendations =
      watch.querySelector('ytd-watch-next-secondary-results-renderer') ||
      watch.querySelector('#secondary');
    let insertionAnchor = descriptionBlock;
    if (recommendations && !recommendations.contains(comments)) {
      setImportantStyles(recommendations, {
        order: '2',
        width: '100%',
        'max-width': '100%',
        'margin-left': '0',
      });
      if (
        recommendations.parentElement !== below ||
        descriptionBlock.nextElementSibling !== recommendations
      ) {
        descriptionBlock.insertAdjacentElement('afterend', recommendations);
      }
      insertionAnchor = recommendations;
    }

    setImportantStyles(comments, {
      order: '3',
      width: '100%',
      'min-width': '0',
      'max-width': '100%',
      margin: '8px 0 0',
    });
    if (
      comments.parentElement !== below ||
      insertionAnchor.nextElementSibling !== comments
    ) {
      insertionAnchor.insertAdjacentElement('afterend', comments);
    }

    for (const sibling of below.children) {
      if (
        sibling === descriptionBlock ||
        sibling === comments ||
        sibling === recommendations
      ) {
        continue;
      }
      setImportantStyles(sibling, { order: '4' });
    }
  }

  function removeLegacyCommentPagination() {
    document.getElementById(`${SCRIPT_ID}-load-more-comments`)?.remove();
    document.getElementById(`${SCRIPT_ID}-load-less-comments`)?.remove();
    document
      .querySelectorAll('[data-vm-comment-hidden="true"]')
      .forEach((thread) => {
        delete thread.dataset.vmCommentHidden;
        thread.style.removeProperty('display');
      });
    document
      .querySelectorAll('[data-vm-continuation-hidden="true"]')
      .forEach((continuation) => {
        delete continuation.dataset.vmContinuationHidden;
        continuation.style.removeProperty('display');
      });
  }

  function arrangeWatchComments() {
    positionCommentsAfterRecommendations();
    removeLegacyCommentPagination();
  }

  function hideAskGeminiControls() {
    const roots = document.querySelectorAll(
      '#movie_player, ytd-player, ytd-watch-metadata'
    );
    for (const root of roots) {
      const candidates = root.querySelectorAll(
        'button, [role="button"], yt-button-view-model, button-view-model'
      );
      for (const candidate of candidates) {
        const label = [
          candidate.getAttribute('aria-label'),
          candidate.getAttribute('title'),
          candidate.textContent,
        ]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!/^ask(?:\s+gemini|\s+about|\s*$)/i.test(label)) continue;

        const control =
          candidate.closest(
            '.ytp-fullscreen-quick-action, yt-button-view-model, button-view-model'
          ) || candidate;
        setImportantStyles(control, {
          display: 'none',
          visibility: 'hidden',
          'pointer-events': 'none',
        });
        control.setAttribute('aria-hidden', 'true');
        control.hidden = true;
      }
    }
  }

  function showWelcomeOnce() {
    if (!document.body || document.getElementById(WELCOME_ID)) return;

    const memoryFlag = '__vmYtWelcomeShown';
    try {
      if (localStorage.getItem(WELCOME_KEY) === '1') return;
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      if (window[memoryFlag]) return;
      window[memoryFlag] = true;
    }

    const welcome = document.createElement('div');
    welcome.id = WELCOME_ID;
    welcome.setAttribute('role', 'status');
    welcome.setAttribute('aria-live', 'polite');
    welcome.textContent = 'Welcome to Fuck YouTube Premium';
    setImportantStyles(welcome, {
      'box-sizing': 'border-box',
      position: 'fixed',
      top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
      left: '50%',
      'z-index': '2147483647',
      width: 'min(calc(100% - 32px), 352px)',
      margin: '0',
      padding: '14px 18px',
      color: '#ffffff',
      background: 'rgba(15, 15, 15, .96)',
      border: '1px solid rgba(255, 255, 255, .18)',
      'border-radius': '14px',
      'box-shadow': '0 8px 24px rgba(0, 0, 0, .28)',
      'font-family': 'Roboto, Arial, sans-serif',
      'font-size': '16px',
      'font-weight': '600',
      'line-height': '1.3',
      'text-align': 'center',
      transform: 'translateX(-50%)',
      opacity: '1',
    });
    document.body.appendChild(welcome);

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      welcome.dataset.hiding = 'true';
      welcome.style.setProperty('opacity', '0', 'important');
      welcome.style.setProperty(
        'transform',
        'translate(-50%, -8px)',
        'important'
      );
      setTimeout(() => welcome.remove(), 240);
    };
    welcome.addEventListener('click', dismiss, { once: true });
    setTimeout(dismiss, 4200);
  }

  function updateMobileNavigation() {
    const nav = document.getElementById(NAV_ID);
    if (!nav) return;
    applyCriticalNavigationLayout(nav);
    const inactiveColor = isDarkTheme() ? '#f1f1f1' : '#0f0f0f';
    for (const link of nav.querySelectorAll('.vm-yt-nav-item')) {
      const item = MOBILE_NAV_ITEMS[Number(link.dataset.index)];
      const isActive = Boolean(item?.active(location.pathname));
      const isCreate = item?.create === true;
      link.dataset.active = String(isActive);
      link.style.setProperty(
        'color',
        isActive && !isCreate ? '#ff0033' : inactiveColor,
        'important'
      );
      link.style.setProperty('background', 'transparent', 'important');
      if (item) {
        if (isActive) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    }
  }

  function buildNavItem(item, index) {
    const link = document.createElement('a');
    link.className = 'vm-yt-nav-item';
    link.href = item.href;
    link.dataset.index = String(index);
    link.dataset.id = item.id;
    if (item.create) link.dataset.create = 'true';
    link.setAttribute('aria-label', item.label);
    link.innerHTML = `
      <span class="vm-yt-nav-icon-wrap">
        <svg class="vm-yt-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
          ${item.icon}
        </svg>
      </span>
      <span class="vm-yt-nav-label">${item.label}</span>
    `;
    return link;
  }

  function ensureMobileNavigation() {
    // Burger / guide drawer is the only nav — never reinject the floating pill.
    removeFloatingPillNav();
  }

  function markSubscribeButtons(root = document) {
    const candidates = root.querySelectorAll?.([
      'ytm-subscribe-button-renderer button',
      'yt-subscribe-button-view-model button',
      'ytd-subscribe-button-renderer button',
      'ytd-subscribe-button-renderer tp-yt-paper-button',
      'ytd-subscribe-button-renderer [role="button"]',
      'button[aria-label*="Subscribe"]',
      'button[aria-label*="subscribe"]',
      '[role="button"][aria-label*="Subscribe"]',
      '[role="button"][aria-label*="subscribe"]',
    ].join(',')) || [];

    for (const button of candidates) {
      const owner = button.closest(
        'ytm-subscribe-button-renderer, yt-subscribe-button-view-model, ' +
          'ytd-subscribe-button-renderer'
      );
      const label = [
        button.getAttribute('aria-label'),
        button.textContent,
        owner?.getAttribute('aria-label'),
        owner?.textContent,
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      const alreadySubscribed =
        button.getAttribute('aria-pressed') === 'true' ||
        owner?.hasAttribute('subscribed') ||
        owner?.getAttribute('subscribed') === 'true' ||
        label.includes('subscribed') ||
        label.includes('unsubscribe');
      const isSubscribeAction =
        !alreadySubscribed &&
        /(^|\s)subscribe(?:\s|$| to )/.test(label);

      if (isSubscribeAction) {
        if (!button.dataset.vmSubscribeOriginalStyle) {
          button.dataset.vmSubscribeOriginalStyle = JSON.stringify(
            [
              'color',
              'background',
              'background-color',
              'background-image',
              'border',
              'border-color',
              'box-shadow',
              '--yt-spec-brand-button-background',
              '--yt-spec-static-brand-red',
            ].map((property) => [
              property,
              button.style.getPropertyValue(property),
              button.style.getPropertyPriority(property),
            ])
          );
        }
        button.dataset.vmSubscribeAction = 'true';
        owner?.setAttribute('data-vm-subscribe-action', 'true');
        setImportantStyles(button, {
          color: '#ffffff',
          background: '#ff0033',
          'background-color': '#ff0033',
          'background-image': 'none',
          border: '1px solid #ff0033',
          'border-color': '#ff0033',
          'box-shadow': 'none',
          '--yt-spec-brand-button-background': '#ff0033',
          '--yt-spec-static-brand-red': '#ff0033',
        });
        for (const child of button.querySelectorAll(
          'span, .yt-spec-button-shape-next__button-text-content'
        )) {
          child.style.setProperty('color', '#ffffff', 'important');
        }
      } else {
        delete button.dataset.vmSubscribeAction;
        owner?.removeAttribute('data-vm-subscribe-action');
        for (const child of button.querySelectorAll(
          'span, .yt-spec-button-shape-next__button-text-content'
        )) {
          child.style.removeProperty('color');
        }
        if (button.dataset.vmSubscribeOriginalStyle) {
          try {
            const originalStyles = JSON.parse(
              button.dataset.vmSubscribeOriginalStyle
            );
            for (const [property, value, priority] of originalStyles) {
              if (value) button.style.setProperty(property, value, priority);
              else button.style.removeProperty(property);
            }
          } catch {
            // A YouTube rerender will restore the native style.
          }
          delete button.dataset.vmSubscribeOriginalStyle;
        }
      }
    }
  }

  function findNativeCommentAction(comment, selectors) {
    return [...comment.querySelectorAll(selectors)].find(
      (element) => !element.closest('.vm-yt-comment-actions')
    );
  }

  function enhanceComments(root = document) {
    const comments = [
      ...root.querySelectorAll?.('ytd-comment-view-model') || [],
      ...[...root.querySelectorAll?.('ytd-comment-renderer') || []].filter(
        (comment) => !comment.querySelector('ytd-comment-view-model')
      ),
    ];

    for (const comment of comments) {
      if (comment.dataset.vmCommentEnhanced === 'true') continue;

      const likeSelectors = [
        '#like-button button',
        'like-button-view-model button',
        'button[aria-label^="Like"]',
        '[role="button"][aria-label^="Like"]',
      ].join(',');
      const replySelectors = [
        '#reply-button-end button',
        'ytd-button-renderer#reply-button button',
        'button[aria-label^="Reply"]',
        '[role="button"][aria-label^="Reply"]',
      ].join(',');
      if (
        !findNativeCommentAction(comment, likeSelectors) &&
        !findNativeCommentAction(comment, replySelectors)
      ) {
        continue;
      }

      comment.dataset.vmCommentEnhanced = 'true';
      setImportantStyles(comment, {
        'box-sizing': 'border-box',
        width: '100%',
        'min-width': '0',
        'max-width': '100%',
        padding: '12px 10px',
        'border-bottom': '1px solid rgba(127, 127, 127, .2)',
        'touch-action': 'manipulation',
      });

      for (const toolbar of comment.querySelectorAll('#toolbar')) {
        setImportantStyles(toolbar, {
          display: 'none',
          visibility: 'hidden',
        });
      }

      const actions = document.createElement('div');
      actions.className = 'vm-yt-comment-actions';
      setImportantStyles(actions, {
        'box-sizing': 'border-box',
        display: 'flex',
        width: '100%',
        'margin-top': '8px',
        gap: '8px',
      });

      const createAction = (label, icon) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'vm-yt-comment-action';
        button.setAttribute('aria-label', `${label} this comment`);
        button.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
          <span>${label}</span>
        `;
        setImportantStyles(button, {
          appearance: 'none',
          display: 'inline-flex',
          flex: '1 1 50%',
          'min-width': '0',
          'min-height': '44px',
          padding: '10px 12px',
          'align-items': 'center',
          'justify-content': 'center',
          gap: '6px',
          color: 'inherit',
          background: 'rgba(127, 127, 127, .12)',
          border: '1px solid rgba(127, 127, 127, .22)',
          'border-radius': '12px',
          'font-family': 'Roboto, Arial, sans-serif',
          'font-size': '14px',
          'font-weight': '600',
          'line-height': '1',
          'touch-action': 'manipulation',
        });
        return button;
      };

      const like = createAction(
        'Like',
        '<path d="M7 10v11H3V10h4Zm0 9h10.2a2 2 0 0 0 1.9-1.4l1.7-5.5A2 2 0 0 0 18.9 9H14l.7-3.2A2.8 2.8 0 0 0 12 2.5L7 10Z"/>'
      );
      const reply = createAction(
        'Reply',
        '<path d="M9 17 4 12l5-5v3h5a6 6 0 0 1 6 6v3a7 7 0 0 0-6-6H9v4Z"/>'
      );

      const syncLikeState = () => {
        const nativeLike = findNativeCommentAction(comment, likeSelectors);
        const pressed = Boolean(
          nativeLike?.getAttribute('aria-pressed') === 'true' ||
          nativeLike?.closest('[aria-pressed="true"]')
        );
        like.dataset.pressed = String(pressed);
        like.querySelector('span').textContent = pressed ? 'Liked' : 'Like';
        like.style.setProperty(
          'color',
          pressed ? '#ff0033' : 'inherit',
          'important'
        );
      };

      like.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        findNativeCommentAction(comment, likeSelectors)?.click();
        setTimeout(syncLikeState, 50);
        setTimeout(syncLikeState, 350);
      });

      reply.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const nativeReply = findNativeCommentAction(comment, replySelectors);
        nativeReply?.click();
        setTimeout(() => {
          const editor = comment.querySelector(
            'ytd-commentbox textarea, #contenteditable-root, [contenteditable="true"]'
          );
          editor?.focus();
          editor?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 120);
      });

      actions.append(like, reply);
      const actionHost =
        comment.querySelector('#body, #main, #content') || comment;
      actionHost.appendChild(actions);
      syncLikeState();
    }
  }

  function ensureViewport() {
    if (!document.head) return;
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.name = 'viewport';
      document.head.appendChild(viewport);
    }
    viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
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

  function ensurePlayerControlsToolbar() {
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
    syncCustomPlayerControls();
  }

  function scanPage() {
    ensureViewport();
    if (location.pathname.startsWith('/shorts')) {
      location.replace(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);
      return;
    }
    applyMobileShell();
    ensureGuideButtonVisible();
    hideUploadControls();
    dismissMiniplayer();
    removeFloatingPillNav();
    showWelcomeOnce();
    markSubscribeButtons();
    ensurePlayerControlsToolbar();
    ensureSearchTrigger();
    updateMediaSessionMetadata();
    hideAskGeminiControls();
    arrangeWatchComments();
    enhanceComments();
    removeAdCards();
    const video = findVideo();
    if (video) attachVideo(video);
  }

  nativeDocumentAddEventListener('visibilitychange', () => {
    if (isReallyHidden()) prepareForBackground();
  }, true);
  nativeDocumentAddEventListener('webkitvisibilitychange', () => {
    if (isReallyHidden()) prepareForBackground();
  }, true);
  nativeDocumentAddEventListener('freeze', prepareForBackground, true);
  nativeDocumentAddEventListener('yt-navigate-finish', () => {
    if (redirectChannelRootToVideos()) return;
    if (location.pathname.startsWith('/shorts')) {
      location.replace(`https://${BACKEND_HOST}/?app=desktop&persist_app=1`);
      return;
    }
    removeFloatingPillNav();
    updateMobileNavigation();
    hideNativeNavigationAndShorts();
    ensureGuideButtonVisible();
    hideUploadControls();
    dismissMiniplayer();
    ensurePlayerControlsToolbar();
    ensureSearchTrigger();
    arrangeWatchComments();
    enhanceComments();
  }, true);
  nativeDocumentAddEventListener(
    'PointerEvent' in window ? 'pointerdown' : 'touchstart',
    recordPlayerControlIntent,
    { capture: true, passive: true }
  );
  nativeDocumentAddEventListener(
    'PointerEvent' in window ? 'pointerdown' : 'touchstart',
    handlePlayerControlActionCapture,
    { capture: true, passive: false }
  );
  nativeDocumentAddEventListener(
    'PointerEvent' in window ? 'pointerup' : 'touchend',
    handlePlayerControlActionCapture,
    { capture: true, passive: false }
  );
  nativeDocumentAddEventListener(
    'PointerEvent' in window ? 'pointercancel' : 'touchcancel',
    handlePlayerControlActionCapture,
    { capture: true, passive: true }
  );
  nativeDocumentAddEventListener(
    'PointerEvent' in window ? 'pointerdown' : 'touchstart',
    closePlayerControlMenuFromOutside,
    true
  );
  // Only use click when PointerEvent is unavailable. Dual pointerdown+click
  // made option taps close the menu and then re-hit Captions/More underneath.
  if (!('PointerEvent' in window)) {
    nativeDocumentAddEventListener(
      'click',
      handlePlayerControlActionCapture,
      true
    );
  }
  nativeDocumentAddEventListener(
    'scroll',
    enforceHorizontalViewportLock,
    { capture: true, passive: true }
  );
  nativeWindowAddEventListener('scroll', enforceHorizontalViewportLock, {
    passive: true,
  });
  nativeDocumentAddEventListener('click', blockShortsNavigation, true);
  nativeDocumentAddEventListener('click', redirectChannelLinkToVideos, true);
  nativeDocumentAddEventListener(
    'PointerEvent' in window ? 'pointerdown' : 'click',
    handleMobileSearchClick,
    { capture: true, passive: false }
  );
  if (!('PointerEvent' in window)) {
    nativeDocumentAddEventListener('touchstart', handleMobileSearchClick, {
      capture: true,
      passive: false,
    });
  }
  nativeDocumentAddEventListener('keydown', handleMobileSearchKeydown, true);
  nativeWindowAddEventListener('blur', () => {
    if (state.video && !state.video.paused) prepareForBackground();
  }, true);
  nativeWindowAddEventListener('pagehide', prepareForBackground, true);
  nativeWindowAddEventListener('popstate', () => {
    removeFloatingPillNav();
    dismissMiniplayer();
    updateMobileNavigation();
  }, true);

  injectStyle();
  applyMobileShell();

  if (document.readyState === 'loading') {
    nativeDocumentAddEventListener('DOMContentLoaded', scanPage, { once: true });
  } else {
    scanPage();
  }

  let scanQueued = false;
  const observer = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      scanPage();
    }, 500);
  });
  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
  });

  // Player overlays and WebKit caption tracks can change between DOM scans.
  setInterval(() => {
    skipPlayerAd();
    dismissAdBlockEnforcement();
    suppressDuplicateNativeCaptions();
  }, 300);
  setInterval(() => {
    markSubscribeButtons();
    ensurePlayerControlsToolbar();
    ensureSearchTrigger();
    syncCustomPlayerControls();
    installMediaSessionHandlers();
    updateMediaSessionMetadata();
    hideAskGeminiControls();
    ensureGuideButtonVisible();
    hideUploadControls();
    hideNativeNavigationAndShorts();
    dismissMiniplayer();
    removeFloatingPillNav();
    hideShortsGuideEntries(document);
    for (const video of document.querySelectorAll('video')) {
      enforceInlinePlayback(video);
    }
    if (location.pathname === '/watch') arrangeWatchComments();
  }, 1200);
})();
