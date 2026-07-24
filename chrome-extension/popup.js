(() => {
  'use strict';

  const api =
    typeof browser !== 'undefined'
      ? browser
      : typeof chrome !== 'undefined'
        ? chrome
        : null;

  function queryActiveTab() {
    if (typeof browser !== 'undefined') {
      return browser.tabs.query({ active: true, currentWindow: true });
    }
    return new Promise((resolve, reject) => {
      api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const error = api.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(tabs);
      });
    });
  }

  function sendToTab(tabId) {
    const message = { type: 'toggleActionCard' };
    if (typeof browser !== 'undefined') {
      return browser.tabs.sendMessage(tabId, message);
    }
    return new Promise((resolve, reject) => {
      api.tabs.sendMessage(tabId, message, (response) => {
        const error = api.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  async function relayToolbarTap() {
    try {
      if (!api?.tabs) return;
      const [tab] = await queryActiveTab();
      if (typeof tab?.id === 'number') await sendToTab(tab.id);
    } catch {
      // Orion can close the bridge before returning a response.
    } finally {
      window.close();
    }
  }

  relayToolbarTap();
})();
