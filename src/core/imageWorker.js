import { countImageColors, imagePageSize, pixelHex } from './imageColors.js';

let colors;
let counts;
let exporting = false;

self.addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'analyze') {
      ({ colors, counts } = countImageColors(new Uint8ClampedArray(data.buffer)));
      self.postMessage({ type: 'ready', total: colors.length });
    } else if (data.type === 'page' && colors) {
      const page = Math.max(0, Math.min(Math.ceil(colors.length / imagePageSize) - 1, data.page));
      const start = page * imagePageSize;
      const entries = [];

      for (let index = start; index < Math.min(start + imagePageSize, colors.length); index++) {
        entries.push({ value: colors[index], count: counts[index] });
      }

      self.postMessage({ type: 'page', page, entries });
    } else if (data.type === 'export' && colors && !exporting) {
      exporting = true;
      const chunks = ['HEX,RED,GREEN,BLUE,ALPHA_BYTE,PIXEL_COUNT\r\n'];

      for (let start = 0; start < colors.length; start += 8192) {
        const rows = [];

        for (let index = start; index < Math.min(start + 8192, colors.length); index++) {
          const value = colors[index];
          rows.push(`${pixelHex(value)},${value >>> 24},${(value >>> 16) & 255},${(value >>> 8) & 255},${value & 255},${counts[index]}\r\n`);
        }

        chunks.push(rows.join(''));
      }

      self.postMessage({ type: 'export', blob: new Blob(chunks, { type: 'text/csv;charset=utf-8' }) });
      exporting = false;
    }
  } catch {
    exporting = false;
    self.postMessage({ type: 'error', operation: data.type });
  }
});
