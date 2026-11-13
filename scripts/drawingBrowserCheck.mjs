import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const extension = path.resolve('dist/extension');
const id = [...createHash('sha256').update(extension).digest('hex').slice(0, 32)].map((digit) => {
  return String.fromCharCode(97 + parseInt(digit, 16));
}).join('');
let context;
let server;
const profile = await mkdtemp(path.join(os.tmpdir(), 'color-picker-draw-web-'));
const errors = [];

try {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><body style="margin:0;background:#f3f5fa"><h1 style="margin:180px 40px 0">A real webpage</h1><button id="underneath" style="position:absolute;left:50px;top:400px" onclick="this.textContent=\'Clicked\'">Use page</button></body></html>');
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => { errors.push(error.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  // NOTE: Import the shipped web-accessible module on the fixture; activeTab grants need a real toolbar action.
  await page.evaluate(async (url) => {
    try {
      const { mountWebDrawing } = await import(url);
      mountWebDrawing({ language: 'en', color: '#FF0000' });
    } catch (error) { throw error; }
  }, `chrome-extension://${id}/drawing/webOverlay.js`);
  const host = page.locator('#color-picker-drawing-overlay');
  const canvas = host.locator('canvas');
  await expect(host.locator('.drawing-toolbar')).toBeVisible();
  const pixel = async (x, y) => {
    try {
      return await canvas.evaluate((element, point) => {
        const ratio = element.width / window.innerWidth;
        return [...element.getContext('2d').getImageData(point.x * ratio, point.y * ratio, 1, 1).data];
      }, { x, y });
    } catch (error) { throw error; }
  };
  const stroke = async (x, y, endX, endY) => {
    try {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(endX, endY, { steps: 12 });
      await page.mouse.up();
    } catch (error) { throw error; }
  };
  // NOTE: Fast release must commit once, and later hover must never extend the stroke.
  for (let index = 0; index < 12; index++) {
    const y = 500 + index * 10;
    await page.mouse.move(100, y);
    await page.mouse.down();
    await page.mouse.move(180, y);
    await page.mouse.up();
    await page.mouse.move(250, y);
    expect((await pixel(140, y))[3]).toBe(255);
    expect((await pixel(220, y))[3]).toBe(0);
  }
  for (let index = 0; index < 4; index++) {
    await page.mouse.click(100 + index * 20, 650);
    expect((await pixel(100 + index * 20, 650))[3]).toBe(255);
  }
  await host.locator('[data-action="clear"]').click();

  await canvas.evaluate((element) => {
    const emit = (type, x, y, buttons = 1) => {
      element.dispatchEvent(new PointerEvent(type, { pointerId: 91, isPrimary: true, pointerType: 'mouse', button: 0, buttons, clientX: x, clientY: y, bubbles: true, composed: true }));
    };
    emit('pointerdown', 100, 500);
    emit('pointermove', 180, 500);
    emit('lostpointercapture', 180, 500);
    emit('pointermove', 250, 500, 0);
  });
  expect((await pixel(140, 500))[3]).toBe(255);
  expect((await pixel(220, 500))[3]).toBe(0);
  await host.locator('[data-action="undo"]').click();
  expect((await pixel(140, 500))[3]).toBe(0);

  await canvas.evaluate((element) => {
    element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 92, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1, clientX: 100, clientY: 520, bubbles: true, composed: true }));
    element.dispatchEvent(new PointerEvent('pointermove', { pointerId: 92, isPrimary: true, pointerType: 'mouse', buttons: 1, clientX: 160, clientY: 520, bubbles: true, composed: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 92, button: 0, buttons: 0, clientX: 180, clientY: 520 }));
    element.dispatchEvent(new PointerEvent('pointermove', { pointerId: 92, buttons: 0, clientX: 250, clientY: 520, bubbles: true, composed: true }));
  });
  expect((await pixel(140, 520))[3]).toBe(255);
  expect((await pixel(220, 520))[3]).toBe(0);
  await host.locator('[data-action="clear"]').click();

  await page.mouse.move(100, 540);
  await page.mouse.down();
  await page.mouse.move(140, 540);
  await page.evaluate(async (url) => {
    try {
      const { mountWebDrawing } = await import(url);
      mountWebDrawing({ language: 'en', color: '#FF0000' });
    } catch (error) { throw error; }
  }, `chrome-extension://${id}/drawing/webOverlay.js`);
  await page.mouse.move(180, 540);
  await page.mouse.up();
  expect((await pixel(120, 540))[3]).toBe(255);
  expect((await pixel(160, 540))[3]).toBe(255);
  await host.locator('[data-action="undo"]').click();
  expect((await pixel(120, 540))[3]).toBe(0);
  expect((await pixel(160, 540))[3]).toBe(0);
  await host.locator('[data-action="clear"]').click();

  await stroke(350, 300, 500, 300);
  expect((await pixel(420, 300))[3]).toBe(255);
  await host.locator('[data-tool="highlighter"]').click();
  await stroke(350, 350, 500, 350);
  expect((await pixel(420, 350))[3]).toBeGreaterThan(70);
  expect((await pixel(420, 350))[3]).toBeLessThan(110);
  await host.locator('[data-tool="eraser"]').click();
  await page.mouse.move(420, 300);
  const eraserCursor = host.locator('.drawing-eraser-cursor');
  await expect(eraserCursor).toBeVisible();
  let cursorBounds = await eraserCursor.boundingBox();
  expect(cursorBounds.width).toBe(15);
  expect(cursorBounds.height).toBe(15);
  expect(cursorBounds.x + cursorBounds.width / 2).toBeCloseTo(420, 0);
  expect(cursorBounds.y + cursorBounds.height / 2).toBeCloseTo(300, 0);
  await host.locator('[data-setting="width"]').hover();
  await host.locator('[data-setting="width"]').fill('8');
  await expect(eraserCursor).toBeHidden();
  await page.mouse.move(420, 300);
  await expect(eraserCursor).toBeVisible();
  cursorBounds = await eraserCursor.boundingBox();
  expect(cursorBounds.width).toBe(24);
  await page.screenshot({ path: 'artifacts/drawing-eraser-preview.png' });
  await host.locator('[data-setting="width"]').fill('5');
  await page.mouse.click(480, 300);
  expect((await pixel(480, 300))[3]).toBe(0);
  await host.locator('[data-action="undo"]').click();
  expect((await pixel(480, 300))[3]).toBe(255);
  await stroke(410, 300, 430, 300);
  expect((await pixel(420, 300))[3]).toBe(0);
  await host.locator('[data-action="undo"]').click();
  expect((await pixel(420, 300))[3]).toBe(255);
  await host.locator('[data-action="redo"]').click();
  expect((await pixel(420, 300))[3]).toBe(0);
  await host.locator('[data-tool="text"]').click();
  await expect(eraserCursor).toBeHidden();
  await page.mouse.click(450, 430);
  await host.locator('textarea').fill('Hello Color Picker\nSecond line');
  await host.locator('textarea').press('ControlOrMeta+Enter');
  await expect(host.locator('textarea')).toHaveCount(0);
  expect(await canvas.evaluate((element) => {
    const ratio = element.width / innerWidth;
    return element.getContext('2d').getImageData(450 * ratio, 430 * ratio, 220 * ratio, 60 * ratio).data.some((value, index) => { return index % 4 === 3 && value > 0; });
  })).toBe(true);
  for (const tool of ['rectangle', 'ellipse', 'line', 'arrow']) {
    await host.locator(`[data-tool="${tool}"]`).click();
    await stroke(700, 350, 830, 460);
  }
  const downloadPromise = page.waitForEvent('download');
  await host.locator('[data-action="export"]').click();
  await host.locator('[data-export-mode="drawing"]').click();
  const download = await downloadPromise;
  const png = await readFile(await download.path());
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await host.locator('[data-tool="pointer"]').click();
  await page.locator('#underneath').click();
  await expect(page.locator('#underneath')).toHaveText('Clicked');
  await host.locator('[data-action="clear"]').click();
  expect((await pixel(420, 350))[3]).toBe(0);
  await host.locator('[data-action="undo"]').click();
  expect((await pixel(420, 350))[3]).toBeGreaterThan(0);
  await host.locator('[data-action="visibility"]').click();
  await expect(canvas).toBeHidden();
  await host.locator('[data-action="visibility"]').click();
  await expect(canvas).toBeVisible();
  await page.screenshot({ path: 'artifacts/drawing-web-preview.png' });
  await host.locator('[data-action="close"]').click();
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
  console.info('Web drawing passed: rapid strokes, lost capture, window release, duplicate config, eraser footprint, pen/text/shapes, undo/redo, clear, passthrough, PNG and close.');
} finally {
  await context?.close();
  if (server) { await new Promise((resolve) => { server.close(resolve); }); }
  await rm(profile, { recursive: true, force: true });
}
