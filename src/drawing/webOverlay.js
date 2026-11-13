import { translate } from '../core/i18n.js';
import DrawingSurface from './DrawingSurface.js';
import DrawingToolbar from './DrawingToolbar.js';
import { compositeDrawing, downloadDrawing } from './exportImage.js';

let session;

export function mountWebDrawing({ language = 'en', color = '#7C5CFC' } = {}) {
  if (session?.host.isConnected) {
    session.surface.command('configure', { tool: 'pen', color, visible: true });
    return;
  }

  const host = document.createElement('div');
  host.id = 'color-picker-drawing-overlay';

  for (const [key, value] of Object.entries({ all: 'initial', position: 'fixed', inset: '0', 'z-index': '2147483647', 'pointer-events': 'none' })) {
    host.style.setProperty(key, value, 'important');
  }

  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = new URL('./drawing.css', import.meta.url).href;
  root.append(style);
  document.documentElement.append(host);
  let toolbar;
  const surface = new DrawingSurface(root, {
    config: { color },
    textHint: translate(language, 'drawTextHint'),
    onState: (state) => { toolbar?.update(state); },
    onError: (error) => { toolbar?.showError(translate(language, error?.message?.startsWith('drawCapture') ? error.message : 'drawExportError')); },
    onExport: async (drawing, mode) => {
      if (mode === 'drawing') { downloadDrawing(drawing); return; }
      const blocker = document.createElement('div');
      blocker.className = 'drawing-capture-blocker';
      blocker.addEventListener('wheel', (event) => { event.preventDefault(); }, { passive: false });
      root.append(blocker);
      const attribute = mode === 'web' ? 'data-capturing' : 'data-screen-capturing';
      host.setAttribute(attribute, '');
      try {
        if (mode === 'web') {
          const metrics = { width: innerWidth, height: innerHeight, x: scrollX, y: scrollY };
          await new Promise((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); });
          const result = await chrome.runtime.sendMessage({ type: 'DRAW_CAPTURE_PAGE' });
          if (!result?.ok) { throw new Error(result?.error || 'drawCaptureWebError'); }
          if (innerWidth !== metrics.width || innerHeight !== metrics.height || scrollX !== metrics.x || scrollY !== metrics.y) {
            throw new Error('drawCaptureTabChanged');
          }
          downloadDrawing(await compositeDrawing(result.image, drawing), 'web');
        } else {
          await new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const listener = (message) => {
              if (message.type !== 'DRAW_SCREEN_RESULT' || message.requestId !== requestId) { return; }
              chrome.runtime.onMessage.removeListener(listener);
              if (message.ok) { resolve(); } else { reject(new Error(message.error || 'drawCaptureScreenError')); }
            };
            chrome.runtime.onMessage.addListener(listener);
            chrome.runtime.sendMessage({ type: 'DRAW_SCREEN_START', requestId, language }).then((result) => {
              if (!result?.ok) {
                chrome.runtime.onMessage.removeListener(listener);
                reject(new Error(result?.error || 'drawCaptureScreenError'));
              }
            }).catch(() => {
              chrome.runtime.onMessage.removeListener(listener);
              reject(new Error('drawCaptureScreenError'));
            });
          });
        }
      } finally {
        host.removeAttribute(attribute);
        blocker.remove();
      }
    },
  });
  toolbar = new DrawingToolbar(root, {
    language,
    onCommand: (action, value) => { surface.command(action, value); },
    onClose: () => {
      surface.destroy();
      toolbar.destroy();
      host.remove();
      session = null;
    },
  });
  surface.updateState();
  session = { host, surface };
}
