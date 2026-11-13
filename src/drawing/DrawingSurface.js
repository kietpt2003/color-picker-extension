import { drawingDefaults, paintOperation, sanitizeDrawingConfig } from './model.js';

class DrawingSurface {
  constructor(parent, { config = drawingDefaults, onState = () => {}, onExport = null, onError = () => {}, textHint = '' } = {}) {
    this.parent = parent;
    this.config = sanitizeDrawingConfig(config);
    this.onState = onState;
    this.onExport = onExport;
    this.onError = onError;
    this.textHint = textHint;
    this.exporting = false;
    this.history = [[]];
    this.index = 0;
    this.draft = null;
    this.pointerId = null;
    this.lastPointer = null;
    this.pointerInside = false;
    this.renderFrame = null;
    this.textEditor = null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'drawing-canvas';
    this.canvas.setAttribute('aria-label', 'Drawing surface');
    parent.append(this.canvas);
    this.eraserCursor = document.createElement('div');
    this.eraserCursor.className = 'drawing-eraser-cursor';
    this.eraserCursor.hidden = true;
    this.eraserCursor.setAttribute('aria-hidden', 'true');
    parent.append(this.eraserCursor);
    this.context = this.canvas.getContext('2d');
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize, { signal });
    this.canvas.addEventListener('pointerdown', (event) => { this.start(event); }, { signal });
    this.canvas.addEventListener('pointermove', (event) => { this.move(event); }, { signal });
    window.addEventListener('pointerup', (event) => { this.finish(event); }, { signal, capture: true });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0 && this.draft) {
        this.finish({ pointerId: this.pointerId, clientX: event.clientX, clientY: event.clientY });
      }
    }, { signal, capture: true });
    window.addEventListener('mousemove', (event) => {
      if (this.draft && event.buttons === 0) {
        this.commitDraft();
      }
    }, { signal, capture: true });
    this.canvas.addEventListener('pointercancel', (event) => {
      if (event.pointerId === this.pointerId) {
        this.commitDraft();
      }
      this.pointerInside = false;
      this.updateEraserCursor();
    }, { signal });
    this.canvas.addEventListener('lostpointercapture', (event) => {
      // NOTE: A queued loss from the previous stroke must not end a new captured stroke.
      if (event.pointerId === this.pointerId && !this.canvas.hasPointerCapture(event.pointerId)) {
        this.commitDraft();
      }
    }, { signal });
    this.canvas.addEventListener('pointerleave', (event) => {
      this.pointerInside = false;
      this.updateEraserCursor();
      if (this.draft && event.buttons === 0) {
        this.commitDraft();
      }
    }, { signal });
    window.addEventListener('blur', () => {
      this.commitDraft();
      this.pointerInside = false;
      this.updateEraserCursor();
    }, { signal });
    window.addEventListener('keydown', (event) => {
      if (event.composedPath().some((element) => { return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName); })) {
        return;
      }

      if (event.key === 'Escape') {
        this.command('configure', { tool: 'pointer' });
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        this.command(event.shiftKey ? 'redo' : 'undo');
      }
    }, { signal });
    this.resize();
    this.updateState();
  }

  get operations() {
    return this.history[this.index];
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.ceil(window.innerWidth * ratio);
    this.canvas.height = Math.ceil(window.innerHeight * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.render();
  }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  start(event) {
    if (event.button !== 0 || event.isPrimary === false || this.config.tool === 'pointer' || !this.config.visible) {
      return;
    }

    event.preventDefault();
    this.commitDraft();
    this.commitText();
    const point = this.point(event);
    this.lastPointer = point;
    this.pointerInside = true;
    this.updateEraserCursor();

    if (this.config.tool === 'text') {
      this.beginText(point);
      return;
    }

    this.draft = { ...this.config, points: [point] };
    this.pointerId = event.pointerId;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // NOTE: Window-level release handlers still finalize the stroke if capture is unavailable.
    }
    this.render();
  }

  move(event) {
    this.lastPointer = this.point(event);
    this.pointerInside = true;
    this.updateEraserCursor();

    if (!this.draft || event.pointerId !== this.pointerId) {
      return;
    }

    if (event.buttons === 0) {
      this.commitDraft();
      return;
    }

    this.appendPoints(event);
    this.scheduleRender();
  }

  appendPoints(event) {
    if (['line', 'arrow', 'rectangle', 'ellipse'].includes(this.draft.tool)) {
      this.draft.points[1] = this.point(event);
    } else {
      const samples = event.getCoalescedEvents?.() || [];
      for (const sample of samples.length ? samples : [event]) {
        const point = this.point(sample);
        const previous = this.draft.points[this.draft.points.length - 1];
        if (point.x !== previous.x || point.y !== previous.y) {
          this.draft.points.push(point);
        }
      }
    }
  }

  finish(event) {
    if (!this.draft || event.pointerId !== this.pointerId) {
      return;
    }

    this.appendPoints(event);
    this.commitDraft();
  }

  commitDraft() {
    if (!this.draft) {
      return;
    }

    const operation = this.draft;
    const pointerId = this.pointerId;
    this.draft = null;
    this.pointerId = null;

    if (pointerId !== null && this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }

    this.push([...this.operations, operation]);
  }

  scheduleRender() {
    if (this.renderFrame === null) {
      this.renderFrame = requestAnimationFrame(() => {
        this.renderFrame = null;
        this.render();
      });
    }
  }

  updateEraserCursor() {
    const visible = this.config.tool === 'eraser' && this.config.visible && this.pointerInside && this.lastPointer;
    this.eraserCursor.hidden = !visible;

    if (visible) {
      const diameter = this.config.width * 3;
      this.eraserCursor.style.width = `${diameter}px`;
      this.eraserCursor.style.height = `${diameter}px`;
      this.eraserCursor.style.left = `${this.lastPointer.x}px`;
      this.eraserCursor.style.top = `${this.lastPointer.y}px`;
    }
  }

  beginText(point) {
    const editor = document.createElement('textarea');
    editor.className = 'drawing-text-editor';
    editor.placeholder = this.textHint;
    editor.setAttribute('aria-label', this.textHint);
    editor.style.left = `${Math.min(point.x, Math.max(0, window.innerWidth - 220))}px`;
    editor.style.top = `${Math.min(point.y, Math.max(0, window.innerHeight - 90))}px`;
    editor.style.color = this.config.color;
    editor.style.fontSize = `${Math.max(12, this.config.width * 4)}px`;
    const operation = { ...this.config, points: [point] };
    this.textEditor = { editor, operation };
    editor.addEventListener('blur', () => { this.commitText(); });
    editor.addEventListener('keydown', (event) => {
      event.stopPropagation();

      if (event.key === 'Escape') {
        this.textEditor = null;
        editor.remove();
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        this.commitText();
      }
    });
    this.parent.append(editor);
    editor.focus();
  }

  commitText() {
    if (!this.textEditor) {
      return;
    }

    const { editor, operation } = this.textEditor;
    this.textEditor = null;
    const text = editor.value.trimEnd();
    editor.remove();

    if (text.trim()) {
      this.push([...this.operations, { ...operation, text }]);
    }
  }

  push(operations) {
    this.history = this.history.slice(0, this.index + 1);
    this.history.push(operations);

    if (this.history.length > 101) {
      this.history.shift();
    }

    this.index = this.history.length - 1;
    this.render();
    this.updateState();
  }

  command(action, value = {}) {
    if (this.exporting) { return; }
    if (action === 'configure') {
      const next = sanitizeDrawingConfig(value, this.config);
      if (Object.keys(next).every((key) => { return next[key] === this.config[key]; })) {
        return;
      }
    }

    this.commitDraft();
    this.commitText();

    if (action === 'configure') {
      this.config = sanitizeDrawingConfig(value, this.config);
    } else if (action === 'undo') {
      this.index = Math.max(0, this.index - 1);
    } else if (action === 'redo') {
      this.index = Math.min(this.history.length - 1, this.index + 1);
    } else if (action === 'clear') {
      this.push([]);
    } else if (action === 'visibility') {
      this.config.visible = !this.config.visible;
    } else if (action === 'export') {
      this.export(value.mode || 'drawing');
    }

    this.render();
    this.updateState();
  }

  updateState() {
    this.canvas.style.pointerEvents = this.config.tool === 'pointer' || !this.config.visible ? 'none' : 'auto';
    this.canvas.style.visibility = this.config.visible ? 'visible' : 'hidden';
    this.canvas.style.cursor = this.config.tool === 'eraser' ? 'none' : this.config.tool === 'text' ? 'text' : 'crosshair';
    this.updateEraserCursor();
    this.onState({ ...this.config, exporting: this.exporting, canUndo: this.index > 0, canRedo: this.index < this.history.length - 1 });
  }

  render() {
    if (this.renderFrame !== null) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }

    this.context.save();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.restore();

    for (const operation of this.operations) {
      paintOperation(this.context, operation);
    }

    if (this.draft) {
      paintOperation(this.context, this.draft);
    }
  }

  async export(mode = 'drawing') {
    if (this.exporting) { return; }
    this.exporting = true;
    this.updateState();
    try {
      const data = this.canvas.toDataURL('image/png');

      if (this.onExport) {
        await this.onExport(data, mode);
      } else {
        const link = document.createElement('a');
        link.href = data;
        link.download = 'color-picker-drawing.png';
        link.click();
      }
    } catch (error) {
      if (error.message !== 'drawCaptureCanceled') {
        this.onError(error);
      }
    } finally {
      this.exporting = false;
      this.updateState();
    }
  }

  selectRegion() {
    return new Promise((resolve, reject) => {
      const layer = document.createElement('div');
      layer.className = 'drawing-region-layer';
      const box = document.createElement('div');
      box.className = 'drawing-region-box';
      const hint = document.createElement('div');
      hint.className = 'drawing-region-hint';
      hint.textContent = this.regionHint || '';
      layer.append(box, hint);
      this.parent.append(layer);
      let start;
      let selection;
      const cleanup = () => {
        layer.remove();
        window.removeEventListener('keydown', cancel, true);
        window.removeEventListener('blur', canceled);
      };
      const canceled = () => {
        cleanup();
        reject(new Error('drawCaptureCanceled'));
      };
      const cancel = (event) => {
        event.stopImmediatePropagation();
        if (event.key === 'Escape') { event.preventDefault(); canceled(); }
      };
      layer.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) { return; }
        start = { x: event.clientX, y: event.clientY };
        layer.setPointerCapture(event.pointerId);
      });
      layer.addEventListener('pointermove', (event) => {
        if (!start) { return; }
        selection = {
          x: Math.min(start.x, event.clientX), y: Math.min(start.y, event.clientY),
          width: Math.abs(start.x - event.clientX), height: Math.abs(start.y - event.clientY),
        };
        Object.assign(box.style, { left: `${selection.x}px`, top: `${selection.y}px`, width: `${selection.width}px`, height: `${selection.height}px` });
      });
      layer.addEventListener('pointerup', () => {
        if (selection && selection.width >= 2 && selection.height >= 2) { cleanup(); resolve(selection); }
        else { canceled(); }
      });
      layer.addEventListener('pointercancel', canceled);
      window.addEventListener('keydown', cancel, true);
      window.addEventListener('blur', canceled, { once: true });
    });
  }

  destroy() {
    this.abort.abort();
    if (this.renderFrame !== null) { cancelAnimationFrame(this.renderFrame); }
    this.textEditor?.editor.remove();
    this.eraserCursor.remove();
    this.canvas.remove();
  }
}

export default DrawingSurface;
