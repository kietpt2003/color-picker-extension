import * as ResEdit from 'resedit';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const stage = path.resolve('dist/desktop-app');
const output = path.resolve('artifacts/desktop');
const electronVersion = '45.3.1';
const windowsHost = process.platform === 'win32';
const windowsOnly = process.argv.includes('--win-only') || (windowsHost && !process.argv.includes('--mac-only'));

function runPowerShell(script, values) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, ...values }, stdio: 'pipe',
  });
}

try {
  await rm(stage, { recursive: true, force: true });
  await cp('desktop', stage, { recursive: true });
  await mkdir(`${stage}/shared`, { recursive: true });

  for (const directory of ['drawing', 'core', 'locales']) {
    await cp(`src/${directory}`, `${stage}/shared/${directory}`, { recursive: true });
  }

  await cp('src/icons', `${stage}/icons`, { recursive: true });
  const { catalogs } = await import('../src/core/i18n.js');
  await writeFile(`${stage}/catalogs.json`, JSON.stringify(catalogs));
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const metadata = JSON.parse(await readFile(`${stage}/package.json`, 'utf8'));
  metadata.version = version;
  await writeFile(`${stage}/package.json`, JSON.stringify(metadata, null, 2));
  await mkdir(output, { recursive: true });

  const icnsChunks = [];
  for (const [kind, file] of [['icp4', 'src/icons/16.png'], ['icp5', 'src/icons/32.png'], ['ic07', 'src/icons/128.png'], ['ic09', 'design/icon-preview-512.png']]) {
    const png = await readFile(file);
    const header = Buffer.alloc(8);
    header.write(kind);
    header.writeUInt32BE(png.length + 8, 4);
    icnsChunks.push(header, png);
  }
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write('icns');
  icnsHeader.writeUInt32BE(8 + icnsChunks.reduce((sum, chunk) => { return sum + chunk.length; }, 0), 4);
  await writeFile(`${output}/app.icns`, Buffer.concat([icnsHeader, ...icnsChunks]));
  const png = await readFile('src/icons/128.png');
  const icoHeader = Buffer.alloc(22);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(1, 4);
  icoHeader[6] = 128;
  icoHeader[7] = 128;
  icoHeader.writeUInt16LE(1, 10);
  icoHeader.writeUInt16LE(32, 12);
  icoHeader.writeUInt32LE(png.length, 14);
  icoHeader.writeUInt32LE(22, 18);
  await writeFile(`${output}/app.ico`, Buffer.concat([icoHeader, png]));
  if (windowsHost && process.argv.includes('--mac-only')) {
    throw new Error('macOS packaging requires a macOS host (PlistBuddy and codesign). Use npm run desktop:package:win on Windows.');
  }
  const targets = windowsOnly ? [['win32', 'x64']] : process.argv.includes('--mac-only') ? [['darwin', process.arch]] : [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']];
  const artifacts = [];

  for (const [platform, arch] of targets) {
    console.info(`Packaging Color Picker Draw ${version} for ${platform}-${arch} (Electron ${electronVersion})`);
    const cache = path.join(os.tmpdir(), 'color-picker-electron-cache');
    const runtimeFilename = `electron-v${electronVersion}-${platform}-${arch}.zip`;
    const runtimeZip = path.join(cache, runtimeFilename);
    await mkdir(cache, { recursive: true });
    const checksumFile = path.join(cache, `SHASUMS256-${electronVersion}.txt`);
    let sums;

    try {
      sums = await readFile(checksumFile, 'utf8');
    } catch {
      const response = await fetch(`https://github.com/electron/electron/releases/download/v${electronVersion}/SHASUMS256.txt`);
      if (!response.ok) { throw new Error('Could not download Electron checksums'); }
      sums = await response.text();
      await writeFile(checksumFile, sums);
    }

    const expected = sums.split('\n').find((line) => { return line.trim().split(/\s+/).at(-1)?.replace(/^\*/, '') === runtimeFilename; })?.trim().split(/\s+/)[0];
    if (!expected) { throw new Error(`Missing official checksum for ${runtimeFilename}`); }
    let runtime;

    try {
      runtime = await readFile(runtimeZip);
    } catch {
      // NOTE: Reuse a checksum-verified cached release from earlier packaging when present.
      for (const entry of await readdir(cache, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          try { runtime = await readFile(path.join(cache, entry.name, runtimeFilename)); break; } catch { /* Cache miss. */ }
        }
      }
      if (!runtime) {
        const response = await fetch(`https://github.com/electron/electron/releases/download/v${electronVersion}/${runtimeFilename}`);
        if (!response.ok) { throw new Error(`Could not download ${runtimeFilename}`); }
        runtime = Buffer.from(await response.arrayBuffer());
      }
      await writeFile(runtimeZip, runtime);
    }

    if (createHash('sha256').update(runtime).digest('hex') !== expected) {
      throw new Error(`Electron runtime checksum mismatch: ${runtimeFilename}`);
    }
    runtime = null;
    const directory = `${output}/Color Picker Draw-${platform}-${arch}`;
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    if (windowsHost) {
      runPowerShell('$ErrorActionPreference = "Stop"; Expand-Archive -LiteralPath $env:DRAWING_ARCHIVE_INPUT -DestinationPath $env:DRAWING_ARCHIVE_OUTPUT', {
        DRAWING_ARCHIVE_INPUT: runtimeZip, DRAWING_ARCHIVE_OUTPUT: directory,
      });
    } else {
      execFileSync('unzip', ['-q', runtimeZip, '-d', directory]);
    }

    if (platform === 'darwin') {
      const appDirectory = `${directory}/Color Picker Draw.app`;
      await rename(`${directory}/Electron.app`, appDirectory);
      await rename(`${appDirectory}/Contents/MacOS/Electron`, `${appDirectory}/Contents/MacOS/ColorPickerDraw`);
      await cp(stage, `${appDirectory}/Contents/Resources/app`, { recursive: true });
      await cp(`${output}/app.icns`, `${appDirectory}/Contents/Resources/electron.icns`);
      const plist = `${appDirectory}/Contents/Info.plist`;
      const fields = { CFBundleExecutable: 'ColorPickerDraw', CFBundleIdentifier: 'com.colorpicker.draw', CFBundleName: 'Color Picker Draw', CFBundleDisplayName: 'Color Picker Draw', CFBundleShortVersionString: version, CFBundleVersion: version };
      for (const [key, value] of Object.entries(fields)) {
        try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], { stdio: 'ignore' }); }
        catch { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]); }
      }
      try { execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Delete :CFBundleURLTypes', plist], { stdio: 'ignore' }); } catch { /* No previous protocol. */ }
      for (const command of ['Add :CFBundleURLTypes array', 'Add :CFBundleURLTypes:0 dict', 'Add :CFBundleURLTypes:0:CFBundleURLName string Color Picker Draw', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string color-picker-draw']) {
        execFileSync('/usr/libexec/PlistBuddy', ['-c', command, plist]);
      }
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', appDirectory], { stdio: 'pipe' });
    } else {
      await rename(`${directory}/electron.exe`, `${directory}/ColorPickerDraw.exe`);
      await cp(stage, `${directory}/resources/app`, { recursive: true });
      const executablePath = `${directory}/ColorPickerDraw.exe`;
      const executable = ResEdit.NtExecutable.from(await readFile(executablePath));
      const resources = ResEdit.NtExecutableResource.from(executable);
      const group = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)[0];
      const icon = ResEdit.Data.IconFile.from(await readFile(`${output}/app.ico`));
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icon.icons.map((item) => { return item.data; }));
      const info = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)[0];
      const parts = version.split('.').map(Number);
      info.setFileVersion(...parts, 0);
      info.setProductVersion(...parts, 0);
      info.setStringValues(info.getAllLanguagesForStringValues()[0], { ProductName: 'Color Picker Draw', FileDescription: 'Color Picker Draw', OriginalFilename: 'ColorPickerDraw.exe', FileVersion: version, ProductVersion: version });
      info.outputToResourceEntries(resources.entries);
      resources.outputResource(executable);
      await writeFile(executablePath, Buffer.from(executable.generate()));
    }
    const filename = `color-picker-draw-${version}-${platform}-${arch}.zip`;
    const destination = `${output}/${filename}`;
    await rm(destination, { force: true });
    if (windowsHost) {
      runPowerShell('$ErrorActionPreference = "Stop"; Compress-Archive -LiteralPath $env:DRAWING_ARCHIVE_INPUT -DestinationPath $env:DRAWING_ARCHIVE_OUTPUT', {
        DRAWING_ARCHIVE_INPUT: directory, DRAWING_ARCHIVE_OUTPUT: destination,
      });
    } else {
      execFileSync('zip', ['-qry', destination, path.basename(directory)], { cwd: path.dirname(directory) });
    }
    artifacts.push({ filename, sha256: createHash('sha256').update(await readFile(destination)).digest('hex') });
  }

  await cp('docs/desktop-drawing.md', `${output}/README.md`);
  await writeFile(`${output}/SHA256SUMS`, artifacts.map((artifact) => { return `${artifact.sha256}  ${artifact.filename}`; }).join('\n') + '\n');
  console.info(`Desktop packages ready in ${output}`);
} catch (error) {
  console.error('Could not package desktop companion:', error.message);
  process.exitCode = 1;
}
