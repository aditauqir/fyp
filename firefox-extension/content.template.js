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

  const ACTION_CARD_ID = 'fyp-orion-action-card';
  const PAGE_SCRIPT_ID = 'yt-mobile-orion-page-script';
  const PAGE_READY_ATTR = 'data-fyp-page-ready';
  const EXPECTED_PAGE_VERSION = '2.0.13';
  const DOM_FALLBACK_STYLE_ID = 'fyp-orion-dom-fallback-style';
  const RELEASE_API =
    'https://api.github.com/repos/aditauqir/fyp/releases/latest';
  const RELEASE_HIGHLIGHTS = [
    'Toolbar tap now opens these controls.',
    'Inline fallback runs without page injection.',
    'Shorts stay removed across YouTube.',
  ];

  function markVideoInline(video) {
    if (!video || String(video.tagName).toLowerCase() !== 'video') return;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('x-webkit-airplay', 'deny');
    try {
      video.playsInline = true;
      video.webkitPlaysInline = true;
      video.disablePictureInPicture = true;
    } catch {
      // Attribute enforcement above remains effective in Orion's isolated world.
    }
  }

  function markVideoTree(root = document) {
    if (String(root?.tagName).toLowerCase() === 'video') {
      markVideoInline(root);
    }
    root?.querySelectorAll?.('video').forEach(markVideoInline);
  }

  function redirectShorts() {
    if (!location.pathname.startsWith('/shorts')) return false;
    location.replace('https://www.youtube.com/?app=desktop&persist_app=1');
    return true;
  }

  function installDomFallbacks() {
    redirectShorts();
    markVideoTree(document);

    const videoObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) markVideoTree(node);
      }
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
          max-width: 100vw !important;
          overflow-x: clip !important;
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

  function compareVersions(left, right) {
    const a = String(left).replace(/^v/i, '').split('.').map(Number);
    const b = String(right).replace(/^v/i, '').split('.').map(Number);
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (a[index] || 0) - (b[index] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  }

  function sendRuntimeMessage(message, timeoutMs = 1800) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(
        () => finish(reject, new Error('Extension messaging timed out')),
        timeoutMs
      );

      try {
        if (typeof browser !== 'undefined') {
          Promise.resolve(api.runtime.sendMessage(message)).then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error)
          );
          return;
        }
        api.runtime.sendMessage(message, (response) => {
          const error = api.runtime.lastError;
          if (error) finish(reject, new Error(error.message));
          else finish(resolve, response);
        });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  async function fetchLatestRelease() {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    return response.json();
  }

  async function checkForUpdatesFromCard(button) {
    const downloadUrl = button.dataset.downloadUrl;
    if (downloadUrl) {
      location.assign(downloadUrl);
      return;
    }

    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const manifest = api.runtime.getManifest();
      let result = null;
      try {
        result = await sendRuntimeMessage({ type: 'checkForUpdates' });
      } catch {
        // Orion may suspend or omit the background page. Fetch directly below.
      }

      const release =
        result?.ok
          ? {
              tag_name: `v${result.latestVersion}`,
              html_url: result.releaseUrl,
              assets: result.downloadUrl
                ? [{ browser_download_url: result.downloadUrl }]
                : [],
            }
          : await fetchLatestRelease();
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
      const updateAvailable =
        Boolean(latestVersion) &&
        compareVersions(latestVersion, manifest.version) > 0;
      const packageType = manifest.manifest_version === 3 ? 'chrome' : 'firefox';
      const expectedName =
        `fuck-youtube-premium-${packageType}-${latestVersion}.zip`;
      const asset = (release.assets || []).find(
        (candidate) =>
          candidate.name === expectedName ||
          (!candidate.name && candidate.browser_download_url)
      );

      if (updateAvailable && (asset?.browser_download_url || release.html_url)) {
        button.dataset.downloadUrl =
          asset?.browser_download_url || release.html_url;
        button.textContent = `Download v${latestVersion}`;
      } else {
        button.textContent = `Up to date · v${manifest.version}`;
      }
    } catch {
      button.textContent = 'Update check failed · Retry';
    } finally {
      button.disabled = false;
    }
  }

  function toggleActionCard() {
    const existing = document.getElementById(ACTION_CARD_ID);
    if (existing) {
      existing.remove();
      return;
    }
    if (!document.documentElement) return;

    const host = document.createElement('aside');
    host.id = ACTION_CARD_ID;
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-label', 'Fuck YouTube Premium actions');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + 16px);
        right: 12px;
        z-index: 2147483647;
        display: block;
        width: min(22rem, calc(100vw - 24px));
        color-scheme: dark;
      }

      * {
        box-sizing: border-box;
      }

      .card {
        display: grid;
        width: 100%;
        gap: 0.75rem;
        padding: 1rem;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 1rem;
        background: rgba(15, 15, 15, 0.97);
        box-shadow: 0 0.75rem 2rem rgba(0, 0, 0, 0.38);
        -webkit-backdrop-filter: blur(18px) saturate(1.2);
        backdrop-filter: blur(18px) saturate(1.2);
      }

      ul {
        display: grid;
        gap: 0.5rem;
        margin: 0;
        padding: 0 0 0 1.25rem;
        color: #d6d6d6;
        font: 600 clamp(0.88rem, 3.8vw, 1rem)/1.35 -apple-system,
          BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      li::marker {
        color: #ff0033;
      }

      button {
        appearance: none;
        width: 100%;
        min-height: 3.5rem;
        padding: 0.85rem 1rem;
        border: 0;
        border-radius: 0.75rem;
        color: #f7f7f7;
        background: #292929;
        font: 700 1rem/1.1 -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        cursor: pointer;
        touch-action: manipulation;
      }

      button:first-of-type {
        color: #ffffff;
        background: #ff0033;
      }

      button:disabled {
        opacity: 0.65;
      }

      button:focus-visible {
        outline: 2px solid #ffffff;
        outline-offset: 2px;
      }
    `;

    const card = document.createElement('div');
    card.className = 'card';
    const list = document.createElement('ul');
    for (const text of RELEASE_HIGHLIGHTS) {
      const item = document.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    }

    const youtubeButton = document.createElement('button');
    youtubeButton.type = 'button';
    youtubeButton.textContent = 'Go to YouTube';
    youtubeButton.addEventListener('click', () => {
      location.assign(
        'https://www.youtube.com/?app=desktop&persist_app=1'
      );
    });

    const updateButton = document.createElement('button');
    updateButton.type = 'button';
    updateButton.textContent = 'Check for updates';
    updateButton.addEventListener('click', () => {
      checkForUpdatesFromCard(updateButton);
    });

    card.append(list, youtubeButton, updateButton);
    shadow.append(style, card);
    document.documentElement.appendChild(host);
  }

  api.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'toggleActionCard') return false;
    toggleActionCard();
    return false;
  });

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
