'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const MAX_BASE64_CHARS = 24_000_000;
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const figuraMigrations = new Map();

async function statIfPresent(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Keep the installed id (and its chat/settings identity) stable while using
// the product name for its on-disk data. Serialize the first rename so reads
// and writes cannot create a second, empty namespace during migration.
async function migrateFiguraFolder(pluginsFolder) {
  const pending = figuraMigrations.get(pluginsFolder);
  if (pending) return pending;
  const migration = (async () => {
    const target = path.join(pluginsFolder, 'Figura');
    if (await statIfPresent(target)) return;
    const legacy = path.join(pluginsFolder, 'scientific-illustration');
    const stat = await statIfPresent(legacy);
    if (!stat) return;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Plugin file directories must be real directories, not files or symbolic links.');
    }
    await fs.rename(legacy, target);
  })();
  figuraMigrations.set(pluginsFolder, migration);
  try { await migration; } finally { figuraMigrations.delete(pluginsFolder); }
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
  if (pluginId === 'figura') {
    throw new Error('The Figura storage folder belongs to the scientific-illustration plugin.');
  }
  const parts = requested.split('/').filter((part) => part && part !== '.');
  if (!parts.length || requested.startsWith('/') || /^[a-zA-Z]:/.test(requested)
    || requested.includes('\\') || requested.includes('\0') || parts.includes('..')) {
    throw new Error('Invalid plugin file path.');
  }
  let folder = await fs.realpath(storagePath);
  const pluginFolder = pluginId === 'scientific-illustration' ? 'Figura' : pluginId;
  const directories = ['Plugins', pluginFolder, ...parts.slice(0, -1)];
  for (const [index, part] of directories.entries()) {
    if (index === 1 && pluginId === 'scientific-illustration') await migrateFiguraFolder(folder);
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

// Explicit recovery for the bundled Gel library. Only inspect its own artifact
// folders; normal startup must not resurrect records the user removed.
async function discoverGelRecords({ storagePath } = {}) {
  let root;
  try { root = await resolvePluginFile({ storagePath, pluginId: 'gel', path: 'Gels/.recovery' }); }
  catch (error) {
    if (error.message === 'Plugin file not found.') return { records: [], warnings: [] };
    throw error;
  }
  const records = [], warnings = [];
  for (const entry of await fs.readdir(root.folder, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const folder = `Gels/${entry.name}`;
    try {
      const metadataPath = `${folder}/gel-record.json`;
      const result = await readPluginFile({ storagePath, pluginId: 'gel', path: metadataPath });
      const record = JSON.parse(Buffer.from(result.dataBase64, 'base64').toString('utf8'));
      if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || !record.id.trim()) {
        throw new Error('Invalid saved gel metadata.');
      }
      record.storageFolder = folder;
      record.recordJsonPath = record.recordJsonRelativePath = metadataPath;
      for (const [name, file] of [['sourceImage', 'source.png'], ['previewImage', 'preview.png'], ['analysisResult', 'analysis-result.json']]) {
        const relative = `${folder}/${file}`;
        const target = await resolvePluginFile({ storagePath, pluginId: 'gel', path: relative });
        if (await statIfPresent(target.absolute)) record[`${name}Path`] = record[`${name}RelativePath`] = relative;
      }
      records.push(record);
    } catch (error) { warnings.push(`${entry.name}: ${error.message}`); }
  }
  return { records, warnings };
}

module.exports = { readPluginFile, writePluginFile, discoverGelRecords };
