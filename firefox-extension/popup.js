(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const manifest = api.runtime.getManifest();
  const openButton = document.getElementById('open-youtube');
  const updateButton = document.getElementById('check-updates');
  const RELEASE_API =
    'https://api.github.com/repos/aditauqir/fyp/releases/latest';

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

  async function fetchLatestRelease() {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    return response.json();
  }

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

  async function getUpdateResult() {
    try {
      const result = await sendMessage({ type: 'checkForUpdates' });
      if (result?.ok) return result;
    } catch {
      // Orion may suspend the background page; fetch the release directly.
    }

    const release = await fetchLatestRelease();
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    const packageType = manifest.manifest_version === 3 ? 'chrome' : 'firefox';
    const expectedName =
      `fuck-youtube-premium-${packageType}-${latestVersion}.zip`;
    const asset = (release.assets || []).find(
      (candidate) => candidate.name === expectedName
    );
    return {
      ok: true,
      latestVersion,
      updateAvailable:
        Boolean(latestVersion) &&
        compareVersions(latestVersion, manifest.version) > 0,
      downloadUrl: asset?.browser_download_url || release.html_url || null,
    };
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
      const result = await getUpdateResult();
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
