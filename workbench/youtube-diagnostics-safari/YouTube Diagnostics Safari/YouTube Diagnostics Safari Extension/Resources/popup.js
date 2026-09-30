(() => {
  'use strict';

  const chrome = globalThis.browser || globalThis.chrome;
  if (!chrome) return;

  const status = document.getElementById('status');
  const recordCount = document.getElementById('record-count');
  const captureState = document.getElementById('capture-state');
  const captureDomButton = document.getElementById('capture-dom');
  const downloadButton = document.getElementById('download');
  const toggleButton = document.getElementById('toggle');
  const clearButton = document.getElementById('clear');
  let activeTab = null;
  let contentState = { enabled: true };

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

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function ensureContentScript() {
    if (!activeTab?.id || !isYouTubeUrl(activeTab.url)) {
      throw new Error('Open a YouTube tab first.');
    }
    try {
      return await chrome.tabs.sendMessage(activeTab.id, { type: 'getStatus' });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['content.js'],
      });
      return chrome.tabs.sendMessage(activeTab.id, { type: 'getStatus' });
    }
  }

  async function getStoredStatus() {
    return chrome.runtime.sendMessage({ type: 'getStatus', tabId: activeTab.id });
  }

  async function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    if (typeof chrome.downloads?.download === 'function') {
      try {
        await chrome.downloads.download({
          url: blobUrl,
          filename,
          saveAs: false,
          conflictAction: 'uniquify',
        });
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
        return;
      } catch {
        // Safari versions without a working downloads API use the data URL fallback.
      }
    }
    URL.revokeObjectURL(blobUrl);

    const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => link.remove(), 0);
  }

  function setEnabled(enabled) {
    contentState.enabled = enabled;
    captureState.textContent = enabled ? 'Running' : 'Paused';
    toggleButton.textContent = enabled ? 'Pause capture' : 'Resume capture';
  }

  async function refresh() {
    activeTab = await getActiveTab();
    const supported = Boolean(activeTab?.url && isYouTubeUrl(activeTab.url));
    for (const button of [captureDomButton, downloadButton, toggleButton, clearButton]) {
      button.disabled = !supported;
    }
    if (!supported) {
      status.textContent = 'Active tab is not a supported YouTube page.';
      recordCount.textContent = '—';
      captureState.textContent = 'Unavailable';
      return;
    }
    status.textContent = new URL(activeTab.url).pathname || '/';
    try {
      contentState = await ensureContentScript();
      setEnabled(contentState.enabled !== false);
    } catch (error) {
      status.textContent = error.message;
      captureState.textContent = 'Unavailable';
    }
    try {
      const stored = await getStoredStatus();
      recordCount.textContent = String(stored.count || 0);
    } catch {
      recordCount.textContent = '—';
    }
  }

  async function captureDom() {
    await ensureContentScript();
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'captureDom',
      includeSource: true,
    });
    if (!response?.ok) {
      if (response?.paused) {
        status.textContent = 'Capture is paused. Resume capture first.';
        return;
      }
      throw new Error(response?.error || 'DOM capture failed.');
    }
    if (response.source?.html) {
      await downloadTextFile(
        `youtube-dom-${new Date().toISOString().replace(/[:.]/g, '-')}.html`,
        response.source.html,
        'text/html'
      );
    }
    status.textContent = response.source?.truncated
      ? 'DOM map saved; HTML source was truncated at 8 MB.'
      : 'DOM map and HTML source saved.';
    setTimeout(refresh, 500);
  }

  async function downloadLogs() {
    const response = await chrome.runtime.sendMessage({ type: 'getLogs', tabId: activeTab.id });
    if (!response?.ok) throw new Error(response?.error || 'Could not read stored logs.');
    const session = response.session || {};
    const header = {
      schema: 1,
      type: 'export-meta',
      exportedAt: new Date().toISOString(),
      tabId: activeTab.id,
      sourceUrl: activeTab.url,
      sessionStartedAt: session.startedAt || null,
      recordCount: session.logs?.length || 0,
      note: 'Console arguments and DOM text may contain sensitive page data. Review before sharing.',
    };
    const lines = [header, ...(session.logs || [])].map((record) => JSON.stringify(record));
    await downloadTextFile(
      `youtube-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
      `${lines.join('\n')}\n`,
      'application/x-ndjson'
    );
    status.textContent = `Downloaded ${session.logs?.length || 0} records.`;
  }

  async function toggleCapture() {
    await ensureContentScript();
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'setEnabled',
      enabled: !contentState.enabled,
    });
    setEnabled(response.enabled !== false);
  }

  async function clearLogs() {
    if (!confirm('Clear all stored logs for this YouTube tab?')) return;
    await chrome.runtime.sendMessage({ type: 'clearLogs', tabId: activeTab.id });
    try {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'clearPending' });
    } catch {
      // The tab may have navigated or closed while clearing.
    }
    status.textContent = 'Logs cleared.';
    recordCount.textContent = '0';
  }

  captureDomButton.addEventListener('click', () => captureDom().catch((error) => (status.textContent = error.message)));
  downloadButton.addEventListener('click', () => downloadLogs().catch((error) => (status.textContent = error.message)));
  toggleButton.addEventListener('click', () => toggleCapture().catch((error) => (status.textContent = error.message)));
  clearButton.addEventListener('click', () => clearLogs().catch((error) => (status.textContent = error.message)));
  refresh().catch((error) => (status.textContent = error.message));
})();
