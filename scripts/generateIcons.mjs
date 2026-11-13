import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

let browser;

try {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage();
  const svg = await readFile('design/colorPicker.svg', 'utf8');
  await mkdir('src/icons', { recursive: true });

  for (const size of [16, 32, 48, 128, 512]) {
    const data = await page.evaluate(async ({ svg, size }) => {
      try {
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';

        // NOTE: Toolbar sizes need less padding to keep the pipette legible.
        if (size <= 48) {
          context.drawImage(image, 12, 12, 104, 104, 0, 0, size, size);
        } else {
          context.drawImage(image, 0, 0, size, size);
        }

        return canvas.toDataURL('image/png').split(',')[1];
      } catch (error) {
        throw new Error(`Could not render icon: ${error.message}`);
      }
    }, { svg, size });
    const destination = size === 512 ? 'design/icon-preview-512.png' : `src/icons/${size}.png`;
    await writeFile(destination, Buffer.from(data, 'base64'));
  }

  console.info('Generated Color Picker icons from design/colorPicker.svg');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
