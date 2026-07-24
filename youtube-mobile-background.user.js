// ==UserScript==
// @name         Fuck YouTube Premium
// @namespace    https://github.com/violentmonkey
// @version      2.0.17
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

  document.documentElement?.setAttribute('data-fyp-page-ready', '2.0.17');

  const SCRIPT_ID = 'vm-yt-mobile-background';
  const STYLE_ID = `${SCRIPT_ID}-style`;
  const NAV_ID = `${SCRIPT_ID}-nav`;
  const WELCOME_ID = `${SCRIPT_ID}-welcome`;
  const WELCOME_KEY = `${SCRIPT_ID}:welcome-shown`;
  const BACKEND_HOST = 'www.youtube.com';
  const NAV_LAYOUT_VERSION = 'ext-v217-mobile-search';
  const MOBILE_SEARCH_OPEN_ATTR = 'data-fyp-mobile-search-open';
  const MOBILE_SEARCH_TRIGGER_SELECTOR = [
    'ytd-masthead #search-button',
    'ytd-masthead #search-button-narrow',
    'ytd-masthead #search-icon-legacy',
    'ytd-masthead button[aria-label="Search"]',
    'ytd-masthead [role="button"][aria-label="Search"]',
    'ytd-masthead yt-icon-button[aria-label="Search"]',
  ].join(',');
  const PLAYER_CONTROLS_VISIBLE_MS = 8000;
  /*
   * Orion's floating address bar overlays the bottom of the page (like Safari).
   * Keep floating controls above that chrome so they stay tappable.
   */
  const ORION_NAV_GAP = '72px';
  let playerControlsHideTimer = null;
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
  }

  function onVideoPause() {
    if (Date.now() <= state.userPauseUntil || !state.wantsPlayback) {
      state.wantsPlayback = false;
      clearRecoveryTimers();
      return;
    }
    if (isReallyHidden() && state.wantsPlayback && !state.video?.ended) {
      recoverPlayback();
    } else if (!isReallyHidden()) {
      // A pause while the page is visible is treated as an intentional pause.
      state.wantsPlayback = false;
      clearRecoveryTimers();
    }
  }

  function recordPlayerControlIntent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        '#movie_player, .html5-video-player, .html5-video-container'
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
      video.disablePictureInPicture = true;
    } catch {}
  }

  function onVideoLoaded() {
    enforceInlinePlayback(state.video);
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
          if (mode === 'picture-in-picture') return undefined;
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
      if (video) enforceInlinePlayback(video);
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

  function installMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        state.wantsPlayback = true;
        state.userPauseUntil = 0;
        safePlay();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        state.wantsPlayback = false;
        state.userPauseUntil = Date.now() + 3000;
        clearRecoveryTimers();
        state.video?.pause();
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
    if (!video.paused && !video.ended) state.wantsPlayback = true;
    recoverPlayback(video);
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
          overflow-x: clip !important;
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

        /*
         * Keep YouTube's native desktop search form, but present it as a
         * phone-width overlay after the search icon is tapped. A 16px input
         * also prevents WebKit from zooming the page when the keyboard opens.
         */
        ytd-masthead,
        ytd-masthead #container,
        ytd-masthead #start,
        ytd-masthead #center,
        ytd-masthead #end {
          box-sizing: border-box !important;
          min-width: 0 !important;
          max-width: 100vw !important;
        }

        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center {
          position: fixed !important;
          top: calc(env(safe-area-inset-top, 0px) + 8px) !important;
          right: 12px !important;
          left: 12px !important;
          z-index: 2147483646 !important;
          box-sizing: border-box !important;
          display: flex !important;
          width: auto !important;
          min-width: 0 !important;
          max-width: none !important;
          height: 48px !important;
          margin: 0 !important;
          padding: 4px !important;
          align-items: center !important;
          background: rgb(15, 15, 15) !important;
          border: 1px solid rgba(255, 255, 255, .22) !important;
          border-radius: 24px !important;
          box-shadow: 0 8px 28px rgba(0, 0, 0, .42) !important;
        }

        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #center > *,
        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] ytd-searchbox,
        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] yt-searchbox,
        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] #search-form,
        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] form {
          box-sizing: border-box !important;
          display: flex !important;
          flex: 1 1 auto !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          height: 40px !important;
          align-items: center !important;
        }

        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input#search,
        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] input[name='search_query'],
        ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true'] .yt-searchbox-input {
          box-sizing: border-box !important;
          display: block !important;
          flex: 1 1 auto !important;
          width: 100% !important;
          min-width: 0 !important;
          height: 40px !important;
          padding: 0 12px !important;
          color: #fff !important;
          background: transparent !important;
          font-size: 16px !important;
          line-height: 40px !important;
          opacity: 1 !important;
          visibility: visible !important;
        }
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
      ) video::cue {
        visibility: hidden !important;
        opacity: 0 !important;
        color: transparent !important;
        background: transparent !important;
        text-shadow: none !important;
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
        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1.25rem) !important;
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

  function closeMobileSearch() {
    const masthead = document.querySelector('ytd-masthead');
    if (!masthead) return;
    masthead.removeAttribute(MOBILE_SEARCH_OPEN_ATTR);
    masthead
      .querySelectorAll(
        '#search-button, #search-icon-legacy, button[aria-label="Search"], ' +
          '[role="button"][aria-label="Search"], yt-icon-button[aria-label="Search"]'
      )
      .forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
  }

  function handleMobileSearchClick(event) {
    if (!window.matchMedia?.('(max-width: 700px)').matches) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const trigger = target.closest(MOBILE_SEARCH_TRIGGER_SELECTOR);
    const masthead = target.closest('ytd-masthead');
    if (!trigger || !masthead) {
      const openMasthead = document.querySelector(
        `ytd-masthead[${MOBILE_SEARCH_OPEN_ATTR}='true']`
      );
      if (openMasthead && !target.closest('ytd-masthead #center')) {
        closeMobileSearch();
      }
      return;
    }

    const alreadyOpen =
      masthead.getAttribute(MOBILE_SEARCH_OPEN_ATTR) === 'true';
    if (alreadyOpen && trigger.closest('#center')) {
      return;
    }

    const input = masthead.querySelector(
      'input#search, input[name="search_query"], .yt-searchbox-input'
    );
    if (!(input instanceof HTMLInputElement)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    masthead.setAttribute(MOBILE_SEARCH_OPEN_ATTR, 'true');
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      input.removeAttribute('hidden');
      input.setAttribute('aria-hidden', 'false');
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }
      const end = input.value.length;
      input.setSelectionRange?.(end, end);
    });
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

  function applyMobileShell() {
    hideNativeNavigationAndShorts();
    ensureGuideButtonVisible();
    hideUploadControls();
    dismissMiniplayer();
    removeFloatingPillNav();
    applySafeBottomSpacing();

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
    arrangeWatchComments();
    enhanceComments();
  }, true);
  nativeDocumentAddEventListener(
    'PointerEvent' in window ? 'pointerdown' : 'touchstart',
    recordPlayerControlIntent,
    { capture: true, passive: true }
  );
  nativeDocumentAddEventListener('click', blockShortsNavigation, true);
  nativeDocumentAddEventListener('click', handleMobileSearchClick, true);
  nativeDocumentAddEventListener(
    'submit',
    (event) => {
      if (event.target?.closest?.('ytd-masthead')) {
        setTimeout(closeMobileSearch, 0);
      }
    },
    true
  );
  nativeDocumentAddEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      closeMobileSearch();
    },
    true
  );
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

  // Player ads change quickly, so poll only the small set of player controls here.
  setInterval(skipPlayerAd, 300);
  setInterval(() => {
    markSubscribeButtons();
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
