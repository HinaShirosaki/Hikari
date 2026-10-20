'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readBuildLock } = require('./prepare-package');

function buildFromSource({ root, env = process.env, run = execSync, tempRoot = os.tmpdir() }) {
  const lock = readBuildLock(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const output = path.resolve(env.HIKARI_OUT_DIR || 'hikari-out');
  const workspace = fs.mkdtempSync(path.join(tempRoot, 'hikari-build-'));
  try {
    // Copy only published source paths. Never copy node_modules, user data, or
    // outputs from a developer checkout, and never mutate npx's shared cache.
    for (const entry of ['package.json', ...manifest.files.filter((file) => !file.startsWith('!'))]) {
      if (path.isAbsolute(entry) || entry.split(/[\\/]/).includes('..') || /[*?{}]/.test(entry)) {
        throw new Error(`Unsupported package source path: ${entry}`);
      }
      const source = path.join(root, entry);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(workspace, entry), { recursive: true });
    }
    fs.writeFileSync(path.join(workspace, 'package-lock.json'), lock);
    const options = { cwd: workspace, env: { ...env, HIKARI_OUT_DIR: output }, stdio: 'inherit' };
    console.log('Installing locked Hikari build dependencies…');
    // Older npm ignores allow-git; npm 12 needs it for Electron's node-gyp.
    run('npm ci --include=dev --no-audit --no-fund --allow-git=all', options);
    run('npm run dist', options);
    return output;
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

module.exports = { buildFromSource };
