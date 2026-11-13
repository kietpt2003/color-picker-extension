const prefix = 'drawing-screen:';

async function finishScreen(requestId, result) {
  try {
    const key = `${prefix}${requestId}`;
    const record = (await chrome.storage.session.get(key))[key];
    if (!record) { return; }
    await chrome.storage.session.remove(key);
    try {
      await chrome.tabs.sendMessage(record.tabId, { type: 'DRAW_SCREEN_RESULT', requestId, ...result });
    } catch { /* The original page may have closed while choosing a screen. */ }
  } catch { /* Session cleanup is best effort after a closed page. */ }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'DRAW_CAPTURE_PAGE' && sender.tab?.id) {
    (async () => {
      try {
        const before = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
        if (before[0]?.id !== sender.tab.id) { throw new Error('drawCaptureTabChanged'); }
        const image = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
        const after = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
        if (after[0]?.id !== sender.tab.id) { throw new Error('drawCaptureTabChanged'); }
        respond({ ok: true, image });
      } catch (error) {
        respond({ ok: false, error: error.message === 'drawCaptureTabChanged' ? error.message : 'drawCaptureWebError' });
      }
    })();
    return true;
  }

  if (message.type === 'DRAW_SCREEN_START' && sender.tab?.id && /^[\da-f-]{36}$/i.test(message.requestId || '')) {
    (async () => {
      const key = `${prefix}${message.requestId}`;
      try {
        await chrome.storage.session.set({ [key]: { tabId: sender.tab.id } });
        const language = ['en', 'vi', 'zh-CN'].includes(message.language) ? message.language : 'en';
        const window = await chrome.windows.create({
          url: chrome.runtime.getURL(`ui/screenCapture.html?requestId=${message.requestId}&language=${language}`),
          type: 'popup', width: 440, height: 220,
        });
        const record = (await chrome.storage.session.get(key))[key];
        if (record) { await chrome.storage.session.set({ [key]: { ...record, windowId: window.id } }); }
        respond({ ok: true });
      } catch {
        await finishScreen(message.requestId, { ok: false, error: 'drawCaptureScreenError' });
        respond({ ok: false, error: 'drawCaptureScreenError' });
      }
    })();
    return true;
  }

  if (message.type === 'DRAW_SCREEN_DONE' && sender.url?.startsWith(chrome.runtime.getURL('ui/screenCapture.html'))) {
    finishScreen(message.requestId, { ok: Boolean(message.ok), error: message.error }).then(() => { respond({ ok: true }); });
    return true;
  }
  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  (async () => {
    try {
      const records = await chrome.storage.session.get(null);
      for (const [key, record] of Object.entries(records)) {
        if (key.startsWith(prefix) && record.windowId === windowId) {
          await finishScreen(key.slice(prefix.length), { ok: false, error: 'drawCaptureCanceled' });
        }
      }
    } catch { /* Browser shutdown also clears these session-only records. */ }
  })();
});
