import { clamp, normalizeColor } from './color.js';

export const imageLimits = { bytes: 32 * 1024 * 1024, pixels: 16 * 1024 * 1024 };
export const imagePageSize = 48;

export function packPixel(r, g, b, a) {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

export function unpackPixel(value) {
  return normalizeColor({ r: value >>> 24, g: (value >>> 16) & 255, b: (value >>> 8) & 255, a: (value & 255) / 255 });
}

export function pixelHex(value) {
  const hex = value.toString(16).padStart(8, '0').toUpperCase();
  return `#${(value & 255) === 255 ? hex.slice(0, 6) : hex}`;
}

export function imagePoint(clientX, clientY, rect, width, height) {
  return {
    x: clamp(Math.floor((clientX - rect.left) / rect.width * width), 0, width - 1),
    y: clamp(Math.floor((clientY - rect.top) / rect.height * height), 0, height - 1),
  };
}

export function countImageColors(bytes) {
  // NOTE: Sort packed original pixels in place to bound memory, without quantizing or sampling.
  const pixels = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);

  for (let index = 0; index < pixels.length; index++) {
    const offset = index * 4;
    pixels[index] = packPixel(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  }

  pixels.sort();
  let total = 0;

  for (let index = 0; index < pixels.length; index++) {
    if (!index || pixels[index] !== pixels[index - 1]) {
      total += 1;
    }
  }

  const colors = new Uint32Array(total);
  const counts = new Uint32Array(total);
  let entry = -1;

  for (let index = 0; index < pixels.length; index++) {
    if (!index || pixels[index] !== pixels[index - 1]) {
      entry += 1;
      colors[entry] = pixels[index];
    }

    counts[entry] += 1;
  }

  return { colors, counts };
}
