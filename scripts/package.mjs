import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

await mkdir('artifacts', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const filename = `color-picker-extension-${version}.zip`;
await rm(path.resolve('artifacts', filename), { force: true });
execFileSync('zip', ['-qr', path.resolve('artifacts', filename), '.'], { cwd: 'dist/extension' });
const digest = createHash('sha256')
  .update(await readFile(`artifacts/${filename}`))
  .digest('hex');
await writeFile('artifacts/SHA256SUMS', `${digest}  ${filename}\n`);
console.log(`Packaged artifacts/${filename}`);
