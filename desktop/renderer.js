import { translate } from './shared/core/i18n.js';
import DrawingSurface from './shared/drawing/DrawingSurface.js';
import DrawingToolbar from './shared/drawing/DrawingToolbar.js';
import { compositeDrawing } from './shared/drawing/exportImage.js';

const parameters = new URLSearchParams(location.search);
const role = parameters.get('role');
let language = parameters.get('language') || 'en';
let lastState;
const bridge = window.drawingDesktop;
let surface;
let toolbar;

document.documentElement.lang = language;

if (role === 'overlay') {
  surface = new DrawingSurface(document.body, {
    textHint: translate(language, 'drawTextHint'),
    onState: (state) => { bridge.state(state); },
    onExport: async (data, mode) => {
      let prepared = false;
      try {
        if (mode !== 'drawing') {
          const ready = await bridge.prepareCapture();
          if (!ready.ok) { throw new Error(ready.error); }
          prepared = true;
          surface.regionHint = translate(language, 'drawChooseWebRegion');
          const region = mode === 'web' ? await surface.selectRegion() : null;
          const result = await bridge.capture();
          if (!result.ok) { throw new Error(result.error); }
          const { scaleX, scaleY, offsetX, offsetY, width, height } = result;
          data = await compositeDrawing(result.image, data, {
            x: offsetX, y: offsetY, width, height,
            crop: region ? { x: offsetX + region.x * scaleX, y: offsetY + region.y * scaleY, width: region.width * scaleX, height: region.height * scaleY } : null,
          });
          await bridge.finishCapture();
          prepared = false;
        }
        const saved = await bridge.export(data, mode);
        if (!saved.ok) { throw new Error(saved.error); }
      } finally {
        if (prepared) { await bridge.finishCapture(); }
      }
    },
    onError: (error) => { bridge.send('error', { key: error?.message }); },
  });
  document.addEventListener('pointerdown', () => { bridge.activate(); }, true);
} else {
  document.body.classList.add('toolbar');
  toolbar = new DrawingToolbar(document.body, {
    language,
    desktop: true,
    onCommand: (action, value) => { bridge.send(action, value); },
    onMenu: (open) => { bridge.send('exportMenu', { open }); },
    onClose: () => { bridge.send('quit'); },
  });
}

window.addEventListener('keydown', (event) => {
  if (surface?.exporting) { return; }
  if (event.key === 'Escape' && !event.composedPath().some((element) => { return element.tagName === 'TEXTAREA'; })) {
    event.stopImmediatePropagation();
    bridge.send('configure', { tool: 'pointer' });
  }
}, true);

bridge.subscribe((message) => {
  if (message.type === 'command') {
    surface?.command(message.action, message.value);
    document.body.dataset.ready = 'true';
  } else if (message.type === 'state') {
    lastState = message.state;
    toolbar?.update(message.state);
  } else if (message.type === 'language' && ['en', 'vi', 'zh-CN'].includes(message.language) && message.language !== language) {
    language = message.language;
    document.documentElement.lang = language;

    if (surface) {
      surface.textHint = translate(language, 'drawTextHint');
    }

    if (toolbar) {
      toolbar.destroy();
      toolbar = new DrawingToolbar(document.body, {
        language,
        desktop: true,
        onCommand: (action, value) => { bridge.send(action, value); },
        onMenu: (open) => { bridge.send('exportMenu', { open }); },
        onClose: () => { bridge.send('quit'); },
      });
      if (lastState) { toolbar.update(lastState); }
    }
  } else if (message.type === 'error') {
    toolbar?.showError(translate(language, message.key || 'drawExportError'));
  }
});
bridge.send('ready');
