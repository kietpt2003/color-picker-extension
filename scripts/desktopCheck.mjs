import { _electron, expect } from '@playwright/test';
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
const exportFile = path.join(os.tmpdir(), `color-picker-desktop-export-${process.pid}.png`);

const executable = process.env.DRAWING_DESKTOP_EXECUTABLE || path.resolve(`artifacts/desktop/Color Picker Draw-darwin-${process.arch}/Color Picker Draw.app/Contents/MacOS/ColorPickerDraw`);
let application;
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

try {
  application = await _electron.launch({ executablePath: executable, args: ['--drawing-test'], env: environment, timeout: 30000 });
  await expect.poll(() => { return application.windows().length; }).toBeGreaterThanOrEqual(2);
  const toolbar = application.windows().find((page) => { return page.url().includes('role=toolbar'); });
  const overlay = application.windows().find((page) => { return page.url().includes('role=overlay'); });
  expect(toolbar).toBeTruthy();
  expect(overlay).toBeTruthy();
  const errors = [];
  toolbar.on('pageerror', (error) => { errors.push(error.message); });
  overlay.on('pageerror', (error) => { errors.push(error.message); });
  await expect(toolbar.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(overlay.locator('body')).toHaveAttribute('data-ready', 'true');
  const nativeState = await application.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows().map((window) => {
      const nativeSetIgnore = window.setIgnoreMouseEvents.bind(window);
      window.setIgnoreMouseEvents = (ignored, options) => {
        const result = nativeSetIgnore(ignored, options);
        window.__lastNativeIgnoreCall = ignored;
        return result;
      };
      return { top: window.isAlwaysOnTop(), url: window.webContents.getURL() };
    });
  });
  expect(nativeState.every((window) => { return window.top; })).toBe(true);
  const sample = async (x, y) => {
    try {
      return await overlay.locator('canvas').evaluate((canvas, point) => {
        const ratio = canvas.width / innerWidth;
        return [...canvas.getContext('2d').getImageData(point.x * ratio, point.y * ratio, 1, 1).data];
      }, { x, y });
    } catch (error) { throw error; }
  };
  await overlay.mouse.move(280, 280);
  await overlay.mouse.down();
  await overlay.mouse.move(450, 280, { steps: 10 });
  await overlay.mouse.up();
  expect((await sample(350, 280))[3]).toBe(255);
  await expect(toolbar.locator('[data-action="undo"]')).toBeEnabled();
  await toolbar.locator('[data-tool="eraser"]').click();
  await overlay.mouse.move(340, 280);
  await expect(overlay.locator('.drawing-eraser-cursor')).toBeVisible();
  expect((await overlay.locator('.drawing-eraser-cursor').boundingBox()).width).toBe(15);
  await overlay.mouse.down();
  await overlay.mouse.move(360, 280, { steps: 4 });
  await overlay.mouse.up();
  expect((await sample(350, 280))[3]).toBe(0);
  await toolbar.locator('[data-action="undo"]').click();
  await expect.poll(async () => { return (await sample(350, 280))[3]; }).toBe(255);
  await toolbar.locator('[data-tool="text"]').click();
  await overlay.mouse.click(350, 350);
  await overlay.locator('textarea').fill('Desktop annotation');
  await overlay.locator('textarea').press('ControlOrMeta+Enter');
  await expect(overlay.locator('textarea')).toHaveCount(0);
  await toolbar.locator('[data-tool="pointer"]').click();
  await expect(overlay.locator('.drawing-eraser-cursor')).toBeHidden();
  await expect.poll(() => {
    return application.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().filter((window) => { return window.webContents.getURL().includes('role=overlay'); }).every((window) => { return window.__lastNativeIgnoreCall === true; });
    });
  }).toBe(true);
  await toolbar.locator('[data-tool="pen"]').click();
  await expect.poll(() => {
    return application.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().filter((window) => { return window.webContents.getURL().includes('role=overlay'); }).every((window) => { return window.__lastNativeIgnoreCall === false; });
    });
  }).toBe(true);
  await toolbar.locator('[data-action="visibility"]').click();
  await expect(overlay.locator('canvas')).toBeHidden();
  await toolbar.locator('[data-action="visibility"]').click();
  await expect(overlay.locator('canvas')).toBeVisible();
  await toolbar.locator('[data-action="clear"]').click();
  await expect.poll(async () => { return (await sample(350, 280))[3]; }).toBe(0);
  await toolbar.locator('[data-action="undo"]').click();
  await expect.poll(async () => { return (await sample(350, 280))[3]; }).toBe(255);
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => { return { canceled: false, filePath }; };
  }, exportFile);
  await toolbar.locator('[data-action="export"]').click();
  await toolbar.locator('[data-export-mode="drawing"]').click();
  await expect.poll(async () => {
    try { return (await readFile(exportFile)).subarray(0, 8).toString('hex'); } catch { return ''; }
  }).toBe('89504e470d0a1a0a');
  const ownerHandle = await application.browserWindow(overlay);
  const ownerId = await ownerHandle.evaluate((window) => { return window.webContents.id; });
  const display = await application.evaluate(({ BrowserWindow, screen }, ownerId) => {
    const owner = BrowserWindow.getAllWindows().find((window) => { return window.webContents.id === ownerId; });
    const display = screen.getDisplayMatching(owner.getBounds());
    return { id: String(display.id), width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor), scale: display.scaleFactor };
  }, ownerId);
  const background = await overlay.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); context.fillStyle = 'rgb(10,20,30)'; context.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png');
  }, display);
  await application.evaluate(({ desktopCapturer, nativeImage, systemPreferences }, fixture) => {
    systemPreferences.getMediaAccessStatus = () => { return 'granted'; };
    desktopCapturer.getSources = async () => {
      return [{ display_id: fixture.id, thumbnail: nativeImage.createFromDataURL(fixture.background) }];
    };
  }, { ...display, background });
  await rm(exportFile, { force: true });
  await toolbar.locator('[data-action="export"]').click();
  await toolbar.locator('[data-export-mode="screen"]').click();
  await expect.poll(async () => { try { return (await readFile(exportFile)).length; } catch { return 0; } }).toBeGreaterThan(0);
  const captured = await readFile(exportFile);
  expect(captured.readUInt32BE(16)).toBe(display.width);
  expect(captured.readUInt32BE(20)).toBe(display.height);
  const inspect = async (buffer, points) => {
    try {
      return await overlay.evaluate(async ({ source, points }) => {
        try {
          const image = new Image(); image.src = source; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          return points.map(([x, y]) => { return [...context.getImageData(x, y, 1, 1).data]; });
        } catch (error) { throw error; }
      }, { source: `data:image/png;base64,${buffer.toString('base64')}`, points });
    } catch (error) { throw error; }
  };
  expect((await inspect(captured, [[0, 0]]))[0]).toEqual([10, 20, 30, 255]);
  const placement = await application.evaluate(({ BrowserWindow, screen }, ownerId) => {
    const owner = BrowserWindow.getAllWindows().find((window) => { return window.webContents.id === ownerId; });
    const bounds = owner.getBounds(); const display = screen.getDisplayMatching(bounds);
    return { x: bounds.x - display.bounds.x, y: bounds.y - display.bounds.y, scale: display.scaleFactor };
  }, ownerId);
  expect((await inspect(captured, [[Math.round((placement.x + 350) * placement.scale), Math.round((placement.y + 280) * placement.scale)]]))[0]).toEqual([124, 92, 252, 255]);
  await expect(toolbar.locator('[data-action="export"]')).toBeEnabled();

  await rm(exportFile, { force: true });
  await toolbar.locator('[data-action="export"]').click();
  await toolbar.locator('[data-export-mode="web"]').click();
  await expect(overlay.locator('.drawing-region-layer')).toBeVisible();
  await overlay.mouse.move(200, 200); await overlay.mouse.down();
  await overlay.mouse.move(500, 400, { steps: 5 }); await overlay.mouse.up();
  await expect.poll(async () => { try { return (await readFile(exportFile)).length; } catch { return 0; } }).toBeGreaterThan(0);
  const cropped = await readFile(exportFile);
  const ratio = display.scale;
  expect(cropped.readUInt32BE(16)).toBe(Math.round(300 * ratio));
  expect(cropped.readUInt32BE(20)).toBe(Math.round(200 * ratio));
  expect((await inspect(cropped, [[Math.round(150 * ratio), Math.round(80 * ratio)]]))[0]).toEqual([124, 92, 252, 255]);
  await expect(toolbar.locator('[data-action="export"]')).toBeEnabled();

  await toolbar.locator('[data-action="export"]').click();
  await toolbar.locator('[data-export-mode="web"]').click();
  await expect(overlay.locator('.drawing-region-layer')).toBeVisible();
  await overlay.keyboard.press('Escape');
  await expect(overlay.locator('.drawing-region-layer')).toHaveCount(0);
  await expect(toolbar.locator('[data-action="export"]')).toBeEnabled();

  await application.evaluate(({ desktopCapturer, nativeImage }, background) => {
    desktopCapturer.getSources = async () => { return [{ display_id: 'different-display', thumbnail: nativeImage.createFromDataURL(background) }]; };
  }, background);
  await toolbar.locator('[data-action="export"]').click();
  await toolbar.locator('[data-export-mode="screen"]').click();
  await expect(toolbar.locator('.drawing-status')).toContainText('Could not capture the screen');
  await expect(toolbar.locator('[data-action="export"]')).toBeEnabled();

  await application.evaluate(({ systemPreferences }) => { systemPreferences.getMediaAccessStatus = () => { return 'denied'; }; });
  await toolbar.locator('[data-action="export"]').click();
  await toolbar.locator('[data-export-mode="screen"]').click();
  await expect(toolbar.locator('.drawing-status')).toContainText('Screen Recording');
  await expect(toolbar.locator('[data-action="export"]')).toBeEnabled();

  for (const [language, label] of [['vi', 'Bút vẽ'], ['zh-CN', '画笔'], ['en', 'Pen']]) {
    await application.evaluate(({ app }, language) => {
      app.emit('open-url', { preventDefault: () => {} }, `color-picker-draw://open?language=${language}&color=%237C5CFC`);
    }, language);
    await expect(toolbar.locator('[data-tool="pen"]')).toHaveAttribute('aria-label', label);
    await expect(overlay.locator('html')).toHaveAttribute('lang', language);
  }
  await toolbar.screenshot({ path: 'artifacts/drawing-desktop-toolbar.png', omitBackground: true });
  await overlay.screenshot({ path: 'artifacts/drawing-desktop-layer.png', omitBackground: true });
  expect(errors).toEqual([]);
  console.info('macOS desktop passed: packaged app, transparent always-on-top windows, pen/text/eraser, undo/clear, native mouse passthrough and hide/show.');
} finally {
  await application?.close();
  await rm(exportFile, { force: true });
}
