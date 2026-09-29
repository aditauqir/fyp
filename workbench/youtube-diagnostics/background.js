(() => {
  'use strict';

  const STORAGE_KEY = 'youtubeDiagnosticsSessionsV2';
  const MAX_RECORDS_PER_TAB = 8000;
  const sessions = Object.create(null);
  const writeQueues = new Map();
  let storageReady = chrome.storage.local
    .get(STORAGE_KEY)
    .then((result) => {
      Object.assign(sessions, result[STORAGE_KEY] || {});
    })
    .catch(() => {});

  function isYouTubeUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      return (
        hostname === 'youtube.com' ||
        hostname.endsWith('.youtube.com') ||
        hostname === 'youtu.be'
      );
    } catch {
      return false;
    }
  }

  function queueTabWrite(tabId, operation) {
    const previous = writeQueues.get(tabId) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => storageReady)
      .then(operation)
      .finally(() => {
        if (writeQueues.get(tabId) === next) writeQueues.delete(tabId);
      });
    writeQueues.set(tabId, next);
    return next;
  }

  async function persist() {
    await chrome.storage.local.set({ [STORAGE_KEY]: sessions });
  }

  function getOrCreateSession(tabId, metadata = {}) {
    const key = String(tabId);
    if (!sessions[key]) {
      sessions[key] = {
        tabId,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        url: metadata.url || '',
        title: metadata.title || '',
        logs: [],
      };
    }
    const session = sessions[key];
    if (metadata.url) session.url = metadata.url;
    if (metadata.title) session.title = metadata.title;
    session.updatedAt = new Date().toISOString();
    return session;
  }

  function appendRecords(tabId, records, metadata = {}) {
    return queueTabWrite(tabId, async () => {
      const session = getOrCreateSession(tabId, metadata);
      const incoming = Array.isArray(records) ? records : [];
      session.logs.push(...incoming);
      if (session.logs.length > MAX_RECORDS_PER_TAB) {
        session.logs.splice(0, session.logs.length - MAX_RECORDS_PER_TAB);
      }
      await persist();
      return session.logs.length;
    });
  }

  function clearSession(tabId) {
    return queueTabWrite(tabId, async () => {
      delete sessions[String(tabId)];
      await persist();
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const senderTabId = sender.tab?.id;
    const requestedTabId = Number.isInteger(message?.tabId)
      ? message.tabId
      : senderTabId;

    if (message?.type === 'append') {
      if (!Number.isInteger(senderTabId) || !Array.isArray(message.records)) {
        sendResponse({ ok: false, error: 'Missing tab or records.' });
        return false;
      }
      appendRecords(senderTabId, message.records, {
        url: message.url || sender.tab?.url || '',
        title: message.title || '',
      })
        .then((count) => sendResponse({ ok: true, count }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === 'getLogs') {
      storageReady
        .then(() => {
          const session = sessions[String(requestedTabId)] || {
            tabId: requestedTabId,
            startedAt: null,
            updatedAt: null,
            url: '',
            title: '',
            logs: [],
          };
          sendResponse({ ok: true, session });
        })
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === 'getStatus') {
      storageReady
        .then(() => {
          const session = sessions[String(requestedTabId)];
          sendResponse({
            ok: true,
            count: session?.logs?.length || 0,
            startedAt: session?.startedAt || null,
            updatedAt: session?.updatedAt || null,
            url: session?.url || '',
          });
        })
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === 'clearLogs') {
      if (!Number.isInteger(requestedTabId)) {
        sendResponse({ ok: false, error: 'Missing tab.' });
        return false;
      }
      clearSession(requestedTabId)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === 'isSupportedTab') {
      sendResponse({ ok: true, supported: isYouTubeUrl(message.url || sender.tab?.url) });
      return false;
    }

    return false;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    // Keep the session after a tab closes so the user can still export it.
    writeQueues.delete(tabId);
  });
})();
