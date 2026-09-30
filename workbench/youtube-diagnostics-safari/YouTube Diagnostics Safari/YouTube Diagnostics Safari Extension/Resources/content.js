(() => {
  'use strict';

  const chrome = globalThis.browser || globalThis.chrome;
  if (!chrome) return;

  const CONTENT_FLAG = '__youtubeDiagnosticsContentV1';
  if (globalThis[CONTENT_FLAG]) return;
  globalThis[CONTENT_FLAG] = true;

  const api = chrome;
  const PAGE_EVENT_NAME = 'youtube-diagnostics-page-event';
  const CONFIG_EVENT_NAME = 'youtube-diagnostics-config';
  const MAX_PENDING_RECORDS = 10000;
  const MAX_BATCH_SIZE = 100;
  const MAX_INVENTORY_ELEMENTS = 2600;
  const MAX_IMPORTANT_OVERFLOW = 900;
  const MAX_SOURCE_CHARS = 8000000;
  let captureEnabled = true;
  let pending = [];
  let flushInFlight = false;
  let droppedRecords = 0;
  let mutationBucket = createMutationBucket();

  function createMutationBucket() {
    return {
      startedAt: Date.now(),
      added: 0,
      removed: 0,
      attributes: 0,
      characterData: 0,
      attributeNames: {},
      addedSamples: [],
    };
  }

  function truncate(value, limit = 500) {
    const text = String(value ?? '');
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }

  function safeUrl(value) {
    try {
      return truncate(new URL(value, location.href).href, 4000);
    } catch {
      return truncate(value, 1000);
    }
  }

  function compactText(node, limit = 300) {
    return truncate(node?.textContent?.replace(/\s+/g, ' ').trim() || '', limit);
  }

  function isInteractive(element) {
    return (
      /^(A|BUTTON|INPUT|TEXTAREA|SELECT|VIDEO|SUMMARY|OPTION)$/.test(element.tagName) ||
      element.getAttribute('role') === 'button' ||
      element.hasAttribute('tabindex') ||
      element.hasAttribute('aria-label')
    );
  }

  function elementPath(element) {
    const parts = [];
    let current = element;
    while (current instanceof Element && parts.length < 6) {
      const tag = current.tagName.toLowerCase();
      const id = current.id ? `#${truncate(current.id, 80)}` : '';
      parts.unshift(`${tag}${id}`);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function safeAttributes(element) {
    const allowed = new Set([
      'id',
      'class',
      'role',
      'aria-label',
      'aria-expanded',
      'aria-selected',
      'name',
      'type',
      'placeholder',
      'href',
    ]);
    const attributes = {};
    for (const attribute of Array.from(element.attributes).slice(0, 40)) {
      const name = attribute.name;
      if (!allowed.has(name) && !name.startsWith('data-')) continue;
      attributes[name] =
        name === 'href' ? safeUrl(attribute.value) : truncate(attribute.value, 500);
    }
    return attributes;
  }

  function elementSummary(node, options = {}) {
    if (!(node instanceof Element)) return null;
    const rect = node.getBoundingClientRect();
    const important =
      options.important === true ||
      isInteractive(node) ||
      Boolean(node.id) ||
      Boolean(node.getAttribute('role')) ||
      node.tagName.startsWith('YTD-') ||
      node.tagName.startsWith('TP-YT-');
    let display = '';
    let visibility = '';
    if (important) {
      try {
        const style = getComputedStyle(node);
        display = style.display;
        visibility = style.visibility;
      } catch {
        // Some detached/custom elements do not expose computed style.
      }
    }
    const summary = {
      tag: node.tagName.toLowerCase(),
      id: truncate(node.id, 120),
      classes: truncate(typeof node.className === 'string' ? node.className : '', 500),
      role: truncate(node.getAttribute('role') || '', 120),
      ariaLabel: truncate(node.getAttribute('aria-label') || '', 400),
      path: elementPath(node),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      visible: rect.width > 0 && rect.height > 0 && display !== 'none' && visibility !== 'hidden',
      childCount: node.children.length,
      attributes: safeAttributes(node),
    };
    if (important || node.children.length === 0) {
      summary.text = compactText(node, important ? 400 : 160);
    }
    if (
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement
    ) {
      const inputType = node instanceof HTMLInputElement ? node.type : '';
      if (inputType.toLowerCase() !== 'password') {
        summary.inputValue = truncate(node.value, 1200);
      }
    }
    if (important) summary.computed = { display, visibility };
    if (options.includeHtml && important) {
      summary.outerHTML = truncate(
        node.outerHTML
          .replace(/\svalue=(?:"[^"]*"|'[^']*')/gi, '')
          .replace(/\s(?:data-[^=]+|aria-label)=(?:"[^"]*"|'[^']*')/gi, (match) =>
            match.length > 300 ? `${match.slice(0, 300)}…` : match
          ),
        1600
      );
    }
    return summary;
  }

  function makeRecord(type, data, source = 'content') {
    return {
      schema: 1,
      source,
      type,
      timestamp: new Date().toISOString(),
      epochMs: Date.now(),
      url: safeUrl(location.href),
      title: truncate(document.title, 500),
      data,
    };
  }

  function enqueue(record) {
    if (!captureEnabled || !record) return;
    pending.push(record);
    if (pending.length > MAX_PENDING_RECORDS) {
      const removeCount = pending.length - MAX_PENDING_RECORDS;
      pending.splice(0, removeCount);
      droppedRecords += removeCount;
    }
    if (pending.length >= MAX_BATCH_SIZE) void flush();
  }

  async function flush() {
    if (flushInFlight || !pending.length) return;
    flushInFlight = true;
    const records = pending.splice(0, MAX_BATCH_SIZE);
    try {
      const response = await api.runtime.sendMessage({
        type: 'append',
        records,
        url: safeUrl(location.href),
        title: document.title,
      });
      if (!response?.ok) throw new Error(response?.error || 'Background rejected records.');
    } catch {
      pending.unshift(...records);
      if (pending.length > MAX_PENDING_RECORDS) {
        const removeCount = pending.length - MAX_PENDING_RECORDS;
        pending.splice(0, removeCount);
        droppedRecords += removeCount;
      }
    } finally {
      flushInFlight = false;
      if (pending.length >= MAX_BATCH_SIZE) void flush();
    }
  }

  function emitDropNoticeIfNeeded() {
    if (!droppedRecords) return;
    const count = droppedRecords;
    droppedRecords = 0;
    enqueue(makeRecord('capture-overflow', { droppedPendingRecords: count }));
  }

  function captureSelectorMatches() {
    const selectors = [
      'ytd-app',
      'ytd-masthead',
      '#guide',
      '#player',
      '#columns',
      '#primary',
      '#secondary',
      'ytd-watch-flexy',
      'ytd-watch-metadata',
      'ytd-comments',
      'ytd-search',
      'ytd-video-renderer',
      'ytd-rich-item-renderer',
      'yt-lockup-view-model',
      'video-display-button-group-layout-view-model',
      'ytd-guide-entry-renderer',
      'video',
      'yt-searchbox',
      'textarea[name="search_query"]',
      '#voice-search-button',
      'button[aria-label="Search"]',
      '#fyp-search-overlay',
      '[data-fyp-player-action]',
      '#yt-mobile-orion-ext-controls-toolbar',
      'tp-yt-paper-dialog',
      '[role="dialog"]',
      '[aria-label]',
    ];
    const matches = {};
    for (const selector of selectors) {
      matches[selector] = Array.from(document.querySelectorAll(selector))
        .slice(0, 50)
        .map((element) => elementSummary(element, { important: true }));
    }
    return matches;
  }

  function fypRuntimeMarkers() {
    const root = document.documentElement;
    const videos = Array.from(document.querySelectorAll('video')).map((video) => ({
      element: elementSummary(video, { important: true }),
      currentSrc: safeUrl(video.currentSrc || video.src || ''),
      paused: video.paused,
      ended: video.ended,
      readyState: video.readyState,
      networkState: video.networkState,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : null,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      error: video.error
        ? { code: video.error.code, message: truncate(video.error.message || '', 400) }
        : null,
      flags: {
        playsInline: video.playsInline,
        webkitPlaysInline: video.webkitPlaysInline,
        disablePictureInPicture: video.disablePictureInPicture,
        xWebkitAirplay: video.getAttribute('x-webkit-airplay') || '',
        webkitDisplayingFullscreen: Boolean(video.webkitDisplayingFullscreen),
        webkitPresentationMode: video.webkitPresentationMode || '',
        webkitCurrentPlaybackTargetIsWireless: Boolean(
          video.webkitCurrentPlaybackTargetIsWireless
        ),
      },
      fyp: {
        attached: video.getAttribute('data-fyp-video-attached') === 'true',
        inlinePlayback: video.getAttribute('data-fyp-inline-playback') === 'true',
      },
    }));
    return {
      pageReady: root?.getAttribute('data-fyp-page-ready') || '',
      mediaSessionTab: root?.getAttribute('data-fyp-media-session-tab') || '',
      cpuTamer: root?.getAttribute('data-fyp-cpu-tamer') || '',
      searchActive:
        root?.getAttribute('data-fyp-search-active') === 'true' ||
        document.body?.getAttribute('data-fyp-search-active') === 'true',
      searchOverlay: Boolean(document.getElementById('fyp-search-overlay')),
      playerToolbar: Boolean(
        document.getElementById('yt-mobile-orion-ext-controls-toolbar')
      ),
      playerActions: document.querySelectorAll('[data-fyp-player-action]').length,
      documentHidden: document.hidden,
      webkitHidden: document.webkitHidden,
      visibilityState: document.visibilityState,
      webkitVisibilityState: document.webkitVisibilityState,
      fullscreenElement: Boolean(
        document.fullscreenElement || document.webkitFullscreenElement
      ),
      audioSessionType: navigator.audioSession?.type || '',
      videos,
    };
  }

  function yieldToPage() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function captureDomSnapshot(reason, options = {}) {
    if (!captureEnabled) return { ok: false, paused: true };
    const allElements = Array.from(document.querySelectorAll('*'));
    const elements = [];
    let visibleCount = 0;
    for (let index = 0; index < allElements.length; index += 1) {
      if (!captureEnabled) return { ok: false, paused: true };
      const element = allElements[index];
      const important =
        isInteractive(element) ||
        Boolean(element.id) ||
        Boolean(element.getAttribute('role')) ||
        Boolean(element.getAttribute('aria-label')) ||
        element.tagName.startsWith('YTD-') ||
        element.tagName.startsWith('TP-YT-');
      if (!important && elements.length >= MAX_INVENTORY_ELEMENTS) continue;
      if (important && elements.length >= MAX_INVENTORY_ELEMENTS + MAX_IMPORTANT_OVERFLOW) break;
      const summary = elementSummary(element, { important });
      if (summary) {
        elements.push(summary);
        if (summary.visible) visibleCount += 1;
      }
      if (index > 0 && index % 250 === 0) await yieldToPage();
    }
    const snapshot = {
      reason,
      readyState: document.readyState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      counts: {
        totalElements: allElements.length,
        capturedElements: elements.length,
        visibleCapturedElements: visibleCount,
        buttons: document.querySelectorAll('button,[role="button"]').length,
        links: document.querySelectorAll('a[href]').length,
        inputs: document.querySelectorAll('input,textarea,select').length,
        videos: document.querySelectorAll('video').length,
        iframes: document.querySelectorAll('iframe').length,
      },
      fypRuntime: fypRuntimeMarkers(),
      selectorMatches: captureSelectorMatches(),
      elements,
    };
    enqueue(makeRecord('dom-snapshot', snapshot));
    let source = null;
    if (options.includeSource) {
      const html = document.documentElement?.outerHTML || '';
      source = {
        format: 'text/html',
        originalLength: html.length,
        truncated: html.length > MAX_SOURCE_CHARS,
        html: html.slice(0, MAX_SOURCE_CHARS),
      };
      enqueue(
        makeRecord('dom-source-captured', {
          format: source.format,
          originalLength: source.originalLength,
          capturedLength: source.html.length,
          truncated: source.truncated,
        })
      );
    }
    void flush();
    return { ok: true, snapshot, source };
  }

  function captureInteraction(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    enqueue(
      makeRecord('interaction', {
        event: event.type,
        target: elementSummary(target, { important: true, includeHtml: true }),
        coordinates:
          typeof event.clientX === 'number'
            ? { x: Math.round(event.clientX), y: Math.round(event.clientY) }
            : null,
      })
    );
  }

  function resetMutationBucket() {
    const previous = mutationBucket;
    mutationBucket = createMutationBucket();
    return previous;
  }

  function flushMutations() {
    if (!captureEnabled) {
      mutationBucket = createMutationBucket();
      return;
    }
    emitDropNoticeIfNeeded();
    const bucket = resetMutationBucket();
    if (!bucket.added && !bucket.removed && !bucket.attributes && !bucket.characterData) {
      return;
    }
    enqueue(
      makeRecord('dom-mutations', {
        durationMs: Date.now() - bucket.startedAt,
        added: bucket.added,
        removed: bucket.removed,
        attributes: bucket.attributes,
        characterData: bucket.characterData,
        attributeNames: bucket.attributeNames,
        addedSamples: bucket.addedSamples,
      })
    );
  }

  function observeDom() {
    const observer = new MutationObserver((mutations) => {
      if (!captureEnabled) return;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          mutationBucket.attributes += 1;
          const name = mutation.attributeName || 'unknown';
          mutationBucket.attributeNames[name] = (mutationBucket.attributeNames[name] || 0) + 1;
        } else if (mutation.type === 'characterData') {
          mutationBucket.characterData += 1;
        } else if (mutation.type === 'childList') {
          mutationBucket.added += mutation.addedNodes.length;
          mutationBucket.removed += mutation.removedNodes.length;
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof Element && mutationBucket.addedSamples.length < 40) {
              mutationBucket.addedSamples.push(elementSummary(node, { important: true }));
            }
          }
        }
      }
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }

  function dispatchConfig() {
    window.dispatchEvent(
      new CustomEvent(CONFIG_EVENT_NAME, {
        detail: JSON.stringify({ enabled: captureEnabled }),
      })
    );
  }

  function injectPageHook() {
    const root = document.documentElement || document.head || document.body;
    if (!root) {
      setTimeout(injectPageHook, 0);
      return;
    }
    if (document.querySelector('script[data-youtube-diagnostics-page-hook]')) return;
    const script = document.createElement('script');
    script.src = api.runtime.getURL('page-hook.js');
    script.async = false;
    script.dataset.youtubeDiagnosticsPageHook = 'true';
    script.addEventListener('load', () => script.remove(), { once: true });
    script.addEventListener('error', () => script.remove(), { once: true });
    root.appendChild(script);
  }

  window.addEventListener(PAGE_EVENT_NAME, (event) => {
    if (!captureEnabled) return;
    try {
      const record = JSON.parse(event.detail || 'null');
      if (record && typeof record === 'object') {
        record.receivedAt = new Date().toISOString();
        enqueue(record);
      }
    } catch {
      enqueue(makeRecord('page-event-parse-error', { detailType: typeof event.detail }));
    }
  });

  function handleNavigation(reason) {
    if (!captureEnabled) return;
    enqueue(makeRecord('content-navigation', { reason, url: safeUrl(location.href) }));
    setTimeout(() => void captureDomSnapshot(reason), 600);
  }

  document.addEventListener('yt-navigate-finish', () => handleNavigation('yt-navigate-finish'), true);
  window.addEventListener('popstate', () => handleNavigation('popstate'), true);
  window.addEventListener('hashchange', () => handleNavigation('hashchange'), true);
  document.addEventListener('click', captureInteraction, true);
  document.addEventListener('change', captureInteraction, true);
  document.addEventListener('input', captureInteraction, true);

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'getStatus') {
      sendResponse({
        ok: true,
        enabled: captureEnabled,
        pending: pending.length,
        url: safeUrl(location.href),
      });
      return false;
    }
    if (message?.type === 'captureDom') {
      captureDomSnapshot('manual', { includeSource: message.includeSource !== false })
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === 'setEnabled') {
      captureEnabled = message.enabled !== false;
      if (!captureEnabled) mutationBucket = createMutationBucket();
      dispatchConfig();
      sendResponse({ ok: true, enabled: captureEnabled });
      return false;
    }
    if (message?.type === 'clearPending') {
      pending = [];
      droppedRecords = 0;
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  injectPageHook();
  observeDom();
  dispatchConfig();
  setInterval(() => {
    flushMutations();
    void flush();
  }, 2000);
  setInterval(() => void flush(), 1000);

  const startCapture = () => {
    void captureDomSnapshot('initial');
    setTimeout(() => void captureDomSnapshot('initial-settled'), 1500);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCapture, { once: true });
  } else {
    startCapture();
  }
})();
