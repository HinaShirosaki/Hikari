'use strict';

const fs = require('node:fs');
const path = require('node:path');

function codexReleaseTarget(platform = process.platform, arch = process.arch) {
  const cpu = { arm64: 'aarch64', x64: 'x86_64' }[arch];
  const system = { darwin: 'apple-darwin', win32: 'pc-windows-msvc' }[platform];
  return cpu && system ? `${cpu}-${system}` : '';
}

function codexManagedRoot(env = process.env, options = {}) {
  const paths = options.platform === 'win32' ? path.win32 : path;
  const home = String(env.HIKARI_CODEX_HOME || '').trim();
  return home ? paths.join(home, 'packages', 'hikari-cli') : '';
}

function codexStandaloneRoot(env = process.env, options = {}) {
  const paths = options.platform === 'win32' ? path.win32 : path;
  const home = String(env.HIKARI_CODEX_HOME || env.CODEX_HOME || '').trim();
  return home ? paths.join(home, 'packages', 'standalone') : '';
}

function codexInstallDirectory(env = process.env, options = {}) {
  const paths = options.platform === 'win32' ? path.win32 : path;
  const home = String(env.HIKARI_CODEX_HOME || env.CODEX_HOME || '').trim();
  return home ? paths.join(home, 'bin') : '';
}

// Both the release channel and managed manifest accept stable x.y.z versions.
function compareCodexVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function readCodexManagedInstall(env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const paths = platform === 'win32' ? path.win32 : path;
  const fileSystem = options.fs || fs;
  const standalone = codexStandaloneRoot(env, options);
  if (standalone) {
    try {
      // Return the immutable release path, not the changing current junction.
      const releases = fileSystem.realpathSync(paths.join(standalone, 'releases'));
      const selected = fileSystem.realpathSync(paths.join(standalone, 'current'));
      const relative = paths.relative(releases, selected);
      const match = /^(\d+\.\d+\.\d+)-(.+)$/.exec(relative);
      if (match && match[2] === codexReleaseTarget(platform, options.arch || process.arch)) {
        const binary = paths.join(selected, 'bin', platform === 'win32' ? 'codex.exe' : 'codex');
        const stat = fileSystem.statSync(binary);
        if (stat.isFile() && (platform === 'win32' || (stat.mode & 0o111))) {
          return { version: match[1], target: match[2], binary, method: 'standalone' };
        }
      }
    } catch { /* A failed migration leaves the legacy selection available. */ }
  }
  const root = codexManagedRoot(env, { platform });
  if (!root) return null;
  try {
    const saved = JSON.parse(fileSystem.readFileSync(paths.join(root, 'current.json'), 'utf8'));
    if (!/^\d+\.\d+\.\d+$/.test(saved.version)
      || saved.target !== codexReleaseTarget(platform, options.arch || process.arch)) return null;
    const binary = paths.join(root, 'releases', `${saved.version}-${saved.target}`, 'bin',
      platform === 'win32' ? 'codex.exe' : 'codex');
    const stat = fileSystem.statSync(binary);
    if (!stat.isFile() || (platform !== 'win32' && !(stat.mode & 0o111))) return null;
    return { version: saved.version, target: saved.target, binary, method: 'legacy' };
  } catch { return null; }
}

module.exports = { codexManagedRoot, codexStandaloneRoot, codexInstallDirectory, codexReleaseTarget, compareCodexVersions, readCodexManagedInstall };
