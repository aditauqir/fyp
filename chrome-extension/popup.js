(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const manifest = api.runtime.getManifest();
  const openButton = document.getElementById('open-youtube');
  const updateButton = document.getElementById('check-updates');

  function openTab(url) {
    if (typeof browser !== 'undefined') {
      return browser.tabs.create({ url });
    }
    return new Promise((resolve, reject) => {
      chrome.tabs.create({ url }, (tab) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(tab);
      });
    });
  }

  function sendMessage(message) {
    if (typeof browser !== 'undefined') {
      return browser.runtime.sendMessage(message);
    }
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  openButton.addEventListener('click', async () => {
    try {
      await openTab('https://www.youtube.com/?app=desktop&persist_app=1');
      window.close();
    } catch {
      openButton.textContent = 'Could not open YouTube';
    }
  });

  updateButton.addEventListener('click', async () => {
    const downloadUrl = updateButton.dataset.downloadUrl;
    if (downloadUrl) {
      try {
        await openTab(downloadUrl);
        window.close();
      } catch {
        updateButton.textContent = 'Could not open download';
      }
      return;
    }

    updateButton.disabled = true;
    updateButton.textContent = 'Checking…';

    try {
      const result = await sendMessage({ type: 'checkForUpdates' });
      if (!result?.ok) throw new Error(result?.error || 'Update check failed');

      if (result.updateAvailable && result.downloadUrl) {
        updateButton.dataset.downloadUrl = result.downloadUrl;
        updateButton.textContent = `Download v${result.latestVersion}`;
      } else {
        updateButton.textContent = `Up to date · v${manifest.version}`;
      }
    } catch {
      updateButton.textContent = 'Update check failed · Retry';
    } finally {
      updateButton.disabled = false;
    }
  });
})();
