import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let context;
let server;
const temporary = await mkdtemp(path.join(os.tmpdir(), 'color-picker-capture-'));
const extension = `${temporary}/extension`;

try {
  await cp('dist/extension', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(`${extension}/manifest.json`, 'utf8'));
  // NOTE: The isolated harness gets capture access; the shipped manifest still uses activeTab only.
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(`${extension}/manifest.json`, JSON.stringify(manifest));
  let id;
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><body style="margin:0;background:rgb(10,20,30);min-height:100vh"></body></html>');
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  context = await chromium.launchPersistentContext(`${temporary}/profile`, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 800 },
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  id = worker.url().split('/')[2];
  await context.addInitScript(() => {
    if (!location.pathname.endsWith('/screenCapture.html')) { return; }
    chrome.desktopCapture.chooseDesktopMedia = (_sources, callback) => {
      callback(localStorage.getItem('screenTestMode') === 'cancel' ? '' : 'fixture-screen');
      return 1;
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext('2d');
      context.fillStyle = 'rgb(10,20,30)';
      context.fillRect(0, 0, 320, 180);
      context.fillStyle = 'rgb(133,10,15)';
      context.fillRect(100, 80, 50, 10);
      return canvas.captureStream(10);
    };
  });
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/ui/popup.html`);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await control.evaluate(async (id) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (url) => {
          try { const { mountWebDrawing } = await import(url); mountWebDrawing({ color: '#FF0000' }); } catch (error) { throw error; }
        },
        args: [`chrome-extension://${id}/drawing/webOverlay.js`],
      });
    } catch (error) { throw error; }
  }, id);
  const host = page.locator('#color-picker-drawing-overlay');
  await expect(host.locator('.drawing-toolbar')).toBeVisible();
  await host.locator('[data-setting="opacity"]').fill('50');
  await page.mouse.move(300, 400);
  await page.mouse.down();
  await page.mouse.move(500, 400);
  await page.mouse.up();
  const inspect = async (file, points) => {
    try {
      const png = await readFile(file);
      return await page.evaluate(async ({ source, points }) => {
        try {
          const image = new Image(); image.src = source; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          return { width: canvas.width, height: canvas.height, pixels: points.map(([x, y]) => { return [...context.getImageData(x, y, 1, 1).data]; }) };
        } catch (error) { throw error; }
      }, { source: `data:image/png;base64,${png.toString('base64')}`, points });
    } catch (error) { throw error; }
  };
  const download = page.waitForEvent('download');
  await host.locator('[data-action="export"]').click();
  await host.locator('[data-export-mode="web"]').click();
  const saved = await download;
  const result = await inspect(await saved.path(), [[400, 400], [640, 50], [30, 30]]);
  expect(result.width).toBe(1280);
  expect(result.height).toBe(800);
  expect(result.pixels[0][0]).toBeGreaterThanOrEqual(132);
  expect(result.pixels[0][0]).toBeLessThanOrEqual(134);
  expect(result.pixels[1]).toEqual([10, 20, 30, 255]);
  expect(result.pixels[2]).toEqual([10, 20, 30, 255]);
  await expect(host.locator('[data-action="export"]')).toBeEnabled();
  expect(await host.getAttribute('data-capturing')).toBeNull();

  await worker.evaluate(() => {
    globalThis.savedCapture = chrome.tabs.captureVisibleTab;
    chrome.tabs.captureVisibleTab = async () => { throw new Error('fixture denied'); };
  });
  await host.locator('[data-action="export"]').click();
  await host.locator('[data-export-mode="web"]').click();
  await expect(host.locator('.drawing-status')).toContainText('Could not capture this web view');
  await expect(host.locator('.drawing-toolbar')).toBeVisible();
  await expect(host.locator('[data-action="export"]')).toBeEnabled();
  expect(await host.getAttribute('data-capturing')).toBeNull();
  await worker.evaluate(() => { chrome.tabs.captureVisibleTab = globalThis.savedCapture; });

  await control.evaluate(() => { localStorage.setItem('screenTestMode', 'success'); });
  const helperPromise = context.waitForEvent('page');
  await host.locator('[data-action="export"]').click();
  await host.locator('[data-export-mode="screen"]').click();
  const helper = await helperPromise;
  const screenDownload = await helper.waitForEvent('download');
  const screenImage = await inspect(await screenDownload.path(), [[110, 85], [0, 0]]);
  expect(screenImage.width).toBe(320);
  expect(screenImage.height).toBe(180);
  const expectedScreenPixels = [[133, 10, 15, 255], [10, 20, 30, 255]];
  screenImage.pixels.forEach((pixel, index) => {
    pixel.forEach((channel, offset) => {
      // NOTE: Browser screen streams use video color conversion; allow rounding by two levels.
      expect(Math.abs(channel - expectedScreenPixels[index][offset])).toBeLessThanOrEqual(2);
    });
  });
  await expect(host.locator('[data-action="export"]')).toBeEnabled();
  expect(await host.getAttribute('data-screen-capturing')).toBeNull();

  await control.evaluate(() => { localStorage.setItem('screenTestMode', 'cancel'); });
  await host.locator('[data-action="export"]').click();
  await host.locator('[data-export-mode="screen"]').click();
  await expect(host.locator('[data-action="export"]')).toBeEnabled();
  expect(await host.getAttribute('data-screen-capturing')).toBeNull();
  expect(errors).toEqual([]);
  console.info('Capture browser passed: real isolated-world injection, real captureVisibleTab + single alpha composite, toolbar exclusion, mocked screen source save/cancel and UI recovery.');
} finally {
  await context?.close();
  if (server) { await new Promise((resolve) => { server.close(resolve); }); }
  await rm(temporary, { recursive: true, force: true });
}
