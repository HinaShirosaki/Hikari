#!/usr/bin/env node
// `npx @hinashirosaki/hikari` — builds the native Hikari installer on this machine.
// electron + electron-forge stay devDependencies so the packaged app doesn't
// bundle them; install them here, then run the same `dist` script as a dev checkout.
const { execSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
process.env.HIKARI_OUT_DIR ||= path.resolve('hikari-out');

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
// npm 12 refuses git dependencies by default; @electron/rebuild pulls
// @electron/node-gyp from GitHub. Install scripts are allowed via package.json
// "allowScripts". Older npm ignores the flag.
run('npm install --include=dev --no-audit --no-fund --allow-git=all');
run('npm run dist');

const output = process.platform === 'darwin'
  ? path.join(process.env.HIKARI_OUT_DIR, `Hikari-darwin-${process.arch}`, 'Hikari.app')
  : process.platform === 'win32'
    ? path.join(process.env.HIKARI_OUT_DIR, `Hikari-win32-${process.arch}`, 'HikariSetup.exe')
    : path.join(process.env.HIKARI_OUT_DIR, 'make');
console.log(`\nHikari: ${output}`);
