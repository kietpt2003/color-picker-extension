import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const extension = path.resolve('dist/extension');
const extensionId = [...createHash('sha256').update(extension).digest('hex').slice(0, 32)].map((digit) => {
  return String.fromCharCode(97 + parseInt(digit, 16));
}).join('');
const profile = await mkdtemp(path.join(os.tmpdir(), 'color-picker-browser-'));
let context;
const errors = [];
let groups = 0;

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 560, height: 1100 },
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => { errors.push(error.message); });
  await page.goto(`chrome-extension://${extensionId}/ui/popup.html`);
  await expect(page.locator('#pick')).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.format-row')).toHaveCount(7);
  groups++;

  await page.locator('#colorInput').fill('rgba(67, 255, 100, 0.85)');
  await page.locator('#colorForm').evaluate((form) => { form.requestSubmit(); });
  await expect(page.locator('#colorInput')).toHaveValue('#43FF64D9');
  await expect(page.locator('.format-value').nth(1)).toHaveValue('#43FF64D9');
  await page.bringToFront();
  await page.locator('.format-row').nth(3).locator('button').click();
  await expect(page.locator('#notifier')).toHaveText('Copied rgba(67, 255, 100, 0.85)');
  await page.locator('#save').click();
  await expect(page.locator('#palette .swatch')).toHaveCount(1);
  await page.locator('#save').click();
  await expect(page.locator('#palette .swatch')).toHaveCount(1);
  groups++;

  await page.locator('#colorInput').fill('rgba(999, 0, 0, 1)');
  await page.locator('#colorForm').evaluate((form) => { form.requestSubmit(); });
  await expect(page.locator('#colorInput')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#notifier')).toHaveClass('notifier error');
  await page.locator('#palette .swatch').click();
  await expect(page.locator('#colorInput')).toHaveValue('#43FF64D9');
  groups++;

  for (const language of ['vi', 'zh-CN', 'en']) {
    await page.locator('#language').selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
  }
  await page.reload();
  await expect(page.locator('#pick')).toBeEnabled();
  await expect(page.locator('#colorInput')).toHaveValue('#43FF64D9');
  await expect(page.locator('#palette .swatch')).toHaveCount(1);
  groups++;

  await page.locator('#plane').focus();
  const before = await page.locator('#colorInput').inputValue();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#colorInput')).not.toHaveValue(before);
  await page.locator('#alpha').fill('50');
  await page.locator('#alpha').dispatchEvent('change');
  await expect(page.locator('#alphaValue')).toHaveText('50%');
  groups++;

  await page.locator('#colorInput').fill('#000000');
  await page.locator('#colorForm').evaluate((form) => { form.requestSubmit(); });
  await page.locator('#hue').fill('120');
  await page.locator('#hue').dispatchEvent('change');
  await expect.poll(() => { return page.evaluate(async () => { return (await chrome.storage.local.get('color')).color.r; }); }).toBe(0);
  await expect(page.locator('#hue')).toHaveValue('120');

  await page.evaluate(() => {
    window.EyeDropper = class {
      async open() { return { sRGBHex: '#123456' }; }
    };
  });
  await page.locator('#pick').click();
  await expect(page.locator('#colorInput')).toHaveValue('#123456');
  await expect(page.locator('#pick')).toBeEnabled();
  await page.evaluate(() => {
    window.EyeDropper = class {
      async open() { throw new DOMException('Canceled', 'AbortError'); }
    };
  });
  await page.locator('#pick').click();
  await expect(page.locator('#notifier')).toHaveText('Color picking canceled.');
  await expect(page.locator('#colorInput')).toHaveValue('#123456');
  await page.evaluate(() => {
    window.EyeDropper = class {
      async open() { throw new DOMException('Denied', 'NotAllowedError'); }
    };
  });
  await page.locator('#pick').click();
  await expect(page.locator('#notifier')).toHaveClass('notifier error');
  groups++;

  await page.reload();
  await expect(page.locator('#pick')).toBeEnabled();
  const newPagePromise = context.waitForEvent('page');
  await page.locator('#openWindow').click();
  const separate = await newPagePromise;
  await separate.waitForLoadState();
  await expect(separate.locator('body')).toHaveClass('window-mode');
  await expect(separate.locator('#openWindow')).toBeHidden();
  await expect(separate.locator('#colorInput')).toHaveValue('#123456');
  await separate.locator('#language').selectOption('vi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await separate.close();
  groups++;

  await page.locator('#palette .remove-swatch').focus();
  await page.locator('#palette .remove-swatch').click();
  await expect(page.locator('#palette .swatch')).toHaveCount(0);
  await page.locator('#clear').click();
  await expect(page.locator('#recent .swatch')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#pick')).toBeEnabled();
  await expect(page.locator('#palette .swatch')).toHaveCount(0);
  await expect(page.locator('#recent .swatch')).toHaveCount(0);
  groups++;

  await page.evaluate(() => { delete window.EyeDropper; });
  await page.locator('#language').selectOption('en');
  await expect(page.locator('#pick')).toBeDisabled();
  await expect(page.locator('#pickHint')).toContainText('unavailable');
  groups++;

  await page.reload();
  await expect(page.locator('#pick')).toBeEnabled();
  await mkdir('artifacts', { recursive: true });
  for (const language of ['vi', 'zh-CN', 'en']) {
    await page.locator('#language').selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await page.screenshot({ path: `artifacts/color-picker-${language}.png`, fullPage: true });
  }
  await page.locator('#imageSource').click();
  await expect(page.locator('#imagePanel')).toBeVisible();
  const fixture = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 2;
    const context = canvas.getContext('2d');
    context.putImageData(new ImageData(new Uint8ClampedArray([
      255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
      0, 255, 0, 255, 255, 255, 0, 128, 0, 0, 0, 0, 0, 0, 0, 255,
    ]), 4, 2), 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.locator('#imageFile').setInputFiles({ name: 'known-colors.png', mimeType: 'image/png', buffer: fixture });
  await expect(page.locator('#imageColors button')).toHaveCount(6);
  await expect(page.locator('#imageColorCount')).toHaveText('6 unique colors');
  const beforeHover = await page.locator('#colorInput').inputValue();
  const bounds = await page.locator('#imageCanvas').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 2.5 / 4, bounds.y + bounds.height * 0.5 / 2);
  await expect(page.locator('#imageHoverCode')).toHaveText('#00FF00');
  await expect(page.locator('#imageLens')).toBeVisible();
  const lensBounds = await page.locator('#imageLens').boundingBox();
  expect(lensBounds.width).toBe(144);
  expect(lensBounds.height).toBe(144);
  expect(lensBounds.x).toBeGreaterThanOrEqual(bounds.x);
  expect(lensBounds.x + lensBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  const pointerX = bounds.x + bounds.width * 2.5 / 4;
  expect(lensBounds.x >= pointerX + 19 || lensBounds.x + lensBounds.width <= pointerX - 19).toBe(true);
  await page.mouse.move(bounds.x + 15, bounds.y + 15);
  const rightLens = await page.locator('#imageLens').boundingBox();
  expect(rightLens.x).toBeCloseTo(bounds.x + 35, 0);
  expect(rightLens.y).toBeCloseTo(bounds.y, 0);
  await page.mouse.move(bounds.x + bounds.width - 15, bounds.y + bounds.height - 15);
  const leftLens = await page.locator('#imageLens').boundingBox();
  expect(leftLens.x + leftLens.width).toBeCloseTo(bounds.x + bounds.width - 35, 0);
  expect(leftLens.y + leftLens.height).toBeCloseTo(bounds.y + bounds.height, 0);
  await page.mouse.move(bounds.x + bounds.width * 2.5 / 4, bounds.y + bounds.height * 0.5 / 2);
  expect(await page.locator('#imageMagnifier').evaluate((canvas) => {
    return [...canvas.getContext('2d').getImageData(65, 65, 1, 1).data];
  })).toEqual([0, 255, 0, 255]);
  await expect(page.locator('#colorInput')).toHaveValue(beforeHover);
  await page.mouse.click(bounds.x + bounds.width * 2.5 / 4, bounds.y + bounds.height * 0.5 / 2);
  await expect(page.locator('#colorInput')).toHaveValue('#00FF00');
  await page.locator('#imageCanvas').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#imageHoverCode')).toHaveText('#FFFF0080');
  await page.keyboard.press('Enter');
  await expect(page.locator('#colorInput')).toHaveValue('#FFFF0080');
  await page.locator('#imageColors button').filter({ hasText: '#FF0000' }).click();
  await expect(page.locator('#colorInput')).toHaveValue('#FF0000');
  groups++;

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportImageColors').click();
  const download = await downloadPromise;
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv).toContain('#FF0000,255,0,0,255,2');
  expect(csv).toContain('#FFFF0080,255,255,0,128,1');
  expect(csv.trim().split('\r\n')).toHaveLength(7);
  groups++;

  for (const language of ['vi', 'zh-CN', 'en']) {
    await page.locator('#language').selectOption(language);
    await expect(page.locator('#imageColors button')).toHaveCount(6);
    await expect(page.locator('#imageColorCount')).not.toHaveText('imageUniqueCount');
  }
  await page.locator('#notifier').evaluate((element) => { element.hidden = true; });
  await page.screenshot({ path: 'artifacts/color-picker-image-preview.png', fullPage: true });
  const manyColors = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 1;
    const bytes = new Uint8ClampedArray(400);
    for (let index = 0; index < 100; index++) {
      bytes.set([0, index, 0, 255], index * 4);
    }
    canvas.getContext('2d').putImageData(new ImageData(bytes, 100, 1), 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.locator('#imageFile').setInputFiles({ name: '100-colors.png', mimeType: 'image/png', buffer: manyColors });
  await expect(page.locator('#imageColorCount')).toHaveText('100 unique colors');
  await expect(page.locator('#imageColors button')).toHaveCount(48);
  await page.locator('#imageNext').click();
  await expect(page.locator('#imagePageNumber')).toHaveValue('2');
  await expect(page.locator('#imageColors button')).toHaveCount(48);
  await page.locator('#imageNext').click();
  await expect(page.locator('#imagePageNumber')).toHaveValue('3');
  await expect(page.locator('#imageColors button')).toHaveCount(4);
  await expect(page.locator('#imageNext')).toBeDisabled();
  await page.locator('#imagePageNumber').fill('1');
  await page.locator('#imagePageForm').evaluate((form) => { form.requestSubmit(); });
  await expect(page.locator('#imageColors button')).toHaveCount(48);
  groups++;

  await page.locator('#imageFile').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await expect(page.locator('#notifier')).toHaveText('Choose a PNG, JPG, WebP, GIF, AVIF or BMP image.');
  await expect(page.locator('#imageColorCount')).toHaveText('100 unique colors');
  await page.locator('#imageFile').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid png') });
  await expect(page.locator('#notifier')).toContainText('Could not read this image');
  await expect(page.locator('#imageInventory')).toBeHidden();
  await page.locator('#imageFile').setInputFiles({ name: 'known-colors.png', mimeType: 'image/png', buffer: fixture });
  await expect(page.locator('#imageColors button')).toHaveCount(6);
  await page.locator('#removeImage').click();
  await expect(page.locator('#imageContent')).toBeHidden();
  await expect(page.locator('#imageInventory')).toBeHidden();
  await page.locator('#screenSource').click();
  await expect(page.locator('#screenPanel')).toBeVisible();
  groups++;

  const transfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => { return character.charCodeAt(0); });
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'dropped-colors.png', { type: 'image/png' }));
    return data;
  }, fixture.toString('base64'));
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer });
  await expect(page.locator('#imageDropOverlay')).toBeVisible();
  await page.dispatchEvent('body', 'dragleave', { dataTransfer: transfer });
  await expect(page.locator('#imageDropOverlay')).toBeHidden();
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer });
  await page.dispatchEvent('body', 'drop', { dataTransfer: transfer });
  await expect(page.locator('#imageDropOverlay')).toBeHidden();
  await expect(page.locator('#imageSource')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#imageColors button')).toHaveCount(6);
  await expect(page.locator('#imageMetadata')).toContainText('dropped-colors.png');
  await transfer.dispose();
  groups++;

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.bringToFront();
  await page.locator('#screenSource').click();
  await page.evaluate(async (base64) => {
    try {
      const bytes = Uint8Array.from(atob(base64), (character) => { return character.charCodeAt(0); });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    } catch (error) {
      throw new Error(`Could not prepare clipboard test: ${error.message}`);
    }
  }, manyColors.toString('base64'));
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.locator('#imageSource')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#imageColorCount')).toHaveText('100 unique colors');
  await page.locator('#screenSource').click();
  await page.locator('#colorInput').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.evaluate(async () => {
    try { await navigator.clipboard.writeText('#ABCDEF'); } catch (error) { throw error; }
  });
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.locator('#colorInput')).toHaveValue('#ABCDEF');
  await expect(page.locator('#screenSource')).toHaveAttribute('aria-selected', 'true');
  groups++;

  await page.locator('#imageSource').click();
  await page.locator('#imageFile').setInputFiles({ name: 'known-colors.png', mimeType: 'image/png', buffer: fixture });
  await expect(page.locator('#imageColors button')).toHaveCount(6);
  await page.locator('#imageCanvas').scrollIntoViewIfNeeded();
  const previewBounds = await page.locator('#imageCanvas').boundingBox();
  await page.mouse.move(previewBounds.x + previewBounds.width * 0.7, previewBounds.y + previewBounds.height * 0.3);
  await expect(page.locator('#imageLens')).toBeVisible();
  await page.locator('#notifier').evaluate((element) => { element.hidden = true; });
  await page.screenshot({ path: 'artifacts/color-picker-image-lens-preview.png', fullPage: true });
  await page.mouse.move(5, 5);
  await expect(page.locator('#imageLens')).toBeHidden();
  groups++;

  const setupPromise = context.waitForEvent('page');
  await page.locator('#drawDesktop').click();
  const setup = await setupPromise;
  await setup.waitForLoadState();
  await expect(setup.locator('#launchDesktop')).toHaveAttribute('href', /^color-picker-draw:\/\/open\?/);
  await expect(setup.locator('h1')).toHaveText('Draw over your desktop');
  await setup.close();
  groups++;

  await page.locator('#notifier').evaluate((element) => { element.hidden = true; });
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/color-picker-preview.png', fullPage: true });
  if (errors.length) { throw new Error(errors.join('\n')); }
  console.info(`${groups} browser verification groups passed using real unpacked MV3 extension; EyeDropper results mocked.`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
