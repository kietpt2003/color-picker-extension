import { cp, mkdir } from 'node:fs/promises';

export async function createIcons(directory) {
  try {
    await mkdir(directory, { recursive: true });

    for (const size of [16, 32, 48, 128]) {
      await cp(`src/icons/${size}.png`, `${directory}/${size}.png`);
    }
  } catch (error) {
    throw new Error(`Could not copy extension icons: ${error.message}`);
  }
}
