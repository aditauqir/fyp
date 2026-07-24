const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const listeners = {};
const badgeCalls = [];
const tabMessages = [];
let manifestVersion = 3;
const fakeApi = {
  action: {
    setBadgeBackgroundColor(value) {
      badgeCalls.push(['color', value]);
    },
    setBadgeText(value) {
      badgeCalls.push(['text', value]);
    },
    onClicked: {
      addListener(listener) {
        listeners.actionClicked = listener;
      },
    },
  },
  alarms: {
    create() {},
    onAlarm: {
      addListener(listener) {
        listeners.alarm = listener;
      },
    },
  },
  runtime: {
    getManifest() {
      return { manifest_version: manifestVersion, version: '2.0.13' };
    },
    onInstalled: {
      addListener(listener) {
        listeners.installed = listener;
      },
    },
    onMessage: {
      addListener(listener) {
        listeners.message = listener;
      },
    },
    onStartup: {
      addListener(listener) {
        listeners.startup = listener;
      },
    },
  },
  tabs: {
    sendMessage(tabId, message) {
      tabMessages.push([tabId, message]);
      return Promise.resolve();
    },
  },
};

const context = {
  browser: fakeApi,
  console,
  fetch: async () => ({
    ok: true,
    async json() {
      return {
        tag_name: 'v2.1.0',
        html_url: 'https://github.com/aditauqir/fyp/releases/tag/v2.1.0',
        assets: [
          {
            name: 'fuck-youtube-premium-chrome-2.1.0.zip',
            browser_download_url:
              'https://example.test/fuck-youtube-premium-chrome-2.1.0.zip',
          },
          {
            name: 'fuck-youtube-premium-firefox-2.1.0.zip',
            browser_download_url:
              'https://example.test/fuck-youtube-premium-firefox-2.1.0.zip',
          },
        ],
      };
    },
  }),
};

const backgroundPath = path.join(
  __dirname,
  '..',
  'firefox-extension',
  'background.js'
);
vm.runInNewContext(fs.readFileSync(backgroundPath, 'utf8'), context);

assert.equal(typeof listeners.message, 'function');
assert.equal(typeof listeners.actionClicked, 'function');
listeners.actionClicked({ id: 42 });

function requestUpdate() {
  return new Promise((resolve) => {
    const keepsChannelOpen = listeners.message(
      { type: 'checkForUpdates' },
      null,
      resolve
    );
    assert.equal(keepsChannelOpen, true);
  });
}

(async () => {
  const chromeUpdate = await requestUpdate();
  assert.equal(chromeUpdate.ok, true);
  assert.equal(chromeUpdate.currentVersion, '2.0.13');
  assert.equal(chromeUpdate.latestVersion, '2.1.0');
  assert.equal(chromeUpdate.updateAvailable, true);
  assert.equal(
    chromeUpdate.downloadUrl,
    'https://example.test/fuck-youtube-premium-chrome-2.1.0.zip'
  );

  manifestVersion = 2;
  const firefoxUpdate = await requestUpdate();
  assert.equal(
    firefoxUpdate.downloadUrl,
    'https://example.test/fuck-youtube-premium-firefox-2.1.0.zip'
  );

  assert.equal(badgeCalls.at(-1)[0], 'text');
  assert.equal(badgeCalls.at(-1)[1].text, 'UP');
  assert.equal(tabMessages.length, 1);
  assert.equal(tabMessages[0][0], 42);
  assert.equal(tabMessages[0][1].type, 'toggleActionCard');
  console.log('background update check: ok');
})();
