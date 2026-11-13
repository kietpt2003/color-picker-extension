import { isColor, normalizeColor, toHex } from './color.js';
import { normalizeLanguage } from './i18n.js';

export const defaultColor = { r: 124, g: 92, b: 252, a: 1 };

export function sanitizeColors(colors, limit) {
  if (!Array.isArray(colors)) {
    return [];
  }

  const unique = new Map();

  for (const color of colors.filter(isColor)) {
    unique.set(toHex(color, true), normalizeColor(color));
  }

  return [...unique.values()].slice(0, limit);
}

export function sanitizeState(data = {}) {
  return {
    language: normalizeLanguage(data.language),
    color: isColor(data.color) ? normalizeColor(data.color) : { ...defaultColor },
    recent: sanitizeColors(data.recent, 16),
    palette: sanitizeColors(data.palette, 48),
  };
}

export function addRecent(colors, color) {
  return sanitizeColors([color, ...colors], 16);
}
