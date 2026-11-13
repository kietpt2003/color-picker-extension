export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeColor({ r, g, b, a = 1 }) {
  return {
    r: Math.round(clamp(r, 0, 255)),
    g: Math.round(clamp(g, 0, 255)),
    b: Math.round(clamp(b, 0, 255)),
    a: Math.round(clamp(a, 0, 1) * 1000) / 1000,
  };
}

export function isColor(value) {
  return value && ['r', 'g', 'b', 'a'].every((key) => {
    return typeof value[key] === 'number' && Number.isFinite(value[key]);
  }) && value.r >= 0 && value.r <= 255 && value.g >= 0 && value.g <= 255
    && value.b >= 0 && value.b <= 255 && value.a >= 0 && value.a <= 1;
}

export function toHex(color, alpha = false) {
  const channels = [color.r, color.g, color.b];

  if (alpha) {
    channels.push(color.a * 255);
  }

  return `#${channels.map((value) => {
    return Math.round(value).toString(16).padStart(2, '0');
  }).join('').toUpperCase()}`;
}

export function toHsv({ r, g, b }) {
  const channels = [r / 255, g / 255, b / 255];
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);
  const delta = maximum - minimum;
  let h = 0;

  if (delta) {
    if (maximum === channels[0]) {
      h = ((channels[1] - channels[2]) / delta) % 6;
    } else if (maximum === channels[1]) {
      h = (channels[2] - channels[0]) / delta + 2;
    } else {
      h = (channels[0] - channels[1]) / delta + 4;
    }
  }

  return { h: (h * 60 + 360) % 360, s: maximum ? delta / maximum : 0, v: maximum };
}

export function fromHsv(h, s, v, a = 1) {
  const hue = ((h % 360) + 360) % 360 / 60;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(hue % 2 - 1));
  const match = v - chroma;
  const sectors = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
  const [r, g, b] = sectors[Math.floor(hue)];

  return normalizeColor({ r: (r + match) * 255, g: (g + match) * 255, b: (b + match) * 255, a });
}

export function toHsl(color) {
  const { h, s, v } = toHsv(color);
  const l = v * (1 - s / 2);
  return { h, s: l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l };
}

export function formatColor(color, format) {
  const { r, g, b, a } = color;
  const { h, s, l } = toHsl(color);
  const hsv = toHsv(color);

  switch (format) {
    case 'hex': return toHex(color);
    case 'hex8': return toHex(color, true);
    case 'rgb': return `rgb(${r}, ${g}, ${b})`;
    case 'rgba': return `rgba(${r}, ${g}, ${b}, ${a})`;
    case 'hsl': return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
    case 'hsla': return `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${a})`;
    case 'hsv': return `hsv(${Math.round(hsv.h)}, ${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%)`;
    default: throw new Error('Unknown color format');
  }
}

export function parseColor(text) {
  const input = text.trim();
  const hex = input.match(/^#?([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);

  if (hex) {
    let digits = hex[1];

    if (digits.length <= 4) {
      digits = [...digits].map((digit) => { return digit + digit; }).join('');
    }

    return normalizeColor({
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
    });
  }

  const functional = input.match(/^(rgba?|hsla?|hsv)\((.*)\)$/i);

  if (!functional) {
    return null;
  }

  const type = functional[1].toLowerCase();
  const parts = functional[2].trim().split(/[\s,/]+/);
  const hasAlpha = parts.length === 4;

  if (parts.length < 3 || parts.length > 4 || (type.endsWith('a') && !hasAlpha) || (type === 'hsv' && hasAlpha)) {
    return null;
  }

  if (!parts.every((part) => { return /^[-+]?(?:\d+\.?\d*|\.\d+)%?$/.test(part); })) {
    return null;
  }

  const values = parts.map((part) => { return parseFloat(part); });
  if (values.some((value) => { return !Number.isFinite(value); })) {
    return null;
  }

  const alpha = hasAlpha ? values[3] / (parts[3].endsWith('%') ? 100 : 1) : 1;

  if (alpha < 0 || alpha > 1) {
    return null;
  }

  if (type.startsWith('rgb')) {
    const channels = values.slice(0, 3).map((value, index) => {
      return parts[index].endsWith('%') ? value / 100 * 255 : value;
    });

    if (channels.some((value) => { return value < 0 || value > 255; })) {
      return null;
    }

    return normalizeColor({ r: channels[0], g: channels[1], b: channels[2], a: alpha });
  }

  if (parts[0].endsWith('%') || !parts[1].endsWith('%') || !parts[2].endsWith('%') || values[1] < 0 || values[1] > 100 || values[2] < 0 || values[2] > 100) {
    return null;
  }

  const [h, saturation, level] = values;
  const s = saturation / 100;
  const l = level / 100;

  if (type === 'hsv') {
    return fromHsv(h, s, l, alpha);
  }

  const v = l + s * Math.min(l, 1 - l);
  return fromHsv(h, v ? 2 * (1 - l / v) : 0, v, alpha);
}
