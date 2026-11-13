import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

try {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const output = path.resolve(`artifacts/chrome-submission-${version}`);
  const extensionName = `color-picker-extension-${version}.zip`;
  const manifest = JSON.parse(execFileSync('unzip', ['-p', `artifacts/${extensionName}`, 'manifest.json'], { encoding: 'utf8' }));
  const imageManifest = JSON.parse(await readFile('artifacts/webstore-images/ASSET-MANIFEST.json', 'utf8'));

  if (manifest.version !== version || imageManifest.version !== version || imageManifest.assets.length !== 19) {
    throw new Error('Rebuild the extension and artwork for the current version before packaging the submission.');
  }

  for (const asset of imageManifest.assets) {
    const bytes = await readFile(`artifacts/webstore-images/${asset.filename}`);

    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error(`Artwork checksum mismatch: ${asset.filename}`);
    }
  }

  await rm(output, { recursive: true, force: true });
  await mkdir(`${output}/extension`, { recursive: true });
  await mkdir(`${output}/instructions`, { recursive: true });
  await cp(`artifacts/${extensionName}`, `${output}/extension/${extensionName}`);
  await cp('artifacts/webstore-images', `${output}/images`, { recursive: true });
  await cp('docs/webstore', `${output}/instructions/webstore`, { recursive: true });

  for (const filename of ['webstore-submission.md', 'privacy-policy.md', 'desktop-drawing.md']) {
    await cp(`docs/${filename}`, `${output}/instructions/${filename}`);
  }

  await cp('VALIDATION.md', `${output}/instructions/VALIDATION.md`);
  await cp('artifacts/reviewer-sample.png', `${output}/reviewer-sample.png`);
  await writeFile(`${output}/README.md`, `# Color Picker ${version} — Chrome submission materials\n\nUpload only extension/${extensionName} as the Chrome package. This outer archive is a handoff bundle, not an extension package.\n\nSee instructions/webstore-submission.md for the complete Vietnamese guide; paths starting docs/ or artifacts/ there refer to the source repository. Copy-ready descriptions, permission answers and reviewer notes are in instructions/webstore/. Artwork is in images/.\n\nBefore submission, replace publisher/contact placeholders in privacy.html, host the policy publicly, and replace DESKTOP_DOWNLOAD_URL in the reviewer instructions with a real public companion download page. No submission or publication has been performed.\n\nThe separate desktop binaries are not included. Use artifacts/desktop/ in the source workspace. Their signing and platform verification limits are documented in the guide.\n`);

  const checksums = [];

  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await collect(filename, relative);
      } else {
        const hash = createHash('sha256').update(await readFile(filename)).digest('hex');
        checksums.push(`${hash}  ${relative}`);
      }
    }
  }

  await collect(output);
  await writeFile(`${output}/SHA256SUMS`, `${checksums.sort().join('\n')}\n`);
  const archive = `${output}.zip`;
  await rm(archive, { force: true });
  execFileSync('zip', ['-qr', archive, '.'], { cwd: output });
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${output}-SHA256SUMS`, `${digest}  ${path.basename(archive)}\n`);
  console.info(`Packaged ${path.relative(process.cwd(), archive)} with ${checksums.length} verified files.`);
} catch (error) {
  console.error(`Could not package submission materials: ${error.message}`);
  process.exitCode = 1;
}
