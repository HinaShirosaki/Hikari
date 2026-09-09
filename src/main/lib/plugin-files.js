'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const MAX_BASE64_CHARS = 24_000_000;
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function statIfPresent(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Resolve the configured storage root, then reject links anywhere below it,
// including Plugins/, the plugin directory itself, and the final file. A
// lexical prefix check alone cannot confine filesystem operations.
async function resolvePluginFile(payload, createDirectories = false) {
  const storagePath = String(payload?.storagePath || '').trim();
  const pluginId = String(payload?.pluginId || '');
  const requested = String(payload?.path || '').trim();
  if (!storagePath || !path.isAbsolute(storagePath)) {
    throw new Error('An absolute storage folder is required.');
  }
  if (!PLUGIN_ID_PATTERN.test(pluginId) || pluginId.length > 80) {
    throw new Error('Invalid plugin id.');
  }
  const parts = requested.split('/').filter((part) => part && part !== '.');
  if (!parts.length || requested.startsWith('/') || /^[a-zA-Z]:/.test(requested)
    || requested.includes('\\') || requested.includes('\0') || parts.includes('..')) {
    throw new Error('Invalid plugin file path.');
  }
  let folder = await fs.realpath(storagePath);
  for (const part of ['Plugins', pluginId, ...parts.slice(0, -1)]) {
    folder = path.join(folder, part);
    let stat = await statIfPresent(folder);
    if (!stat && createDirectories) {
      try {
        await fs.mkdir(folder);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      stat = await fs.lstat(folder);
    }
    if (!stat) {
      throw new Error('Plugin file not found.');
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Plugin file directories must be real directories, not files or symbolic links.');
    }
  }
  const absolute = path.join(folder, parts.at(-1));
  const stat = await statIfPresent(absolute);
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
    throw new Error('Plugin files must be regular files, not symbolic links.');
  }
  return { absolute, folder, relative: parts.join('/') };
}

async function readPluginFile(payload) {
  const target = await resolvePluginFile(payload);
  // O_NOFOLLOW also closes the final-file check/open race on supported hosts.
  const handle = await fs.open(target.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Plugin files must be regular files.');
    return { path: target.relative, dataBase64: (await handle.readFile()).toString('base64') };
  } finally {
    await handle.close();
  }
}

async function writePluginFile(payload) {
  const encoded = String(payload?.dataBase64 || '');
  if (!encoded || encoded.length > MAX_BASE64_CHARS || encoded.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    || Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
    throw new Error('Plugin writes require canonical base64 within the file size limit.');
  }
  const target = await resolvePluginFile(payload, true);
  // ponytail: a crashed process leaves the temp file behind; sweep stale
  // .hikari-write-*.tmp on start if that ever shows up in a plugin folder.
  const temporary = path.join(target.folder, `.hikari-write-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, Buffer.from(encoded, 'base64'), { flag: 'wx', mode: 0o600 });
    // Re-validate for its throw: mkdir and the write above widened the window in
    // which a component of the path could have been replaced by a link.
    await resolvePluginFile(payload);
    // Replacing the directory entry cannot follow a final symlink or overwrite
    // the contents of a hard-linked neighbour. Failed writes retain the old file.
    await fs.rename(temporary, target.absolute);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
  return { path: target.relative };
}

module.exports = { readPluginFile, writePluginFile };
