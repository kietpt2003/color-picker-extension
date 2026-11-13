import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

import { sanitizeDrawingConfig } from '../src/drawing/model.js';
import { formatColor, fromHsv, parseColor, toHex, toHsv, toHsl } from '../src/core/color.js';
import { countImageColors, imagePoint, packPixel, pixelHex, unpackPixel } from '../src/core/imageColors.js';
import { catalogs, normalizeLanguage, translate } from '../src/core/i18n.js';
import { addRecent, sanitizeState } from '../src/core/storage.js';

let checks = 0;

function check(name, callback) {
  callback();
  checks += 1;
  console.info(`✓ ${name}`);
}

check('HEX short, long and alpha formats', () => {
  assert.equal(toHex(parseColor('#f08')), '#FF0088');
  assert.equal(toHex(parseColor('#f08c'), true), '#FF0088CC');
  assert.equal(toHex(parseColor('#43ff64d9'), true), '#43FF64D9');
  assert.equal(toHex(parseColor('#0000'), true), '#00000000');
});

check('RGBA and percent alpha conversions', () => {
  assert.equal(toHex(parseColor('rgba(67, 255, 100, 0.85)'), true), '#43FF64D9');
  assert.equal(toHex(parseColor('rgb(100% 0% 50% / 50%)'), true), '#FF008080');
  assert.equal(formatColor(parseColor('#12345600'), 'rgba'), 'rgba(18, 52, 86, 0)');
});

check('HSL and HSV boundary colors', () => {
  for (const [text, expected] of [['hsl(120, 100%, 50%)', '#00FF00'], ['hsla(240, 100%, 50%, 0.5)', '#0000FF'], ['hsv(360, 100%, 100%)', '#FF0000'], ['hsl(-120 100% 50%)', '#0000FF']]) {
    assert.equal(toHex(parseColor(text)), expected);
  }
  assert.equal(toHsl(parseColor('#fff')).s, 0);
  assert.equal(toHsv(parseColor('#000')).s, 0);
});

check('RGB to HSV to RGB round trips', () => {
  for (let r = 0; r <= 255; r += 17) {
    for (let g = 0; g <= 255; g += 17) {
      for (let b = 0; b <= 255; b += 17) {
        const color = { r, g, b, a: 0.5 };
        const { h, s, v } = toHsv(color);
        assert.deepEqual(fromHsv(h, s, v, color.a), color);
      }
    }
  }
});

check('Reject malformed and out-of-range input', () => {
  for (const value of ['', '#12', '#xyz', 'red', 'rgb(256,0,0)', 'rgba(0,0,0,-1)', 'rgba(0,0,0,2)', 'hsl(0, 101%, 50%)', 'hsl(0, 50, 50)', 'rgba(1,2,3)', 'rgb(1,2,3);alert(1)', 'hsv(0,0%,0%,1)', 'rgb(NaN,0,0)']) {
    assert.equal(parseColor(value), null, value);
  }
});

check('Seven output formats and explicit alpha', () => {
  const color = parseColor('#FF000080');
  assert.equal(formatColor(color, 'hex'), '#FF0000');
  assert.equal(formatColor(color, 'hex8'), '#FF000080');
  assert.equal(formatColor(color, 'rgb'), 'rgb(255, 0, 0)');
  assert.equal(formatColor(color, 'rgba'), 'rgba(255, 0, 0, 0.502)');
  assert.equal(formatColor(color, 'hsl'), 'hsl(0, 100%, 50%)');
  assert.equal(formatColor(color, 'hsla'), 'hsla(0, 100%, 50%, 0.502)');
  assert.equal(formatColor(color, 'hsv'), 'hsv(0, 100%, 100%)');
});

check('All locales have matching keys and interpolation tokens', () => {
  const keys = Object.keys(catalogs.en).sort();
  for (const catalog of Object.values(catalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), keys);
    for (const key of keys) {
      assert.ok(catalog[key].length);
      assert.deepEqual(catalog[key].match(/\{\w+\}/g), catalogs.en[key].match(/\{\w+\}/g));
    }
  }
  assert.equal(normalizeLanguage('unknown'), 'en');
  assert.equal(translate('vi', 'copied', { value: '#FFF' }), 'Đã sao chép #FFF');
});

check('Storage validation, defaults, history limits and deduplication', () => {
  assert.equal(sanitizeState().language, 'en');
  assert.equal(sanitizeState({ color: { r: NaN } }).color.r, 124);
  assert.deepEqual(sanitizeState({ palette: [null, {}, { r: 300, g: 1, b: 1, a: 1 }] }).palette, []);
  let recent = [];
  for (let r = 0; r < 30; r++) {
    recent = addRecent(recent, { r, g: 0, b: 0, a: 1 });
  }
  assert.equal(recent.length, 16);
  recent = addRecent(recent, recent[5]);
  assert.equal(recent.length, 16);
  assert.equal(recent[0].r, 24);
});

check('Exact image histogram keeps all colors and alpha bytes', () => {
  const input = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 128, 0, 0, 0, 0]);
  const { colors, counts } = countImageColors(input);
  assert.deepEqual([...colors], [0, packPixel(0, 255, 0, 255), packPixel(255, 0, 0, 128), packPixel(255, 0, 0, 255)]);
  assert.deepEqual([...counts], [1, 1, 1, 2]);
  assert.equal(pixelHex(colors[2]), '#FF000080');
  assert.equal(pixelHex(colors[3]), '#FF0000');
  assert.equal(unpackPixel(colors[2]).a, 0.502);
  assert.equal(countImageColors(new Uint8ClampedArray()).colors.length, 0);

  const distinct = new Uint8ClampedArray(1024 * 4);
  for (let index = 0; index < 1024; index++) {
    distinct.set([index >>> 8, index & 255, 7, 255], index * 4);
  }
  assert.equal(countImageColors(distinct).colors.length, 1024);
});

check('Pointer maps displayed image to original pixel coordinates and clamps edges', () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  assert.deepEqual(imagePoint(110, 70, rect, 400, 200), { x: 200, y: 100 });
  assert.deepEqual(imagePoint(210, 120, rect, 400, 200), { x: 399, y: 199 });
  assert.deepEqual(imagePoint(-100, 0, rect, 400, 200), { x: 0, y: 0 });
});

check('Drawing tools validate color, size and opacity without losing current settings', () => {
  const config = sanitizeDrawingConfig({ tool: 'text', color: '#123ABC', width: 100, opacity: -2 });
  assert.deepEqual(config, { tool: 'text', color: '#123ABC', width: 40, opacity: 0.05, visible: true });
  assert.deepEqual(sanitizeDrawingConfig({ tool: 'unknown', color: 'red', width: NaN }, config), config);
  assert.equal(sanitizeDrawingConfig({ visible: false }, config).visible, false);
});

const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
check('Minimal MV3 permissions and English default locale', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.default_locale, 'en');
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting', 'desktopCapture']);
  assert.equal(manifest.host_permissions, undefined);
});

async function checkSyntax(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await checkSyntax(path);
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      execFileSync(process.execPath, ['--check', path]);
    }
  }
}

await checkSyntax('src');
await checkSyntax('scripts');
await checkSyntax('desktop');
console.info(`${checks} verification groups passed; JavaScript syntax checked.`);
