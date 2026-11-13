import { formatColor } from '../core/color.js';
import { imageLimits, imagePageSize, imagePoint, packPixel, pixelHex, unpackPixel } from '../core/imageColors.js';

const $ = (id) => { return document.getElementById(id); };

class ImagePicker {
  constructor({ t, notify, onSelect }) {
    this.t = t;
    this.notify = notify;
    this.onSelect = onSelect;
    this.canvas = $('imageCanvas');
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });
    this.worker = null;
    this.token = 0;
    this.total = 0;
    this.page = 0;
    this.entries = [];
    this.point = null;
    this.loading = false;
    this.exporting = false;
    this.dragDepth = 0;
    this.bindEvents();
  }

  bindEvents() {
    $('imageFile').addEventListener('change', () => {
      const [file] = $('imageFile').files;
      $('imageFile').value = '';

      if (file) {
        this.receive(file);
      }
    });
    document.addEventListener('paste', (event) => {
      const items = [...(event.clipboardData?.items || [])];
      const file = items.find((item) => { return item.kind === 'file' && item.type.startsWith('image/'); })?.getAsFile()
        || [...(event.clipboardData?.files || [])].find((entry) => { return entry.type.startsWith('image/'); });

      if (file) {
        event.preventDefault();
        this.receive(file);
      }
    });
    document.addEventListener('dragenter', (event) => {
      if ([...(event.dataTransfer?.types || [])].includes('Files')) {
        event.preventDefault();
        this.dragDepth += 1;
        $('imageDropOverlay').hidden = false;
      }
    });
    document.addEventListener('dragover', (event) => {
      if ([...(event.dataTransfer?.types || [])].includes('Files')) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    });
    document.addEventListener('dragleave', () => {
      this.dragDepth = Math.max(0, this.dragDepth - 1);

      if (!this.dragDepth) {
        this.resetDrop();
      }
    });
    document.addEventListener('drop', (event) => {
      this.resetDrop();
      const files = [...(event.dataTransfer?.files || [])];

      if (files.length || [...(event.dataTransfer?.types || [])].includes('Files')) {
        event.preventDefault();
        const file = files.find((entry) => { return entry.type.startsWith('image/'); }) || files[0];

        if (file) {
          this.receive(file);
        }
      }
    });
    document.addEventListener('dragend', () => { this.resetDrop(); });
    window.addEventListener('blur', () => { this.resetDrop(); });
    this.canvas.addEventListener('pointerleave', () => { $('imageLens').hidden = true; });
    this.canvas.addEventListener('blur', () => { $('imageLens').hidden = true; });
    this.canvas.addEventListener('focus', () => {
      if (this.point) {
        this.showPixel(this.point);
      }
    });
    $('removeImage').addEventListener('click', () => { this.clear(); });
    $('imagePrevious').addEventListener('click', () => { this.requestPage(this.page - 1); });
    $('imageNext').addEventListener('click', () => { this.requestPage(this.page + 1); });
    $('imagePageForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = Number($('imagePageNumber').value);

      if (Number.isInteger(value) && value >= 1 && value <= Math.ceil(this.total / imagePageSize)) {
        this.requestPage(value - 1);
      }
    });
    $('exportImageColors').addEventListener('click', () => {
      if (this.worker && this.total && !this.exporting) {
        this.exporting = true;
        this.localize();
        this.worker.postMessage({ type: 'export' });
      }
    });
    this.canvas.addEventListener('pointermove', (event) => { this.inspect(event); });
    this.canvas.addEventListener('pointerdown', (event) => { this.inspect(event); });
    this.canvas.addEventListener('click', (event) => {
      this.inspect(event);
      this.selectPixel();
    });
    this.canvas.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.selectPixel();
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const point = this.point || { x: 0, y: 0 };
        const step = event.shiftKey ? 10 : 1;
        const x = Math.max(0, Math.min(this.canvas.width - 1, point.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)));
        const y = Math.max(0, Math.min(this.canvas.height - 1, point.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)));
        this.showPixel({ x, y });
      }
    });
  }

  receive(file) {
    $('imageSource').click();
    this.load(file);
  }

  resetDrop() {
    this.dragDepth = 0;
    $('imageDropOverlay').hidden = true;
  }

  clear() {
    this.token += 1;
    this.worker?.terminate();
    this.worker = null;
    this.total = 0;
    this.page = 0;
    this.entries = [];
    this.point = null;
    this.loading = false;
    this.exporting = false;
    $('imageLens').hidden = true;
    this.canvas.width = 1;
    this.canvas.height = 1;
    $('imageContent').hidden = true;
    $('imageInventory').hidden = true;
    $('imageMetadata').textContent = '';
    $('imageColors').replaceChildren();
    this.localize();
  }

  async load(file) {
    if (file.size > imageLimits.bytes) {
      this.notify('imageTooLarge', true);
      return;
    }

    if (!/^image\/(png|jpeg|webp|gif|avif|bmp|x-ms-bmp)$/i.test(file.type) && !(file.type === '' && /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name))) {
      this.notify('imageUnsupported', true);
      return;
    }

    this.clear();
    const token = this.token;
    this.loading = true;
    this.localize();
    let bitmap;

    try {
      bitmap = await createImageBitmap(file);

      if (token !== this.token) {
        return;
      }

      if (bitmap.width * bitmap.height > imageLimits.pixels) {
        this.notify('imageDimensionsTooLarge', true);
        return;
      }

      this.canvas.width = bitmap.width;
      this.canvas.height = bitmap.height;
      this.context.drawImage(bitmap, 0, 0);
      const pixels = this.context.getImageData(0, 0, bitmap.width, bitmap.height);
      $('imageMetadata').textContent = `${file.name} · ${bitmap.width} × ${bitmap.height}`;
      $('imageContent').hidden = false;
      this.showPixel({ x: 0, y: 0 }, false);
      this.worker = new Worker(new URL('../core/imageWorker.js', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', ({ data }) => {
        if (token !== this.token) {
          return;
        }

        if (data.type === 'ready') {
          this.loading = false;
          this.total = data.total;
          $('imageInventory').hidden = false;
          this.requestPage(0);
        } else if (data.type === 'page') {
          this.page = data.page;
          this.entries = data.entries;
          this.renderEntries();
        } else if (data.type === 'export') {
          this.exporting = false;
          const url = URL.createObjectURL(data.blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'color-picker-image-colors.csv';
          link.click();
          setTimeout(() => { URL.revokeObjectURL(url); }, 30000);
        } else if (data.type === 'error') {
          this.loading = false;
          this.exporting = false;
          this.notify(data.operation === 'export' ? 'imageExportError' : 'imageAnalyzeError', true);
        }

        this.localize();
      });
      this.worker.addEventListener('error', () => {
        if (token === this.token) {
          this.loading = false;
          this.exporting = false;
          this.notify('imageAnalyzeError', true);
          this.localize();
        }
      });
      this.worker.postMessage({ type: 'analyze', buffer: pixels.data.buffer }, [pixels.data.buffer]);
    } catch {
      if (token === this.token) {
        this.notify('imageLoadError', true);
      }
    } finally {
      bitmap?.close();

      if (token === this.token && !this.worker) {
        this.loading = false;
        this.localize();
      }
    }
  }

  requestPage(page) {
    if (this.worker && this.total) {
      this.worker.postMessage({ type: 'page', page });
    }
  }

  inspect(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.showPixel(imagePoint(event.clientX, event.clientY, rect, this.canvas.width, this.canvas.height), true, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  showPixel(point, showLens = true, pointer = null) {
    this.point = point;
    const [r, g, b, a] = this.context.getImageData(point.x, point.y, 1, 1).data;
    this.pixel = packPixel(r, g, b, a);
    const value = pixelHex(this.pixel);
    $('imageHoverCode').textContent = value;
    $('imageHoverRgba').textContent = formatColor(unpackPixel(this.pixel), 'rgba');
    $('imageCoordinates').textContent = `X ${point.x} · Y ${point.y}`;
    $('imageHoverSwatch').style.backgroundColor = formatColor(unpackPixel(this.pixel), 'rgba');
    const marker = $('imageMarker');
    marker.style.left = `${(point.x + 0.5) / this.canvas.width * 100}%`;
    marker.style.top = `${(point.y + 0.5) / this.canvas.height * 100}%`;
    const magnifier = $('imageMagnifier').getContext('2d');
    const cell = 20;
    const radius = 3;
    const size = 140;
    magnifier.clearRect(0, 0, size, size);
    magnifier.imageSmoothingEnabled = false;
    const sourceX = Math.max(0, point.x - radius);
    const sourceY = Math.max(0, point.y - radius);
    const sourceRight = Math.min(this.canvas.width, point.x + radius + 1);
    const sourceBottom = Math.min(this.canvas.height, point.y + radius + 1);
    magnifier.drawImage(this.canvas, sourceX, sourceY, sourceRight - sourceX, sourceBottom - sourceY, (sourceX - point.x + radius) * cell, (sourceY - point.y + radius) * cell, (sourceRight - sourceX) * cell, (sourceBottom - sourceY) * cell);
    magnifier.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    magnifier.lineWidth = 1;
    magnifier.beginPath();

    for (let line = cell; line < size; line += cell) {
      magnifier.moveTo(line + 0.5, 0);
      magnifier.lineTo(line + 0.5, size);
      magnifier.moveTo(0, line + 0.5);
      magnifier.lineTo(size, line + 0.5);
    }

    magnifier.stroke();
    magnifier.strokeStyle = '#F32743';
    magnifier.lineWidth = 2;
    magnifier.strokeRect(60, 60, cell, cell);
    magnifier.lineWidth = 1;
    magnifier.beginPath();
    magnifier.moveTo(70, 61);
    magnifier.lineTo(70, 79);
    magnifier.moveTo(61, 70);
    magnifier.lineTo(79, 70);
    magnifier.stroke();
    const rect = this.canvas.getBoundingClientRect();
    const lens = $('imageLens');
    const x = pointer?.x ?? (point.x + 0.5) / this.canvas.width * rect.width;
    const y = pointer?.y ?? (point.y + 0.5) / this.canvas.height * rect.height;
    const gap = 20;
    const lensSize = 144;
    const rightSpace = rect.width - x;
    const placeRight = rightSpace >= lensSize + gap || rightSpace >= x;
    const left = placeRight ? x + gap : x - gap - lensSize;
    const top = Math.max(0, Math.min(Math.max(0, rect.height - lensSize), y - lensSize / 2));

    lens.style.left = `${left}px`;
    lens.style.top = `${top}px`;
    lens.hidden = !showLens;
  }

  selectPixel() {
    if (this.point) {
      this.onSelect(unpackPixel(this.pixel));
      this.notify('imageColorSelected', false, { value: pixelHex(this.pixel) });
    }
  }

  renderEntries() {
    $('imageColors').replaceChildren();

    for (const { value, count } of this.entries) {
      const button = document.createElement('button');
      button.className = 'image-color-entry';
      const swatch = document.createElement('span');
      swatch.className = 'image-color-chip checker';
      const fill = document.createElement('span');
      fill.style.backgroundColor = formatColor(unpackPixel(value), 'rgba');
      swatch.append(fill);
      const code = document.createElement('code');
      code.textContent = pixelHex(value);
      const amount = document.createElement('small');
      amount.textContent = `${count.toLocaleString(document.documentElement.lang)} px`;
      button.title = this.t('restore', { value: pixelHex(value) });
      button.append(swatch, code, amount);
      button.addEventListener('click', () => {
        this.onSelect(unpackPixel(value));
        this.notify('imageColorSelected', false, { value: pixelHex(value) });
      });
      $('imageColors').append(button);
    }
  }

  localize() {
    $('imageProgress').hidden = !this.loading;
    $('imageProgress').textContent = this.t('imageAnalyzing');
    $('imageColorCount').textContent = this.t('imageUniqueCount', { count: this.total.toLocaleString(document.documentElement.lang) });
    $('imagePrevious').disabled = this.page === 0;
    $('imageNext').disabled = (this.page + 1) * imagePageSize >= this.total;
    $('imagePageNumber').value = this.page + 1;
    $('imagePageNumber').max = Math.max(1, Math.ceil(this.total / imagePageSize));
    $('imagePageTotal').textContent = `/ ${Math.max(1, Math.ceil(this.total / imagePageSize)).toLocaleString(document.documentElement.lang)}`;
    $('exportImageColors').disabled = this.exporting || !this.total;
    $('exportImageColors').textContent = this.t(this.exporting ? 'imageExporting' : 'imageExport');

    if (this.entries.length) {
      this.renderEntries();
    }
  }
}

export default ImagePicker;
