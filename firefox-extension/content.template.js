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
  const EXPECTED_PAGE_VERSION = '3.2.15';
  const HISTORY_FEED_ATTR = 'data-fyp-feed';
  const DOM_FALLBACK_STYLE_ID = 'fyp-orion-dom-fallback-style';
  const PLAYER_CONTROLS_TOOLBAR_ID =
    'yt-mobile-orion-ext-controls-toolbar';
  const PLAYER_CONTROLS_LAYOUT_VERSION = 'icon-strip-v3213-restore';
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

  /*
   * WHAT: Records this tab as the lock-screen owner for the current watch video.
   * IDEALOGY: Several tabs can share a watch page, so one localStorage lease decides the owner. A hidden tab does not take that lease from a tab that still holds it.
   * FLOW:
   *   watch video not ended --> no live foreign owner while hidden --> write the lease --> this tab owns the session
   * HOW: Returns false off a watch page, without a video, or when the video has ended. It also returns false when another tab's lease is still valid and this document is hidden. Otherwise it stores this tab id, the video id, and an expiry, or keeps a local owner flag if storage throws.
   * EVENT LOG: Called from the fallback play listener and prepareFallbackBackgroundPlayback. Uses localStorage.
   */
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
    pause:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true"><path d="M0 0h16v16H0z" fill="none"></path><path fill="#fff" d="M5 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm8 0a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"></path></svg>',
    play:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true"><path d="M0 0h16v16H0z" fill="none"></path><path fill="#fff" d="M3 2.803a1 1 0 0 1 1.5-.865l9 5.195a1 1 0 0 1 0 1.733l-9 5.196a1 1 0 0 1-1.5-.866z"></path></svg>',
    rewind:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 512 512" aria-hidden="true"><path d="M0 0h512v512H0z" fill="none"></path><path fill="currentColor" d="M455.979 424.271A24.053 24.053 0 0 0 480 400.251V112.015a24 24 0 0 0-38.285-19.286L264 224.369V112.015a24 24 0 0 0-38.285-19.286L31.155 236.847a24 24 0 0 0 0 38.57l194.56 144.119A24 24 0 0 0 264 400.251V287.9l177.715 131.637a23.92 23.92 0 0 0 14.264 4.734M232 384.37L58.88 256.132L232 127.9ZM448 127.9v256.47L274.88 256.132Z"></path></svg>',
    forward:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 512 512" aria-hidden="true"><path d="M0 0h512v512H0z" fill="none"></path><path fill="currentColor" d="M32 111.882v288.236A23.979 23.979 0 0 0 70.285 419.4L248 287.763v112.355a23.979 23.979 0 0 0 38.285 19.282l194.56-144.119a24 24 0 0 0 0-38.57L286.285 92.6A24 24 0 0 0 248 111.882v112.355L70.285 92.6A24 24 0 0 0 32 111.882m248 15.881L453.119 256L280 384.237Zm-216 0L237.119 256L64 384.237Z"></path></svg>',
    pip:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"></path><path fill="currentColor" fill-rule="evenodd" d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm3-1h12a1 1 0 0 1 1 1v6.268A2 2 0 0 0 18 12h-4a2 2 0 0 0-2 2v4c0 .364.097.706.268 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1" clip-rule="evenodd"></path></svg>',
    fullscreen:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 1 2-2v-3"></path></svg>',
    speed:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
    airplay:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"></path><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke-opacity=".4" d="M4.1043 15.8632C2.8523 15.4715 2 14.3118 2 13L2 6C2 4.3431 3.3431 3 5 3L19 3C20.6569 3 22 4.3431 22 6L22 13C22 14.3118 21.1477 15.4715 19.8957 15.8632"></path><path fill="currentColor" fill-rule="evenodd" d="M13.6 13.4667L17.6 18.8C17.8596 19.1462 18 19.5673 18 20C18 21.1046 17.1046 22 16 22L8 22C6.8954 22 6 21.1046 6 20C6 19.5673 6.1404 19.1462 6.4 18.8L10.4 13.4667C10.7777 12.9631 11.3705 12.6667 12 12.6667C12.6295 12.6667 13.2223 12.9631 13.6 13.4667Z" clip-rule="evenodd" stroke="none"></path></g></svg>',
    collapse:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m18 15-6-6-6 6"></path></svg>',
    search:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search" aria-hidden="true"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>',
    close:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  });

  // Trusted Types can reject innerHTML on YouTube pages. Use XML parsing plus
  // DOM nodes so a rejected icon cannot stop the fallback before video setup.
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function cloneSvgNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (!text || !text.trim()) return null;
      return document.createTextNode(text);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const clone = document.createElementNS(SVG_NS, node.localName);
    for (const attr of node.attributes) {
      clone.setAttribute(attr.name, attr.value);
    }
    for (const child of node.childNodes) {
      const copied = cloneSvgNode(child);
      if (copied) clone.appendChild(copied);
    }
    return clone;
  }

  function isCurrentColorPaint(value) {
    return /^currentcolor$/i.test(String(value || '').trim());
  }

  function isWhitePaint(value) {
    const text = String(value || '').trim().toLowerCase();
    return text === '#fff' || text === '#ffffff';
  }

  /*
   * WHAT: Forces player-button icons to stay white on the dark control strip.
   * IDEALOGY: YouTube's path fill can paint custom icons nearly black, so the paint is set on the SVG itself instead of inheriting YouTube's CSS variables.
   * FLOW:
   *   icon built --> walk fill and stroke --> force white paint --> glyph stays visible
   * HOW: Walks the SVG and its descendants. A currentColor or white fill becomes #fff with an important inline fill, and a none fill stays none. Matching strokes become white. The SVG then gets an important white color plus visible display, overflow, opacity, and visibility.
   * EVENT LOG: Called from replaceIconContents while a fallback control button is built.
   */
  function solidifyPlayerIcon(svg) {
    const nodes = [svg, ...svg.querySelectorAll('*')];
    for (const node of nodes) {
      const fill = node.getAttribute('fill');
      const stroke = node.getAttribute('stroke');
      if (isCurrentColorPaint(fill) || isWhitePaint(fill)) {
        node.setAttribute('fill', '#fff');
        node.style.setProperty('fill', '#fff', 'important');
        if (!stroke || stroke === 'none') {
          node.style.setProperty('stroke', 'none', 'important');
        }
      } else if (fill === 'none') {
        node.style.setProperty('fill', 'none', 'important');
      }
      if (isCurrentColorPaint(stroke) || isWhitePaint(stroke)) {
        node.setAttribute('stroke', '#fff');
        node.style.setProperty('stroke', '#fff', 'important');
        if (!isWhitePaint(node.getAttribute('fill'))) {
          node.style.setProperty('fill', 'none', 'important');
        }
      }
    }

    const strokeHosts = [svg, ...svg.querySelectorAll('[stroke="#fff"]')];
    for (const host of strokeHosts) {
      if (host.getAttribute('stroke') !== '#fff') continue;
      for (const shape of host.querySelectorAll(
        'path, polyline, circle, line, polygon'
      )) {
        if (isWhitePaint(shape.getAttribute('fill'))) continue;
        if (shape.getAttribute('stroke') === 'none') continue;
        shape.setAttribute('stroke', '#fff');
        shape.style.setProperty('stroke', '#fff', 'important');
        shape.style.setProperty('fill', 'none', 'important');
      }
    }

    svg.style.setProperty('color', '#fff', 'important');
    svg.style.setProperty('display', 'block', 'important');
    svg.style.setProperty('overflow', 'visible', 'important');
    svg.style.setProperty('opacity', '1', 'important');
    svg.style.setProperty('visibility', 'visible', 'important');
  }

  function svgElementFromMarkup(markup) {
    try {
      const text = String(markup || '').trim();
      const source = text.startsWith('<svg')
        ? text
        : `<svg viewBox="0 0 24 24" aria-hidden="true">${text}</svg>`;
      const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
      const svg = parsed?.documentElement;
      if (!svg || String(svg.localName).toLowerCase() !== 'svg') return null;
      return cloneSvgNode(svg);
    } catch {
      return null;
    }
  }

  function replaceIconContents(element, markup) {
    if (!(element instanceof Element)) return;
    const svg = svgElementFromMarkup(markup);
    if (svg) solidifyPlayerIcon(svg);
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

  const PLAYBACK_GLYPH_PATHS = Object.freeze({
    play: 'M3 2.803a1 1 0 0 1 1.5-.865l9 5.195a1 1 0 0 1 0 1.733l-9 5.196a1 1 0 0 1-1.5-.866z',
    pause:
      'M5 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm8 0a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z',
  });

  function isViewBoxRect(shape) {
    const d = String(shape.getAttribute('d') || '')
      .replace(/\s+/g, '')
      .toLowerCase();
    return /^m00h\d+v\d+h0z$/.test(d);
  }

  function playbackGlyphPath(svg) {
    if (!(svg instanceof Element)) return null;
    for (const shape of [...svg.querySelectorAll('path')]) {
      if (isViewBoxRect(shape)) shape.remove();
    }
    const paths = [...svg.querySelectorAll('path')];
    return (
      paths.find((path) => path.getAttribute('fill') !== 'none') ||
      paths[paths.length - 1] ||
      null
    );
  }

  function shapeWantsStroke(shape) {
    if (isViewBoxRect(shape)) return false;
    const fill = String(shape.getAttribute('fill') || '').trim();
    if (isCurrentColorPaint(fill) || isWhitePaint(fill)) return false;
    if (fill && fill !== 'none') return false;
    let node = shape;
    while (node) {
      const stroke = node.getAttribute && node.getAttribute('stroke');
      if (stroke && stroke !== 'none') return true;
      if (node.getAttribute && node.getAttribute('stroke-opacity')) return true;
      node = node.parentElement;
    }
    return false;
  }

  function paintPlayerControlIcon(button) {
    if (!(button instanceof HTMLElement)) return;
    for (const [name, value] of [
      ['display', 'inline-flex'],
      ['visibility', 'visible'],
      ['opacity', '1'],
      ['flex', '0 0 3.25rem'],
      ['width', '3.25rem'],
      ['min-width', '3.25rem'],
      ['max-width', '3.25rem'],
      ['height', '3.25rem'],
      ['align-items', 'center'],
      ['justify-content', 'center'],
      ['color', '#fff'],
      ['-webkit-text-fill-color', '#fff'],
      ['overflow', 'visible'],
      ['position', 'relative'],
      ['z-index', '2147483646'],
      ['background', 'transparent'],
    ]) {
      button.style.setProperty(name, value, 'important');
    }
    const svg = button.querySelector('svg');
    if (!(svg instanceof Element)) return;
    svg.removeAttribute('hidden');
    for (const [name, value] of [
      ['display', 'block'],
      ['position', 'relative'],
      ['z-index', '2147483646'],
      ['width', '2rem'],
      ['height', '2rem'],
      ['overflow', 'visible'],
      ['visibility', 'visible'],
      ['opacity', '1'],
      ['color', '#fff'],
      ['flex', '0 0 auto'],
    ]) {
      svg.style.setProperty(name, value, 'important');
    }
    for (const shape of svg.querySelectorAll(
      'path, polygon, polyline, circle, line, rect'
    )) {
      if (isViewBoxRect(shape)) {
        shape.remove();
        continue;
      }
      if (shapeWantsStroke(shape)) {
        shape.setAttribute('stroke', '#fff');
        shape.setAttribute('fill', 'none');
        shape.style.setProperty('stroke', '#fff', 'important');
        shape.style.setProperty('fill', 'none', 'important');
        shape.style.setProperty('stroke-width', '2', 'important');
        continue;
      }
      shape.setAttribute('fill', '#fff');
      shape.style.setProperty('fill', '#fff', 'important');
      shape.style.setProperty('stroke', 'none', 'important');
    }
  }

  /*
   * WHAT: Shows a play triangle or pause bars on the playback button.
   * IDEALOGY: One glyph path is swapped in place so the button does not rebuild markup and an extra icon cannot pile up in the strip.
   * FLOW:
   *   paused or playing --> keep a single svg --> set the play or pause path --> button shows that glyph
   * HOW: Stores paused or playing on the button and removes extra SVG nodes. If none exists it builds the play icon, then sets the filled path to the play or pause shape and paints that path white. The remaining SVG is shown.
   * EVENT LOG: Called from createPlayerControlButton and syncFallbackPlayerControls. No media event of its own.
   */
  function setPlaybackGlyph(button, paused) {
    if (!(button instanceof HTMLButtonElement)) return;
    button.dataset.fypPlaybackState = paused ? 'paused' : 'playing';
    for (const extra of [...button.querySelectorAll('svg')].slice(1)) {
      extra.remove();
    }
    let svg = button.querySelector('svg');
    if (!(svg instanceof Element)) {
      replaceIconContents(button, PLAYER_CONTROL_ICONS.play);
      svg = button.querySelector('svg');
    }
    const glyph = playbackGlyphPath(svg);
    if (glyph) {
      glyph.setAttribute(
        'd',
        paused ? PLAYBACK_GLYPH_PATHS.play : PLAYBACK_GLYPH_PATHS.pause
      );
      glyph.setAttribute('fill', '#fff');
      glyph.style.setProperty('fill', '#fff', 'important');
      glyph.style.setProperty('stroke', 'none', 'important');
    }
    if (svg instanceof Element) {
      svg.removeAttribute('hidden');
      svg.style.setProperty('display', 'block', 'important');
      svg.style.setProperty('visibility', 'visible', 'important');
      svg.style.setProperty('opacity', '1', 'important');
    }
    paintPlayerControlIcon(button);
  }

  function videoInSystemMiniPlayer(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    return (
      document.pictureInPictureElement === video ||
      video.webkitPresentationMode === 'picture-in-picture'
    );
  }

  /*
   * WHAT: Moves the video into WebKit picture-in-picture when the browser allows it.
   * IDEALOGY: PiP is an explicit strip action. Ordinary playback does not call this, so starting a video cannot switch the page into PiP by itself.
   * FLOW:
   *   PiP tap while inline --> allow PiP --> webkitSetPresentationMode --> video is in picture-in-picture
   * HOW: Clears disablepictureinpicture, then returns false when presentation mode is missing or unsupported. It asks for picture-in-picture and returns whether that mode is now active.
   * EVENT LOG: webkitSetPresentationMode and webkitSupportsPresentationMode. Called from the pip branch of runFallbackPlayerControlAction.
   */
  function enterSystemMiniPlayer(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    video.removeAttribute('disablepictureinpicture');
    try {
      video.disablePictureInPicture = false;
    } catch {}
    if (typeof video.webkitSetPresentationMode !== 'function') return false;
    const supports =
      typeof video.webkitSupportsPresentationMode !== 'function' ||
      video.webkitSupportsPresentationMode('picture-in-picture');
    if (!supports) return false;
    try {
      video.webkitSetPresentationMode('picture-in-picture');
    } catch {
      return false;
    }
    return video.webkitPresentationMode === 'picture-in-picture';
  }

  function leaveSystemMiniPlayer(video) {
    if (
      video instanceof HTMLVideoElement &&
      video.webkitPresentationMode === 'picture-in-picture' &&
      typeof video.webkitSetPresentationMode === 'function'
    ) {
      try {
        video.webkitSetPresentationMode('inline');
      } catch {}
    }
  }

  /*
   * WHAT: Builds one control-strip button with an accessible name and a painted icon.
   * IDEALOGY: Buttons are DOM nodes so a rejected innerHTML write cannot stop the fallback strip from appearing.
   * FLOW:
   *   action and label --> button element --> play glyph or painted icon --> button ready to mount
   * HOW: Creates a button with the player-control class, action data attribute, label, title, and aria-pressed. Speed and quality buttons also advertise a menu. Play-pause starts on the play glyph; every other action fills the button through replaceIconContents.
   * EVENT LOG: Called from createPlayerControlButtons. Fallback pointer capture later reads data-fyp-player-action.
   */
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
    if (action === 'play-pause') setPlaybackGlyph(button, true);
    else {
      replaceIconContents(button, icon);
      paintPlayerControlIcon(button);
    }
    return button;
  }

  /*
   * WHAT: Builds the six fallback control-strip buttons in one row.
   * IDEALOGY: The strip is assembled in one place so rewind, play, skip, PiP, AirPlay, and fullscreen stay together instead of borrowing YouTube's player chrome.
   * FLOW:
   *   toolbar create --> rewind, play, forward, PiP, AirPlay, fullscreen --> one row returned
   * HOW: Returns those six buttons in that order. Each button comes from createPlayerControlButton and paints its own white icon.
   * EVENT LOG: Called from ensureFallbackPlayerControlsToolbar when the toolbar is missing or its layout id changed.
   */
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

  /*
   * WHAT: Restarts playback from the isolated-world fallback while the page script is not ready.
   * IDEALOGY: The page script owns recovery once it is alive, so this returns immediately in that case and does not fight its media-session handlers.
   * FLOW:
   *   page script absent --> playback wanted --> play once --> retry while hidden
   * HOW: Returns when the page runtime is ready. Otherwise it keeps the current or first video, marks playback wanted, plays once, and retries at 80, 250, 750, and 1500 milliseconds only while the document stays hidden.
   * EVENT LOG: Called from the fallback pause listener and prepareFallbackBackgroundPlayback. Uses HTMLMediaElement.play through fallbackSafePlay.
   */
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

  /*
   * WHAT: Remembers one watch video and listens for play and pause until the page script takes over.
   * IDEALOGY: The fallback attaches once per video so it can keep background audio only while the page runtime is absent.
   * FLOW:
   *   video element --> store it --> play claims the session --> a hidden pause recovers
   * HOW: Stores the video and returns if listeners were already added. On play, while the page script is absent, it marks playback wanted, claims the media session, marks the video inline, and syncs the strip. On an unwanted pause while hidden, it recovers playback.
   * EVENT LOG: video play and pause listeners. play and pause also sync the strip when the page runtime is already ready.
   */
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

  /*
   * WHAT: Prepares background playback from the content script when the page is leaving the screen.
   * IDEALOGY: Once the page script is running, this returns so the isolated world does not also write media-session handlers.
   * FLOW:
   *   page hides and page script is absent --> attach the video --> claim the session if playing --> recover if playback is still wanted
   * HOW: Returns when the page runtime is ready. Otherwise it attaches the current or first video, claims the session when that video is playing past the user-pause window, and sets play and pause media-session handlers before recovering.
   * EVENT LOG: visibilitychange, webkitvisibilitychange, freeze, blur, and pagehide. Uses navigator.mediaSession.setActionHandler.
   */
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

  /*
   * WHAT: Marks a video so the fallback keeps it inline and still allows AirPlay.
   * IDEALOGY: The content script sets playsinline on the element itself because it cannot rely on the page-world play patch already being installed.
   * FLOW:
   *   video node --> set playsinline and AirPlay --> clear the PiP disable flag --> video can start inline
   * HOW: Sets the inline marker, playsinline, webkit-playsinline, and x-webkit-airplay allow. It also assigns playsInline and webkitPlaysInline and removes disablepictureinpicture when those property writes succeed.
   * EVENT LOG: Called from markVideoTree, the document play listener in installDomFallbacks, and fallbackSafePlay.
   */
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

  /*
   * WHAT: Updates the fallback play, PiP, and fullscreen buttons to match the current video.
   * IDEALOGY: The fallback strip reads the current video so the glyph stays correct without mirroring YouTube's hidden player buttons.
   * FLOW:
   *   toolbar present --> read the video --> paint play or pause --> mark PiP and fullscreen pressed
   * HOW: Finds the toolbar and the current video without treating a missing toolbar as an error. The play button gets the matching glyph, Play or Pause label, and pressed state. PiP and fullscreen pressed states follow picture-in-picture and fullscreen on the document or video.
   * EVENT LOG: Called from fallback play, pause, player actions, and the 1200ms fallback interval.
   */
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
      }
      setPlaybackGlyph(playButton, paused);
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
    for (const button of toolbar.querySelectorAll('.fyp-player-control')) {
      if (button === playButton) continue;
      paintPlayerControlIcon(button);
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

  /*
   * WHAT: Runs a fallback strip action: seek, play or pause, a menu, AirPlay, PiP, or fullscreen.
   * IDEALOGY: The fallback strip drives the current video directly. Actions other than play and PiP try to keep playback going so the tap does not look like a pause.
   * FLOW:
   *   strip tap --> current video --> seek, play, menu, AirPlay, PiP, or fullscreen --> buttons sync
   * HOW: Seeks ten seconds, or plays and pauses with a short user-pause window. Speed and quality open their menus. AirPlay allows x-webkit-airplay and shows the target picker. PiP enters or leaves the system mini player, with requestPictureInPicture as backup. Fullscreen toggles the document or video.
   * EVENT LOG: Called from the fallback pointer capture handler. Uses play, pause, webkitShowPlaybackTargetPicker, webkitSetPresentationMode, requestPictureInPicture, and requestFullscreen.
   */
  async function runFallbackPlayerControlAction(action, sourceButton) {
    const video = fallbackVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    const preservePlayback = action !== 'play-pause' && action !== 'pip' && !video.paused;
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
      if (video.paused && !video.ended) {
        fallbackPlaybackState.wantsPlayback = true;
        fallbackPlaybackState.userPauseUntil = 0;
        try {
          video.play();
        } catch {}
      }
      if (videoInSystemMiniPlayer(video)) {
        leaveSystemMiniPlayer(video);
        if (document.pictureInPictureElement === video) {
          try {
            await document.exitPictureInPicture();
          } catch {}
        }
      } else if (!enterSystemMiniPlayer(video)) {
        if (typeof video.requestPictureInPicture === 'function') {
          try {
            await video.requestPictureInPicture();
          } catch {}
        }
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
    if (button.dataset.fypPlayerAction !== 'pip' && event.cancelable) {
      event.preventDefault();
    }
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

  /*
   * WHAT: Skips a playing ad from the content-script fallback by clicking skip or moving that ad toward its end.
   * IDEALOGY: This runs only as a fallback sweep. It leaves the video alone once the player is no longer showing a short ad.
   * FLOW:
   *   interval --> click skip buttons --> short ad still present --> seek or raise its rate
   * HOW: Clicks the known skip buttons. If the player is not showing a short ad, it restores any raised playback rate and returns. Otherwise it seeks a short ad to its duration, or raises the playback rate when that seek does not apply.
   * EVENT LOG: The 300ms interval inside installDomFallbacks. Uses button click, currentTime, and playbackRate.
   */
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

  /*
   * WHAT: Unlocks page scrolling after the hamburger drawer has closed, while the page script is absent.
   * IDEALOGY: The page script owns this once it is ready. Until then the fallback clears leftover overflow without writing the drawer's opened state.
   * FLOW:
   *   guide close --> page script ready? stop --> drawer still open? stop --> remove overflow hidden
   * HOW: Returns when the page runtime is ready, or while the guide is busy or another overlay dialog is open. Otherwise it removes inline overflow hidden from html, body, and the app nodes, and clears aria-hidden on ytd-app.
   * EVENT LOG: yt-guide-close, iron-overlay-closed, and the fallback intervals inside installDomFallbacks.
   */
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

  /*
   * WHAT: Removes an ad-block warning dialog and resumes a paused watch video that is already ready.
   * IDEALOGY: The warning is a page dialog, so it is removed only when its text matches that warning. The guide drawer keeps its own close path.
   * FLOW:
   *   interval --> matching warning text --> remove the dialog and leftover backdrop --> play if the watch video was paused and ready
   * HOW: Checks enforcement, error, and dialog nodes and removes one whose text matches the ad-block warning. After a removal it clears orphan backdrops, restores scroll, and plays a paused watch video that already has data.
   * EVENT LOG: The 300ms interval inside installDomFallbacks. Uses fallbackSafePlay.
   */
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

  function fallbackWatchIdFromLocation() {
    try {
      return new URL(location.href).searchParams.get('v') || '';
    } catch {
      return '';
    }
  }

  function isFallbackVisibleWatchRoot(watch) {
    if (!(watch instanceof Element) || !watch.isConnected) return false;
    if (watch.hasAttribute('hidden')) return false;
    const style = getComputedStyle(watch);
    if (style.display === 'none') return false;
    return true;
  }

  function findFallbackVisibleWatchRoot() {
    const wanted = fallbackWatchIdFromLocation();
    const nodes = [...document.querySelectorAll('ytd-watch-flexy')].filter(
      isFallbackVisibleWatchRoot
    );
    if (wanted) {
      const match = nodes.find((node) => node.getAttribute('video-id') === wanted);
      if (match) return match;
    }
    return nodes[nodes.length - 1] || null;
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

  /*
   * WHAT: Places the fallback control strip under the watch title, or the next available watch slot.
   * IDEALOGY: The strip stays in the title and metadata block, using the first real watch anchor instead of YouTube's player overlay.
   * FLOW:
   *   toolbar and watch anchors --> title, metadata, below, player, or watch --> insert --> strip is in the page
   * HOW: Inserts after the title when one exists. Otherwise it inserts at the start of metadata, then the below host, then after the player host, and finally appends to the watch root. It returns false when none of those nodes exist.
   * EVENT LOG: Called from ensureFallbackPlayerControlsToolbar. No event of its own.
   */
  function raisePlayerControlsStack(toolbar) {
    if (!(toolbar instanceof HTMLElement)) return;
    toolbar.style.setProperty('position', 'relative', 'important');
    toolbar.style.setProperty('z-index', '2147483646', 'important');
    toolbar.style.setProperty('overflow', 'visible', 'important');
    const parent = toolbar.parentElement;
    if (!(parent instanceof HTMLElement) || parent === document.body) return;
    if (parent.dataset.fypControlsRaised === 'true') return;
    parent.dataset.fypControlsRaised = 'true';
    parent.style.setProperty('position', 'relative', 'important');
    parent.style.setProperty('z-index', '2147483645', 'important');
    parent.style.setProperty('overflow', 'visible', 'important');
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

  /*
   * WHAT: Creates the fallback watch control strip and keeps it in the title block.
   * IDEALOGY: One toolbar id owns the strip. Off a watch page it is removed so other pages do not keep player buttons.
   * FLOW:
   *   /watch with a visible watch root --> create or reuse the toolbar --> mount if misplaced --> sync the buttons
   * HOW: Removes the toolbar when the path is not /watch or no visible watch root exists. On a watch page it rebuilds the toolbar when it is missing or its layout id differs, mounts it when placement is wrong, and syncs the buttons.
   * EVENT LOG: Called from scheduleFallbackPlayerControlsToolbar and the 1200ms fallback interval, including after yt-navigate-finish, popstate, and pageshow.
   */
  function ensureFallbackPlayerControlsToolbar() {
    if (location.pathname !== '/watch') {
      document.getElementById(PLAYER_CONTROLS_TOOLBAR_ID)?.remove();
      return;
    }
    const watch = findFallbackVisibleWatchRoot();
    if (!watch) return;
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
    const onThisWatch =
      toolbar.isConnected &&
      toolbar.closest('ytd-watch-flexy') === watch &&
      !toolbar.closest(FALLBACK_COLLAPSED_PLAYER_SHELL_SELECTOR);
    const settledOnTitle = toolbar.dataset.fypControlsAnchor === 'title';
    if (!onThisWatch || (!settledOnTitle && title instanceof Element)) {
      mountFallbackPlayerControlsToolbar(
        toolbar,
        title,
        metadata,
        below,
        playerHost,
        watch
      );
      if (title instanceof Element && toolbar.previousElementSibling === title) {
        toolbar.dataset.fypControlsAnchor = 'title';
      } else {
        delete toolbar.dataset.fypControlsAnchor;
      }
    }
    raisePlayerControlsStack(toolbar);
    syncFallbackPlayerControls();
  }

  const FALLBACK_PLAYER_CONTROLS_TOOLBAR_RETRY_MS = Object.freeze([
    0, 60, 160, 400, 900, 1800, 3500, 6000, 10000,
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

  /*
   * WHAT: Hides Shorts, Playables, and shelves that lead to them from the content-script fallback.
   * IDEALOGY: Those items are removed in the isolated world as well, so a late page script is not the only thing keeping them off the page.
   * FLOW:
   *   a node or the document --> collect shorts nodes, guide entries, and shelves --> hide the container
   * HOW: Collects nodes matching the shorts selector, guide entries whose link or label is Shorts, Playables, or a short mini-games label, and matching shelves. Each hit is hidden at its container.
   * EVENT LOG: Called by installFallbackShortsObserver on mutation, yt-navigate-start, yt-navigate-finish, popstate, and pageshow.
   */
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

  /*
   * WHAT: Keeps Shorts hidden as YouTube adds shelves, before and beside the page script.
   * IDEALOGY: One observer owns fallback shorts removal so each new shelf is hidden without a second full-page sweep fighting the first.
   * FLOW:
   *   fallback startup --> hide current shorts --> watch added nodes --> hide again on navigation
   * HOW: Returns if the observer already exists. Otherwise it hides shorts once, watches the document for added elements, and hides shorts inside each added root. Navigation and page-show events hide shorts on the whole document again.
   * EVENT LOG: MutationObserver, yt-navigate-start, yt-navigate-finish, popstate, and pageshow.
   */
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

  /*
   * WHAT: Starts the content-script fallback for inline video, the control strip, shorts, ads, and background audio.
   * IDEALOGY: This runs in the isolated world until the page script is ready, then the intervals and video observer step aside so they do not fight that script.
   * FLOW:
   *   content script start --> redirect shorts and mark videos inline --> listen for hide, navigation, and taps --> fallback strip and recovery stay up
   * HOW: Returns immediately when a channel root redirects to its videos tab. Otherwise it redirects Shorts, starts the shorts observer, marks existing videos inline, and schedules the control strip. It watches added videos, listens for play and strip taps, prepares background playback when the page hides, and runs intervals for the strip, guide scroll, ad skip, and the ad-block dialog while the page script is absent. A fallback stylesheet is injected once if that style id is missing.
   * EVENT LOG: MutationObserver, play, pointer and click capture, visibilitychange, webkitvisibilitychange, freeze, yt-navigate-finish, pageshow, popstate, blur, pagehide, storage, yt-guide-close, and iron-overlay-closed.
   */
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
          z-index: 2147483646 !important;
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          isolation: isolate !important;
          flex-direction: row !important;
          flex-wrap: nowrap !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          min-height: 4rem !important;
          margin: clamp(.5rem, 2.4vw, .8rem) auto !important;
          padding: clamp(.45rem, 2vw, .7rem) !important;
          gap: .35rem !important;
          justify-content: center !important;
          align-items: center !important;
          color: #fff !important;
          border: 1px solid rgba(255, 255, 255, .2) !important;
          border-radius: clamp(.85rem, 4vw, 1.2rem) !important;
          background: #111 !important;
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
          flex: 0 0 3.25rem !important;
          position: relative !important;
          z-index: 2147483646 !important;
          width: 3.25rem !important;
          min-width: 3.25rem !important;
          max-width: 3.25rem !important;
          height: 3.25rem !important;
          margin: 0 !important;
          padding: 0 !important;
          align-items: center !important;
          justify-content: center !important;
          color: #fff !important;
          -webkit-text-fill-color: #fff !important;
          background: transparent !important;
          border: 0 !important;
          border-radius: 0 !important;
          overflow: visible !important;
          touch-action: manipulation !important;
          -webkit-tap-highlight-color: transparent !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID}
          .fyp-player-control[data-fyp-player-action='play-pause'] {
          display: inline-flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          color: #fff !important;
          -webkit-text-fill-color: #fff !important;
          background: transparent !important;
          border: 0 !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID}
          .fyp-player-control[aria-pressed='true']:not(
            [data-fyp-player-action='play-pause']
          ) {
          color: #fff !important;
          -webkit-text-fill-color: #fff !important;
          background: transparent !important;
          border: 0 !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg {
          display: block !important;
          position: relative !important;
          z-index: 2147483646 !important;
          flex: 0 0 auto !important;
          width: 2rem !important;
          height: 2rem !important;
          max-width: none !important;
          max-height: none !important;
          overflow: visible !important;
          visibility: visible !important;
          opacity: 1 !important;
          color: #fff !important;
          forced-color-adjust: none !important;
          pointer-events: none !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID}
          .fyp-player-control[data-fyp-player-action='play-pause']
          > svg
          ~ svg {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          width: 0 !important;
          height: 0 !important;
          position: absolute !important;
          pointer-events: none !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg path[fill='none']:not([stroke='#fff']) {
          fill: none !important;
          stroke: none !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg[stroke='currentColor'],
        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg[stroke='#fff'],
        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg [stroke='currentColor'],
        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg [stroke='#fff'] {
          stroke: #fff !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg[stroke='currentColor'] path:not([fill='#fff']):not([fill='currentColor']):not([fill='currentcolor']),
        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg[stroke='#fff'] path:not([fill='#fff']):not([fill='currentColor']):not([fill='currentcolor']),
        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg[stroke='currentColor'] polyline:not([fill='#fff']),
        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg[stroke='#fff'] polyline:not([fill='#fff']),
        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg[stroke='currentColor'] circle:not([fill='#fff']),
        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg[stroke='#fff'] circle:not([fill='#fff']) {
          fill: none !important;
          stroke: #fff !important;
        }

        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg path[fill='currentColor'],
        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg path[fill='currentcolor'],
        #${PLAYER_CONTROLS_TOOLBAR_ID} .fyp-player-control svg path[fill='#fff'] {
          fill: #fff !important;
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

  /* __EMBEDDED_PAGE_SOURCE_DECLARATION__ */

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
