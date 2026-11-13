import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { createIcons } from './icons.mjs';
import { catalogs } from '../src/core/i18n.js';

const output = 'dist/extension';

try {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const directory of ['ui', 'core', 'locales', 'drawing']) {
    await cp(`src/${directory}`, `${output}/${directory}`, { recursive: true });
  }

  await cp('src/background.js', `${output}/background.js`);

  const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  manifest.version = version;
  await writeFile(`${output}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

  for (const [language, catalog] of Object.entries(catalogs)) {
    const directory = `${output}/_locales/${language.replace('-', '_')}`;
    await mkdir(directory, { recursive: true });
    const messages = {};

    for (const key of ['extensionName', 'extensionDescription']) {
      messages[key] = { message: catalog[key] };
    }

    await writeFile(`${directory}/messages.json`, `${JSON.stringify(messages, null, 2)}\n`);
  }

  await createIcons(`${output}/icons`);
  console.info(`Built Chrome MV3 extension: ${output}`);
} catch (error) {
  console.error('Could not build Color Picker:', error.message);
  process.exitCode = 1;
}
