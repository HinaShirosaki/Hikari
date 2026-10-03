'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function replaceSelection(root, destination, platform = process.platform) {
  const current = path.join(root, 'current');
  const temporary = path.join(root, `.hikari-current-${randomUUID()}`);
  const backup = `${temporary}-old`;
  await fs.symlink(destination, temporary, platform === 'win32' ? 'junction' : 'dir');
  let moved = false;
  let replaced = false;
  try {
    // POSIX replaces a symlink atomically; Windows junctions need a backup.
    if (platform === 'win32') {
      try { await fs.rename(current, backup); moved = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await fs.rename(temporary, current);
    replaced = true;
  } catch (error) {
    if (moved) { await fs.rename(backup, current); moved = false; }
    throw error;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
    // Keep the backup recoverable if restoration itself fails.
    if (moved && replaced) await fs.rm(backup, { force: true }).catch(() => {});
  }
}

async function ensureLink(target, link, type) {
  const existing = await fs.lstat(link).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (!existing) return fs.symlink(target, link, type);
  if (!existing.isSymbolicLink() || path.resolve(path.dirname(link), await fs.readlink(link)) !== path.resolve(path.dirname(link), target)) {
    throw new Error(`Codex installation path is already occupied: ${link}`);
  }
}

async function prepareStandaloneLinks(root, destination, bin, platform) {
  if (platform === 'win32') {
    await fs.mkdir(path.dirname(bin), { recursive: true });
    await ensureLink(path.join(root, 'current', 'bin'), bin, 'junction');
  } else {
    await ensureLink('bin/codex', path.join(destination, 'codex'));
    await fs.mkdir(bin, { recursive: true });
    for (const name of ['codex', 'codex-code-mode-host']) {
      await ensureLink(path.join(root, 'current', 'bin', name), path.join(bin, name));
    }
  }
}

module.exports = { prepareStandaloneLinks, replaceSelection };
