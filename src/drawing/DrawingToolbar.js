import { translate } from '../core/i18n.js';

const paths = {
  pointer: '<path d="m6 3 13 9-6 1-3 7-4-17Z"/>',
  pen: '<path d="m15 3 6 6M4 15 16 3l5 5L9 20H3l1-5Z"/>',
  highlighter: '<path d="m14 3 7 7-9 9-7-7 9-9ZM5 12l7 7-3 2H3v-6l2-3Z"/>',
  eraser: '<path d="m13 3 8 8-10 10H7l-6-6L13 3Zm-7 7 9 9M10 21h12"/>',
  text: '<path d="M4 5h16M12 5v15M8 20h8M4 8V3m16 5V3"/>',
  rectangle: '<rect x="3" y="5" width="18" height="14" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="8"/>',
  line: '<path d="m4 20 16-16"/><circle cx="4" cy="20" r="1"/><circle cx="20" cy="4" r="1"/>',
  arrow: '<path d="m4 20 16-16M11 4h9v9"/>',
  undo: '<path d="m8 4-6 6 6 6M2 10h12c5 0 7 3 7 9"/>',
  redo: '<path d="m16 4 6 6-6 6m6-6H10c-5 0-7 3-7 9"/>',
  clear: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  visibility: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  export: '<path d="M4 15v6h16v-6M12 3v13m-5-8 5-5 5 5"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
};

export function drawingIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
}

class DrawingToolbar {
  constructor(parent, { language = 'en', onCommand, onClose, onMenu = () => {}, desktop = false }) {
    this.language = language;
    this.onCommand = onCommand;
    this.onMenu = onMenu;
    this.abort = new AbortController();
    this.element = document.createElement('section');
    this.element.className = 'drawing-toolbar';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-label', translate(language, 'drawToolbar'));
    this.element.innerHTML = `
      <div class="drawing-grip" title="${translate(language, 'drawDrag')}">⠿</div>
      <div class="drawing-tool-grid">${['pointer', 'pen', 'highlighter', 'eraser', 'text', 'rectangle', 'ellipse', 'line', 'arrow'].map((tool) => {
        return `<button type="button" data-tool="${tool}" aria-pressed="false" title="${translate(language, `draw_${tool}`)}" aria-label="${translate(language, `draw_${tool}`)}">${drawingIcon(tool)}</button>`;
      }).join('')}</div>
      <label class="drawing-color"><input type="color" aria-label="${translate(language, 'drawColor')}"><span>${translate(language, 'drawColor')}</span></label>
      <div class="drawing-sliders"><label><span>${translate(language, 'drawOpacity')} <output data-output="opacity"></output></span><input data-setting="opacity" type="range" min="5" max="100" aria-label="${translate(language, 'drawOpacity')}"></label><label><span>${translate(language, 'drawSize')} <output data-output="width"></output></span><input data-setting="width" type="range" min="1" max="40" aria-label="${translate(language, 'drawSize')}"></label></div>
      <div class="drawing-actions">${['undo', 'redo', 'clear', 'visibility', 'export', 'close'].map((action) => {
        return `<button type="button" data-action="${action}" title="${translate(language, `draw_${action}`)}" aria-label="${translate(language, `draw_${action}`)}">${drawingIcon(action)}</button>`;
      }).join('')}</div>
      <div class="drawing-status" role="status" aria-live="polite">${translate(language, desktop ? 'drawDesktopShortcut' : 'drawPageHint')}</div>`;
    this.exportMenu = document.createElement('div');
    this.exportMenu.className = 'drawing-export-menu';
    this.exportMenu.hidden = true;
    this.exportMenu.setAttribute('role', 'group');
    this.exportMenu.setAttribute('aria-label', translate(language, 'drawExportOptions'));

    for (const mode of ['drawing', 'web', 'screen']) {
      const option = document.createElement('button');
      option.type = 'button';
      option.dataset.exportMode = mode;
      option.textContent = translate(language, `drawExport_${mode}`);
      this.exportMenu.append(option);
    }

    this.element.querySelector('.drawing-actions').append(this.exportMenu);
    const exportButton = this.element.querySelector('[data-action="export"]');
    exportButton.title = translate(language, 'drawExportOptions');
    exportButton.setAttribute('aria-label', exportButton.title);
    exportButton.setAttribute('aria-expanded', 'false');
    parent.append(this.element);
    window.addEventListener('pointerdown', (event) => {
      if (!event.composedPath().includes(this.element)) { this.closeExportMenu(); }
    }, { capture: true, signal: this.abort.signal });
    window.addEventListener('blur', () => { this.closeExportMenu(); }, { signal: this.abort.signal });
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('button');

      if (button && button.dataset.action !== 'export') { this.closeExportMenu(); }
      if (button?.dataset.exportMode) {
        this.exportMenu.hidden = true;
        exportButton.setAttribute('aria-expanded', 'false');
        onMenu(false);
        onCommand('export', { mode: button.dataset.exportMode });
      } else if (button?.dataset.action === 'export') {
        this.exportMenu.hidden = !this.exportMenu.hidden;
        exportButton.setAttribute('aria-expanded', String(!this.exportMenu.hidden));
        onMenu(!this.exportMenu.hidden);
      } else if (button?.dataset.tool) {
        onCommand('configure', { tool: button.dataset.tool, visible: true });
      } else if (button?.dataset.action === 'close') {
        onClose();
      } else if (button?.dataset.action) {
        onCommand(button.dataset.action);
      }
    });
    this.element.querySelector('input[type="color"]').addEventListener('input', (event) => {
      onCommand('configure', { color: event.target.value });
    });
    this.element.querySelectorAll('[data-setting]').forEach((input) => {
      input.addEventListener('input', () => {
        const setting = input.dataset.setting;
        onCommand('configure', { [setting]: Number(input.value) / (setting === 'opacity' ? 100 : 1) });
      });
    });

    if (!desktop) {
      this.enableDrag();
    }
  }

  closeExportMenu() {
    if (!this.exportMenu.hidden) {
      this.exportMenu.hidden = true;
      this.element.querySelector('[data-action="export"]').setAttribute('aria-expanded', 'false');
      this.onMenu(false);
    }
  }

  destroy() {
    this.abort.abort();
    this.element.remove();
  }

  enableDrag() {
    const grip = this.element.querySelector('.drawing-grip');
    let offset = null;
    grip.addEventListener('pointerdown', (event) => {
      const rect = this.element.getBoundingClientRect();
      offset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      grip.setPointerCapture(event.pointerId);
    });
    grip.addEventListener('pointermove', (event) => {
      if (!offset) {
        return;
      }

      this.element.style.transform = 'none';
      this.element.style.left = `${Math.max(0, Math.min(window.innerWidth - this.element.offsetWidth, event.clientX - offset.x))}px`;
      this.element.style.top = `${Math.max(0, Math.min(window.innerHeight - this.element.offsetHeight, event.clientY - offset.y))}px`;
    });
    grip.addEventListener('pointerup', () => { offset = null; });
    grip.addEventListener('lostpointercapture', () => { offset = null; });
  }

  update(state) {
    this.element.querySelector('[data-action="export"]').disabled = Boolean(state.exporting);
    for (const button of this.exportMenu.querySelectorAll('button')) {
      button.disabled = Boolean(state.exporting);
    }
    for (const button of this.element.querySelectorAll('[data-tool]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
    }

    this.element.querySelector('[data-action="undo"]').disabled = !state.canUndo;
    this.element.querySelector('[data-action="redo"]').disabled = !state.canRedo;
    this.element.querySelector('[data-action="visibility"]').setAttribute('aria-pressed', String(!state.visible));
    this.element.querySelector('input[type="color"]').value = state.color;
    this.element.querySelector('[data-setting="width"]').value = state.width;
    this.element.querySelector('[data-setting="opacity"]').value = state.opacity * 100;
    this.element.querySelector('[data-output="width"]').value = `${state.width}px`;
    this.element.querySelector('[data-output="opacity"]').value = `${Math.round(state.opacity * 100)}%`;
  }

  showError(message) {
    this.element.querySelector('.drawing-status').textContent = message;
  }
}

export default DrawingToolbar;
