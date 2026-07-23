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
