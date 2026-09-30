(() => {
  'use strict';

  const INSTALLED_FLAG = '__youtubeDiagnosticsPageHookV1';
  if (window[INSTALLED_FLAG]) return;
  try {
    Object.defineProperty(window, INSTALLED_FLAG, {
      value: true,
      configurable: false,
    });
  } catch {
    window[INSTALLED_FLAG] = true;
  }

  const EVENT_NAME = 'youtube-diagnostics-page-event';
  const CONFIG_EVENT_NAME = 'youtube-diagnostics-config';
  // This is an internal Chromium tool, so favor useful diagnostic detail over
  // aggressive truncation. Circular objects and truly enormous values still
  // need bounds so a broken logger cannot freeze the YouTube tab.
  const MAX_STRING_LENGTH = 12000;
  const MAX_OBJECT_KEYS = 250;
  const MAX_ARRAY_ITEMS = 250;
  let enabled = true;

  function truncate(value, limit = MAX_STRING_LENGTH) {
    const text = String(value);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }

  function safeUrl(value) {
    try {
      return truncate(new URL(value, location.href).href, 4000);
    } catch {
      return truncate(value, 1000);
    }
  }

  function safeElement(value) {
    const result = {
      __type: 'element',
      tag: value.tagName?.toLowerCase() || '',
      id: value.id || '',
      classes: typeof value.className === 'string' ? truncate(value.className, 500) : '',
      role: value.getAttribute?.('role') || '',
      ariaLabel: value.getAttribute?.('aria-label') || '',
      text: truncate(value.textContent?.replace(/\s+/g, ' ').trim() || '', 400),
    };
    if (value instanceof HTMLAnchorElement && value.href) result.href = safeUrl(value.href);
    return result;
  }

  function safeSerialize(value, state = { depth: 0, seen: new WeakSet() }) {
    if (value === null) return null;
    if (value === undefined) return { __type: 'undefined' };
    if (typeof value === 'string') return truncate(value);
    if (typeof value === 'number' || typeof value === 'boolean') {
      return Number.isFinite(value) ? value : String(value);
    }
    if (typeof value === 'bigint') return `${value.toString()}n`;
    if (typeof value === 'symbol') return String(value);
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) {
      return {
        __type: 'error',
        name: value.name,
        message: truncate(value.message),
        stack: truncate(value.stack || '', 8000),
      };
    }
    if (typeof Element !== 'undefined' && value instanceof Element) return safeElement(value);
    if (value instanceof URL) return safeUrl(value.href);
    if (state.depth >= 4) return `[${Object.prototype.toString.call(value)}]`;
    if (typeof value === 'object') {
      if (state.seen.has(value)) return '[Circular]';
      state.seen.add(value);
      if (Array.isArray(value)) {
        return value
          .slice(0, MAX_ARRAY_ITEMS)
          .map((item) => safeSerialize(item, { depth: state.depth + 1, seen: state.seen }));
      }
      const result = {};
      let keys = [];
      try {
        keys = Object.keys(value).slice(0, MAX_OBJECT_KEYS);
      } catch {
        return '[Unserializable object]';
      }
      for (const key of keys) {
        try {
          result[key] = safeSerialize(value[key], {
            depth: state.depth + 1,
            seen: state.seen,
          });
        } catch {
          result[key] = '[Unserializable]';
        }
      }
      return result;
    }
    return truncate(value);
  }

  function argumentText(value) {
    const serialized = safeSerialize(value);
    if (typeof serialized === 'string') return serialized;
    try {
      return truncate(JSON.stringify(serialized));
    } catch {
      return '[Unserializable]';
    }
  }

  function emit(type, data = {}) {
    if (!enabled) return;
    const record = {
      source: 'page',
      type,
      timestamp: new Date().toISOString(),
      epochMs: Date.now(),
      url: safeUrl(location.href),
      title: document.title || '',
      data,
    };
    try {
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, { detail: JSON.stringify(record) })
      );
    } catch {
      // Diagnostics must never interfere with YouTube if a record cannot be emitted.
    }
  }

  const consoleMethods = [
    'debug',
    'info',
    'log',
    'warn',
    'error',
    'dir',
    'table',
    'trace',
    'group',
    'groupCollapsed',
    'groupEnd',
    'time',
    'timeEnd',
    'count',
    'assert',
    'clear',
  ];

  for (const method of consoleMethods) {
    const original = console[method];
    if (typeof original !== 'function') continue;
    try {
      console[method] = function diagnosticsConsoleWrapper(...args) {
        emit('console', {
          method,
          message: args.map(argumentText).join(' '),
          arguments: args.map((value) => safeSerialize(value)),
        });
        return Reflect.apply(original, this, args);
      };
    } catch {
      // Some pages expose non-writable console methods.
    }
  }

  window.addEventListener(
    'error',
    (event) => {
      emit('window-error', {
        message: truncate(event.message || ''),
        filename: safeUrl(event.filename || ''),
        line: event.lineno || 0,
        column: event.colno || 0,
        error: safeSerialize(event.error),
        target: event.target instanceof Element ? safeElement(event.target) : null,
      });
    },
    true
  );

  window.addEventListener('unhandledrejection', (event) => {
    emit('unhandled-rejection', { reason: safeSerialize(event.reason) });
  });

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    if (typeof original !== 'function') continue;
    try {
      history[method] = function diagnosticsHistoryWrapper(...args) {
        const result = Reflect.apply(original, this, args);
        emit('navigation', { method, url: safeUrl(location.href) });
        return result;
      };
    } catch {
      // History methods may be protected by the page.
    }
  }

  window.addEventListener('popstate', () => emit('navigation', { method: 'popstate', url: safeUrl(location.href) }));
  window.addEventListener('hashchange', () => emit('navigation', { method: 'hashchange', url: safeUrl(location.href) }));
  window.addEventListener('pageshow', () => emit('lifecycle', { method: 'pageshow' }));
  window.addEventListener('pagehide', () => emit('lifecycle', { method: 'pagehide' }));

  // Orion uses WebKit media plumbing, so capture the browser-specific state
  // around every media element without changing playback behavior. In
  // particular, a video can exist while WebKit keeps it paused, detached from
  // the current presentation mode, or unable to enter inline/fullscreen mode.
  const MEDIA_EVENT_NAMES = [
    'loadstart',
    'loadedmetadata',
    'durationchange',
    'loadeddata',
    'canplay',
    'canplaythrough',
    'play',
    'playing',
    'pause',
    'waiting',
    'stalled',
    'suspend',
    'abort',
    'emptied',
    'error',
    'seeking',
    'seeked',
    'timeupdate',
    'ended',
    'ratechange',
    'volumechange',
    'webkitbeginfullscreen',
    'webkitendfullscreen',
    'webkitpresentationmodechanged',
    'webkitcurrentplaybacktargetiswirelesschanged',
    'webkitplaybacktargetavailabilitychanged',
  ];
  const WEBKIT_RUNTIME_EVENTS = [
    'visibilitychange',
    'webkitvisibilitychange',
    'fullscreenchange',
    'webkitfullscreenchange',
  ];
  const observedMedia = new WeakSet();
  const lastTimeupdate = new WeakMap();

  function mediaState(media) {
    const error = media.error;
    return {
      element: safeElement(media),
      currentSrc: safeUrl(media.currentSrc || media.src || ''),
      paused: Boolean(media.paused),
      ended: Boolean(media.ended),
      autoplay: Boolean(media.autoplay),
      controls: Boolean(media.controls),
      loop: Boolean(media.loop),
      muted: Boolean(media.muted),
      readyState: media.readyState,
      networkState: media.networkState,
      currentTime: Number.isFinite(media.currentTime) ? media.currentTime : null,
      duration: Number.isFinite(media.duration) ? media.duration : null,
      playbackRate: media.playbackRate,
      error: error
        ? {
            code: error.code || 0,
            message: truncate(error.message || '', 500),
          }
        : null,
      flags: {
        playsInline: Boolean(media.playsInline),
        webkitPlaysInline: Boolean(media.webkitPlaysInline),
        disablePictureInPicture: Boolean(media.disablePictureInPicture),
        xWebkitAirplay: media.getAttribute('x-webkit-airplay') || '',
        webkitDisplayingFullscreen: Boolean(media.webkitDisplayingFullscreen),
        webkitPresentationMode: media.webkitPresentationMode || '',
        webkitCurrentPlaybackTargetIsWireless: Boolean(
          media.webkitCurrentPlaybackTargetIsWireless
        ),
      },
    };
  }

  function webkitRuntimeState() {
    const fullscreenElement =
      document.fullscreenElement || document.webkitFullscreenElement || null;
    const audioSession = navigator.audioSession;
    return {
      document: {
        hidden: Boolean(document.hidden),
        webkitHidden: Boolean(document.webkitHidden),
        visibilityState: document.visibilityState || '',
        webkitVisibilityState: document.webkitVisibilityState || '',
        fullscreenElement: fullscreenElement ? safeElement(fullscreenElement) : null,
      },
      audioSessionType: audioSession?.type || '',
      videos: Array.from(document.querySelectorAll('video, audio'))
        .slice(0, 50)
        .map(mediaState),
    };
  }

  function emitWebkitRuntime(reason) {
    emit('webkit-runtime', { reason, state: webkitRuntimeState() });
  }

  function observeMediaElement(media) {
    if (!(media instanceof HTMLMediaElement) || observedMedia.has(media)) return;
    observedMedia.add(media);
    for (const eventName of MEDIA_EVENT_NAMES) {
      media.addEventListener(
        eventName,
        (event) => {
          // timeupdate fires frequently. Keep enough timing detail to diagnose
          // a stalled player without producing an unbounded diagnostic stream.
          if (eventName === 'timeupdate') {
            const now = Date.now();
            if (now - (lastTimeupdate.get(media) || 0) < 500) return;
            lastTimeupdate.set(media, now);
          }
          emit('media-event', {
            event: eventName,
            trusted: Boolean(event.isTrusted),
            media: mediaState(media),
          });
        },
        true
      );
    }
    emit('media-attached', { media: mediaState(media), events: MEDIA_EVENT_NAMES });
  }

  function scanMedia(root) {
    if (root instanceof HTMLMediaElement) observeMediaElement(root);
    if (typeof root?.querySelectorAll !== 'function') return;
    for (const media of root.querySelectorAll('video, audio')) observeMediaElement(media);
  }

  for (const eventName of WEBKIT_RUNTIME_EVENTS) {
    document.addEventListener(eventName, () => emitWebkitRuntime(eventName), true);
  }
  const mediaObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) scanMedia(node);
    }
  });
  if (document.documentElement) {
    mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  scanMedia(document);
  emitWebkitRuntime('initial');

  window.addEventListener(CONFIG_EVENT_NAME, (event) => {
    try {
      enabled = JSON.parse(event.detail || '{}').enabled !== false;
    } catch {
      enabled = true;
    }
  });

  emit('page-hook-ready', {
    methods: consoleMethods,
    mediaEvents: MEDIA_EVENT_NAMES,
    webkitRuntimeEvents: WEBKIT_RUNTIME_EVENTS,
    webkitFlags: [
      'playsInline',
      'webkitPlaysInline',
      'webkitDisplayingFullscreen',
      'webkitPresentationMode',
      'webkitCurrentPlaybackTargetIsWireless',
      'audioSession.type',
      'document.webkitHidden',
      'document.webkitVisibilityState',
      'document.webkitFullscreenElement',
    ],
  });
})();
