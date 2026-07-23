(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const manifest = api.runtime.getManifest();
  const openButton = document.getElementById('open-youtube');
  const updateButton = document.getElementById('check-updates');
  const status = document.getElementById('status');
  const version = document.getElementById('version');

  version.textContent = `Version ${manifest.version}`;

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

  function setStatus(message, state = '') {
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  }

  openButton.addEventListener('click', async () => {
    try {
      await openTab('https://www.youtube.com/?app=desktop&persist_app=1');
      window.close();
    } catch {
      setStatus('Could not open YouTube.', 'error');
    }
  });

  updateButton.addEventListener('click', async () => {
    const downloadUrl = updateButton.dataset.downloadUrl;
    if (downloadUrl) {
      try {
        await openTab(downloadUrl);
        window.close();
      } catch {
        setStatus('Could not open the update download.', 'error');
      }
      return;
    }

    updateButton.disabled = true;
    updateButton.textContent = 'Checking…';
    setStatus('Checking GitHub Releases…');

    try {
      const result = await sendMessage({ type: 'checkForUpdates' });
      if (!result?.ok) throw new Error(result?.error || 'Update check failed');

      if (result.updateAvailable && result.downloadUrl) {
        updateButton.dataset.downloadUrl = result.downloadUrl;
        updateButton.textContent = `Download v${result.latestVersion}`;
        setStatus(
          `Version ${result.latestVersion} is available. Tap Download to save the new ZIP.`,
          'update'
        );
      } else {
        updateButton.textContent = 'Check for updates';
        setStatus(`Version ${manifest.version} is up to date.`, 'success');
      }
    } catch {
      updateButton.textContent = 'Try update check again';
      setStatus('Could not reach GitHub Releases. Check your connection.', 'error');
    } finally {
      updateButton.disabled = false;
    }
  });
})();
