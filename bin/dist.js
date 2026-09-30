#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A macOS app is already a self-contained distribution bundle.
const command = process.platform === 'darwin' ? 'package' : 'make';
const cli = require.resolve('@electron-forge/cli/dist/electron-forge.js');
const outputRoot = path.resolve(process.env.HIKARI_OUT_DIR || 'out');
// Squirrel needs RELEASES and .nupkg while making its self-contained setup EXE.
// Build those in a private staging directory; deliver the installer plus the
// packaged app as a portable folder (Hikari\\Hikari.exe) that runs from anywhere.
const staging = process.platform === 'win32'
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-dist-')) : null;
try {
  const result = spawnSync(process.execPath, [cli, command, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: staging ? { ...process.env, HIKARI_OUT_DIR: staging } : process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else if (staging) {
    const squirrel = path.join(staging, 'make', 'squirrel.windows');
    const architectures = fs.readdirSync(squirrel);
    if (!architectures.length) throw new Error('Windows build produced no installer');
    for (const arch of architectures) {
      const installer = path.join(squirrel, arch, 'HikariSetup.exe');
      if (!fs.statSync(installer).size) throw new Error(`Empty installer: ${installer}`);
      const destination = path.join(outputRoot, `Hikari-win32-${arch}`);
      fs.mkdirSync(destination, { recursive: true });
      fs.copyFileSync(installer, path.join(destination, 'HikariSetup.exe'));
      console.log(`Hikari installer: ${path.join(destination, 'HikariSetup.exe')}`);
      // forge make packages the app to <staging>/Hikari-win32-<arch> before making the installer.
      fs.cpSync(path.join(staging, `Hikari-win32-${arch}`), path.join(destination, 'Hikari'), { recursive: true });
      console.log(`Hikari portable: ${path.join(destination, 'Hikari', 'Hikari.exe')}`);
    }
  }
} finally {
  if (staging) fs.rmSync(staging, { recursive: true, force: true });
}
