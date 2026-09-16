#!/usr/bin/env node
// `npx @hinashirosaki/hikari` — builds the native Hikari installer on this machine.
// electron + electron-forge stay devDependencies so the packaged app doesn't
// bundle them; install them here, then run the same `dist` script as a dev checkout.
const { execSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
process.env.HIKARI_OUT_DIR ||= path.resolve('hikari-out');

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
run('npm install --include=dev --no-audit --no-fund');
run('npm run dist');

console.log(`\nHikari installer(s): ${path.join(process.env.HIKARI_OUT_DIR, 'make')}`);
