'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { codexManagedRoot, codexStandaloneRoot, compareCodexVersions, readCodexManagedInstall } = require('./cli-managed');
const { readCodexVersion } = require('./cli-update-download');

// Only prune Hikari's private home, after a successful standalone update/check.
// Keep one older runnable release across both layouts, plus session selections
// whose immutable paths may still belong to an in-flight request.
async function pruneCodexCliReleases(env, options = {}) {
  if (!String(env.HIKARI_CODEX_HOME || '').trim()) return [];
  const platform = options.platform || process.platform;
  const paths = platform === 'win32' ? path.win32 : path;
  const fileSystem = options.fs || fs;
  const readVersion = options.readVersion || readCodexVersion;
  const installOptions = { platform, arch: options.arch || process.arch };
  const selected = readCodexManagedInstall(env, installOptions);
  if (selected?.method !== 'standalone') return [];
  const releaseDirectory = binary => paths.dirname(paths.dirname(binary));
  const selectedDirectory = await fileSystem.realpath(releaseDirectory(selected.binary));
  const protectedDirectories = new Set([selectedDirectory]);
  for (const binary of options.protectedBinaries || []) {
    const directory = await fileSystem.realpath(releaseDirectory(binary)).catch(() => '');
    if (directory) protectedDirectories.add(directory);
  }
  const releases = [];
  for (const root of [codexStandaloneRoot(env, { platform }), codexManagedRoot(env, { platform })]) {
    const directory = paths.join(root, 'releases');
    // Do not follow redirected package roots or release-directory symlinks.
    let owned = true;
    for (const candidate of [paths.dirname(root), root, directory]) {
      const stat = await fileSystem.lstat(candidate).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (!stat?.isDirectory() || stat.isSymbolicLink()) { owned = false; break; }
    }
    if (!owned) continue;
    for (const entry of await fileSystem.readdir(directory, { withFileTypes: true })) {
      const match = /^(\d+\.\d+\.\d+)-(.+)$/.exec(entry.name);
      if (!entry.isDirectory() || !match || match[2] !== selected.target) continue;
      const location = paths.join(directory, entry.name);
      const binary = paths.join(location, 'bin', platform === 'win32' ? 'codex.exe' : 'codex');
      const stat = await fileSystem.lstat(binary).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      releases.push({ location, binary, version: match[1], real: await fileSystem.realpath(location),
        runnable: stat?.isFile() && (platform === 'win32' || Boolean(stat.mode & 0o111)) });
    }
  }
  const rollbacks = releases.filter(release => release.runnable && compareCodexVersions(release.version, selected.version) < 0)
    .sort((a, b) => compareCodexVersions(b.version, a.version));
  for (const release of rollbacks) {
    if (await readVersion(release.binary, { env }).catch(() => '') === release.version) {
      protectedDirectories.add(release.real);
      break;
    }
  }
  const removed = [];
  for (const release of releases) {
    if (protectedDirectories.has(release.real) || compareCodexVersions(release.version, selected.version) > 0) continue;
    // An external selection change invalidates this cleanup pass.
    if (readCodexManagedInstall(env, installOptions)?.binary !== selected.binary) break;
    await fileSystem.rm(release.location, { recursive: true, force: true });
    removed.push(release.location);
  }
  return removed;
}

module.exports = { pruneCodexCliReleases };
