const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, dialog, desktopCapturer, systemPreferences } = require('electron');
const path = require('node:path');
const { writeFile } = require('node:fs/promises');

const testMode = process.argv.includes('--drawing-test');
const protocol = 'color-picker-draw';
const catalogs = require('./catalogs.json');
const t = (key) => { return (catalogs[language] || catalogs.en)[key] || catalogs.en[key]; };
const overlays = new Map();
const states = new Map();
let toolbar;
let tray;
let activeId;
let config = { tool: 'pen', color: '#7C5CFC', width: 5, opacity: 1, visible: true };
let language = 'en';
let quitting = false;
let captureSession = null;

function readLink(value) {
  try {
    const url = new URL(value);

    if (url.protocol !== `${protocol}:` || url.hostname !== 'open') {
      return;
    }

    if (['en', 'vi', 'zh-CN'].includes(url.searchParams.get('language'))) {
      language = url.searchParams.get('language');
    }

    const color = url.searchParams.get('color');

    if (/^#[\da-f]{6}$/i.test(color)) {
      config.color = color;
    }
  } catch {
    // NOTE: Ignore non-protocol command-line arguments from the OS.
  }
}

for (const argument of process.argv) {
  readLink(argument);
}

function send(window, message) {
  if (window && !window.isDestroyed()) {
    window.webContents.send('drawing:update', message);
  }
}

function activeWindow() {
  return [...overlays.values()].find((window) => { return window.webContents.id === activeId; }) || [...overlays.values()][0];
}

function publishState() {
  const state = states.get(activeId) || { canUndo: false, canRedo: false };
  send(toolbar, { type: 'state', state: { ...state, ...config } });
}

function refreshTray() {
  if (!tray) { return; }
  tray.setContextMenu(Menu.buildFromTemplate([
      { label: t('drawTrayShow'), click: () => { if (!captureSession) { toolbar.show(); toolbar.moveTop(); } } },
      { label: t('drawTrayMouse'), click: () => { applyConfig({ tool: config.tool === 'pointer' ? 'pen' : 'pointer', visible: true }); } },
      { label: t('drawTrayClear'), click: () => { if (captureSession) { return; } for (const window of overlays.values()) { send(window, { type: 'command', action: 'clear' }); } } },
      { type: 'separator' },
      { label: t('drawTrayQuit'), click: () => { app.quit(); } },
    ]));
}

function applyConfig(value) {
  if (captureSession) { return; }
  if (['pointer', 'pen', 'highlighter', 'eraser', 'text', 'rectangle', 'ellipse', 'line', 'arrow'].includes(value.tool)) {
    config.tool = value.tool;
  }

  if (/^#[\da-f]{6}$/i.test(value.color)) {
    config.color = value.color;
  }

  if (Number.isFinite(value.width)) {
    config.width = Math.min(40, Math.max(1, value.width));
  }

  if (Number.isFinite(value.opacity)) {
    config.opacity = Math.min(1, Math.max(0.05, value.opacity));
  }

  if (typeof value.visible === 'boolean') {
    config.visible = value.visible;
  }

  for (const window of overlays.values()) {
    window.setIgnoreMouseEvents(config.tool === 'pointer' || !config.visible, { forward: true });
    send(window, { type: 'command', action: 'configure', value: config });
    send(window, { type: 'language', language });
  }

  send(toolbar, { type: 'language', language });
  refreshTray();
  publishState();
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => { return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event) => { event.preventDefault(); });
}

function createOverlay(display) {
  const window = new BrowserWindow({
    ...display.bounds,
    frame: false,
    acceptFirstMouse: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  secureWindow(window);
  overlays.set(display.id, window);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const contentsId = window.webContents.id;
  window.on('closed', () => {
    if (captureSession?.owner === window) { restoreCapture(); }
    states.delete(contentsId);
    overlays.delete(display.id);
  });
  window.once('ready-to-show', () => {
    window.setIgnoreMouseEvents(config.tool === 'pointer' || !config.visible, { forward: true });
    if (!testMode) { window.showInactive(); }
    toolbar?.moveTop();
  });
  window.loadFile('renderer.html', { query: { role: 'overlay', language } }).catch(() => { app.quit(); });
  return window;
}

function knownSender(event) {
  return toolbar?.webContents.id === event.sender.id || [...overlays.values()].some((window) => { return window.webContents.id === event.sender.id; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argumentsList) => {
    if (captureSession) { return; }
    argumentsList.forEach(readLink);
    applyConfig({ tool: 'pen', visible: true, color: config.color });
    toolbar?.show();
    toolbar?.moveTop();
  });
  app.on('open-url', (event, value) => {
    event.preventDefault();
    if (captureSession) { return; }
    readLink(value);

    if (app.isReady()) {
      applyConfig({ tool: 'pen', visible: true, color: config.color });
      toolbar?.show();
    }
  });

  app.whenReady().then(() => {
    if (!testMode) { app.setAsDefaultProtocolClient(protocol); }
    const primary = screen.getPrimaryDisplay();
    const width = Math.min(680, primary.workArea.width);
    toolbar = new BrowserWindow({
      x: primary.workArea.x + Math.round((primary.workArea.width - width) / 2),
      y: primary.workArea.y + 20,
      width,
      height: 158,
      show: !testMode,
      frame: false,
      acceptFirstMouse: true,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    secureWindow(toolbar);
    toolbar.setAlwaysOnTop(true, 'screen-saver', 1);
    toolbar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    toolbar.on('closed', () => {
      if (!quitting) { app.quit(); }
    });
    toolbar.loadFile('renderer.html', { query: { role: 'toolbar', language } }).catch(() => { app.quit(); });
    for (const display of screen.getAllDisplays()) {
      createOverlay(display);
    }
    activeId = activeWindow()?.webContents.id;
    screen.on('display-added', (_event, display) => { createOverlay(display); });
    screen.on('display-removed', (_event, display) => { overlays.get(display.id)?.close(); });
    screen.on('display-metrics-changed', (_event, display) => { overlays.get(display.id)?.setBounds(display.bounds); });
    if (!testMode) {
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      if (captureSession) { return; }
      applyConfig({ tool: config.tool === 'pointer' ? 'pen' : 'pointer', visible: true });
      toolbar.showInactive();
      toolbar.moveTop();
    });
    globalShortcut.register('CommandOrControl+Shift+H', () => { applyConfig({ visible: !config.visible }); });
    const trayImage = nativeImage.createFromPath(path.join(__dirname, 'icons/32.png')).resize({ width: 18, height: 18 });
    tray = new Tray(trayImage);
    tray.setToolTip('Color Picker Draw');
    refreshTray();
    }
  }).catch((error) => {
    console.error('Could not start desktop drawing:', error.message);
    app.quit();
  });
}

ipcMain.on('drawing:command', (event, message = {}) => {
  if (!knownSender(event)) { return; }
  const { action, value = {} } = message;

  if (action === 'exportMenu' && event.sender.id === toolbar.webContents.id) {
    toolbar.setSize(toolbar.getBounds().width, value.open ? 330 : 158);
    return;
  }
  if (captureSession && !['quit', 'error', 'ready'].includes(action)) { return; }

  if (action === 'configure') {
    applyConfig(value);
  } else if (action === 'visibility') {
    applyConfig({ visible: !config.visible });
  } else if (action === 'ready') {
    if (event.sender.id === toolbar.webContents.id) {
      publishState();
    } else {
      event.sender.send('drawing:update', { type: 'command', action: 'configure', value: config });
    }
  } else if (action === 'quit') {
    app.quit();
  } else if (action === 'clear') {
    for (const window of overlays.values()) {
      send(window, { type: 'command', action });
    }
  } else if (['undo', 'redo', 'export'].includes(action)) {
    send(activeWindow(), { type: 'command', action, value });
  } else if (action === 'error') {
    send(toolbar, { type: 'error', key: ['drawCapturePermission', 'drawCaptureScreenError', 'drawCaptureWebError'].includes(value.key) ? value.key : 'drawExportError' });
  }
});

ipcMain.on('drawing:state', (event, state) => {
  if (knownSender(event) && event.sender.id !== toolbar?.webContents.id && state && typeof state === 'object') {
    states.set(event.sender.id, { canUndo: Boolean(state.canUndo), canRedo: Boolean(state.canRedo), exporting: Boolean(state.exporting) });
    publishState();
  }
});

ipcMain.on('drawing:activate', (event) => {
  if (knownSender(event) && event.sender.id !== toolbar?.webContents.id) {
    activeId = event.sender.id;
    toolbar.moveTop();
    publishState();
  }
});

function restoreCapture() {
  if (!captureSession) { return; }
  const saved = captureSession;
  captureSession = null;
  for (const [window, visible] of saved.windows) {
    if (!window.isDestroyed()) {
      window.setIgnoreMouseEvents(config.tool === 'pointer' || !config.visible, { forward: true });
      if (visible && !quitting) { window.showInactive(); }
    }
  }
  if (saved.toolbarVisible && !toolbar.isDestroyed() && !quitting) {
    toolbar.showInactive();
    toolbar.moveTop();
  }
}

ipcMain.handle('drawing:prepareCapture', (event) => {
  const owner = [...overlays.values()].find((window) => { return window.webContents.id === event.sender.id; });
  if (!owner || captureSession) { return { ok: false, error: 'drawCaptureScreenError' }; }
  captureSession = { owner, toolbarVisible: toolbar.isVisible(), windows: [...overlays.values()].map((window) => { return [window, window.isVisible()]; }) };
  toolbar.hide();
  owner.setIgnoreMouseEvents(false);
  if (!testMode) { owner.focus(); }
  return { ok: true };
});

ipcMain.handle('drawing:finishCapture', (event) => {
  if (captureSession?.owner.webContents.id === event.sender.id) { restoreCapture(); }
  return { ok: true };
});

ipcMain.handle('drawing:capture', async (event) => {
  if (captureSession?.owner.webContents.id !== event.sender.id) { return { ok: false, error: 'drawCaptureScreenError' }; }
  try {
    if (process.platform === 'darwin' && ['denied', 'restricted'].includes(systemPreferences.getMediaAccessStatus('screen'))) {
      throw new Error('drawCapturePermission');
    }
    const owner = captureSession.owner;
    const bounds = owner.getBounds();
    const display = screen.getDisplayMatching(bounds);
    for (const [window] of captureSession.windows) { window.hide(); }
    await new Promise((resolve) => { setTimeout(resolve, 180); });
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) },
    });
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') { throw new Error('drawCapturePermission'); }
    const source = sources.find((item) => { return item.display_id === String(display.id); }) || (sources.length === 1 && !sources[0].display_id ? sources[0] : null);
    if (!source || source.thumbnail.isEmpty()) { throw new Error('drawCaptureScreenError'); }
    const png = source.thumbnail.toPNG();
    const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    const scaleX = size.width / display.bounds.width;
    const scaleY = size.height / display.bounds.height;
    return {
      ok: true, image: `data:image/png;base64,${png.toString('base64')}`, scaleX, scaleY,
      offsetX: (bounds.x - display.bounds.x) * scaleX, offsetY: (bounds.y - display.bounds.y) * scaleY,
      width: bounds.width * scaleX, height: bounds.height * scaleY,
    };
  } catch (error) {
    return { ok: false, error: error.message === 'drawCapturePermission' ? error.message : 'drawCaptureScreenError' };
  }
});

ipcMain.handle('drawing:export', async (event, payload = {}) => {
  const { data, mode } = payload;
  if (!knownSender(event) || typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length > 100 * 1024 * 1024) {
    return { ok: false, error: 'drawExportError' };
  }
  try {
    const name = ['drawing', 'web', 'screen'].includes(mode) ? mode : 'drawing';
    const { canceled, filePath } = await dialog.showSaveDialog(toolbar, { defaultPath: `color-picker-${name}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!canceled && filePath) { await writeFile(filePath, Buffer.from(data.slice('data:image/png;base64,'.length), 'base64')); }
    return { ok: true, canceled };
  } catch {
    return { ok: false, error: 'drawExportError' };
  }
});

app.on('before-quit', () => { quitting = true; restoreCapture(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
