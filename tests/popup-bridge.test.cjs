const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const messages = [];
let closeCount = 0;
const browser = {
  runtime: {},
  tabs: {
    async query(query) {
      assert.equal(query.active, true);
      assert.equal(query.currentWindow, true);
      return [{ id: 73 }];
    },
    async sendMessage(tabId, message) {
      messages.push([tabId, message]);
      return false;
    },
  },
};

const context = {
  browser,
  window: {
    close() {
      closeCount += 1;
    },
  },
};

const popupPath = path.join(
  __dirname,
  '..',
  'firefox-extension',
  'popup.js'
);
vm.runInNewContext(fs.readFileSync(popupPath, 'utf8'), context);

setImmediate(() => {
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], 73);
  assert.equal(messages[0][1].type, 'toggleActionCard');
  assert.equal(closeCount, 1);
  console.log('popup toolbar relay: ok');
});
