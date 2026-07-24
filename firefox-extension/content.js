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
  const RELEASE_API =
    'https://api.github.com/repos/aditauqir/fyp/releases/latest';
  const RELEASE_HIGHLIGHTS = [
    'Inline Play; fullscreen only on request.',
    'Extension menu stays compact on-page.',
    'Shorts are removed across YouTube.',
  ];

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

  async function checkForUpdatesFromCard(button) {
    const downloadUrl = button.dataset.downloadUrl;
    if (downloadUrl) {
      location.assign(downloadUrl);
      return;
    }

    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const response = await fetch(RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

      const release = await response.json();
      const manifest = api.runtime.getManifest();
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
      const updateAvailable =
        Boolean(latestVersion) &&
        compareVersions(latestVersion, manifest.version) > 0;
      const packageType = manifest.manifest_version === 3 ? 'chrome' : 'firefox';
      const expectedName =
        `fuck-youtube-premium-${packageType}-${latestVersion}.zip`;
      const asset = (release.assets || []).find(
        (candidate) => candidate.name === expectedName
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
        top: calc(env(safe-area-inset-top, 0px) + 12px);
        right: 12px;
        z-index: 2147483647;
        display: block;
        width: min(16rem, calc(100vw - 24px));
        color-scheme: dark;
      }

      * {
        box-sizing: border-box;
      }

      .card {
        display: grid;
        width: 100%;
        gap: clamp(0.45rem, 2vw, 0.55rem);
        padding: clamp(0.625rem, 3vw, 0.75rem);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 0.9rem;
        background: rgba(15, 15, 15, 0.97);
        box-shadow: 0 0.75rem 2rem rgba(0, 0, 0, 0.38);
        -webkit-backdrop-filter: blur(18px) saturate(1.2);
        backdrop-filter: blur(18px) saturate(1.2);
      }

      ul {
        display: grid;
        gap: 0.35rem;
        margin: 0;
        padding: 0 0 0 1.1rem;
        color: #d6d6d6;
        font: 600 clamp(0.72rem, 3.2vw, 0.78rem)/1.25 -apple-system,
          BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      li::marker {
        color: #ff0033;
      }

      button {
        appearance: none;
        width: 100%;
        min-height: 2.75rem;
        padding: 0.65rem 0.8rem;
        border: 0;
        border-radius: 0.75rem;
        color: #f7f7f7;
        background: #292929;
        font: 700 0.9rem/1 -apple-system, BlinkMacSystemFont,
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

  function injectWithSrc() {
    const root = document.documentElement || document.head || document.body;
    if (!root) return false;
    if (document.getElementById('yt-mobile-orion-page-script')) return true;

    const script = document.createElement('script');
    script.id = 'yt-mobile-orion-page-script';
    script.src = src;
    script.async = false;
    root.appendChild(script);
    return true;
  }

  async function injectWithText() {
    const root = document.documentElement || document.head || document.body;
    if (!root) return false;
    if (document.getElementById('yt-mobile-orion-page-script')) return true;

    try {
      const response = await fetch(src);
      const code = await response.text();
      const script = document.createElement('script');
      script.id = 'yt-mobile-orion-page-script';
      script.textContent = code;
      root.appendChild(script);
      script.remove();
      return true;
    } catch {
      return injectWithSrc();
    }
  }

  if (!injectWithSrc()) {
    const observer = new MutationObserver(() => {
      if (injectWithSrc()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }

  // Fallback if src injection is blocked by Orion.
  setTimeout(() => {
    if (!document.getElementById('yt-mobile-orion-page-script')) {
      injectWithText();
    }
  }, 0);
})();
