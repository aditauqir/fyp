(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const RELEASE_API =
    'https://api.github.com/repos/aditauqir/fyp/releases/latest';
  const ALARM_NAME = 'fyp-update-check';

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

  function setUpdateBadge(show) {
    const action = api.action || api.browserAction;
    if (!action) return;
    try {
      action.setBadgeBackgroundColor({ color: '#ff0033' });
      action.setBadgeText({ text: show ? 'UP' : '' });
    } catch {
      // Badges are optional in Orion's WebExtension implementation.
    }
  }

  async function checkForUpdates() {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }

    const release = await response.json();
    const manifest = api.runtime.getManifest();
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    const updateAvailable =
      Boolean(latestVersion) &&
      compareVersions(latestVersion, manifest.version) > 0;
    const packageType = manifest.manifest_version === 3 ? 'chrome' : 'firefox';
    const expectedNames = [
      `fuck-youtube-premium-orion-${latestVersion}.xpi`,
      `fuck-youtube-premium-${packageType}-${latestVersion}.zip`,
    ];
    const asset = expectedNames
      .map((name) =>
        (release.assets || []).find((candidate) => candidate.name === name)
      )
      .find(Boolean);

    setUpdateBadge(updateAvailable);
    return {
      ok: true,
      currentVersion: manifest.version,
      latestVersion,
      updateAvailable,
      downloadUrl: asset?.browser_download_url || release.html_url || null,
      releaseUrl: release.html_url || null,
    };
  }

  api.runtime.onInstalled?.addListener(() => {
    api.alarms?.create(ALARM_NAME, {
      delayInMinutes: 5,
      periodInMinutes: 360,
    });
    checkForUpdates().catch(() => {});
  });

  api.runtime.onStartup?.addListener(() => {
    api.alarms?.create(ALARM_NAME, { periodInMinutes: 360 });
    checkForUpdates().catch(() => {});
  });

  api.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) checkForUpdates().catch(() => {});
  });

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'checkForUpdates') return false;
    checkForUpdates()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  });
})();
