'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
// Windows does not round-trip POSIX mode bits when creating ordinary files.
const snapshotHash = entries => digest(JSON.stringify(process.platform === 'win32'
  ? entries.map(({ mode: _mode, ...entry }) => entry) : entries));
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function inside(root, target) {
  const relative = path.relative(root, target);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function relativePath(input = '', allowRoot = false) {
  const value = String(input);
  if ((!value || value === '.') && allowRoot) return '';
  const parts = value.split('/');
  if (!value || value.length > 2000 || path.isAbsolute(value)
    || parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f<>"|?*]/u.test(part)
      || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part))) {
    fail('invalid_path', 'Use a relative path within the selected folder, with / separators.');
  }
  return parts.join('/');
}

// Data owned by Hikari must go through its domain services. Config/hidden paths
// can also contain credentials or policy, and are excluded from reads entirely.
// macOS metadata (.DS_Store, AppleDouble ._*) is exempt: it sits in almost every
// folder and would otherwise block every folder move and trash.
function checkPolicy(relative, write = false) {
  const parts = relative.toLowerCase().split('/');
  if (parts.some(part => (part.startsWith('.') && part !== '.ds_store' && !part.startsWith('._')) || part === 'config')
    || /(^|\/)(auth|credentials|tokens?)\.(json|toml)$/iu.test(relative)) {
    fail('protected_path', 'Private configuration is not available through workspace files.');
  }
  if (!write) return;
  if (!relative) fail('protected_path', 'The workspace root cannot be modified.');
  if (['papers', 'knowledgebase', 'protocol', 'samples', 'plates', 'gels', 'dashboard', 'workflow', 'dna', 'plugins', 'chat_log', 'skills'].includes(parts[0])
    || (parts[0] === 'project' && (parts.length <= 2 || ['notebook', 'dna'].includes(parts[2])))
    || /(^|\/)(memory\.md|agents\.md|hikari-data[^/]*|[^/]*\.(sqlite|sqlite3|db)(-(wal|shm))?)$/iu.test(relative)) {
    fail('managed_record', 'This path is managed by Hikari. Use its notebook, protocol, paper, sequence, or memory tools.');
  }
}

async function rootIdentity(root, privateDirectory) {
  if (!root) fail('no_workspace', 'Choose a storage folder in Hikari first.');
  const resolved = await fs.realpath(root);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory() || resolved === path.parse(resolved).root) fail('invalid_root', 'Choose a workspace folder.');
  const privateRoot = privateDirectory ? await fs.realpath(privateDirectory) : '';
  if (privateRoot && (inside(resolved, privateRoot) || inside(privateRoot, resolved))) {
    fail('protected_path', 'The workspace must be separate from Hikari application data.');
  }
  return { root: resolved, identity: digest(`${resolved}\0${stat.dev}\0${stat.ino}`) };
}

async function resolveTarget(root, input, { write = false, allowRoot = false, missing = false } = {}) {
  const relative = relativePath(input, allowRoot);
  checkPolicy(relative, write);
  let target = root;
  const parts = relative ? relative.split('/') : [];
  for (let index = 0; index < parts.length; index += 1) {
    target = path.join(target, parts[index]);
    let stat;
    try { stat = await fs.lstat(target); } catch (error) {
      if (error.code === 'ENOENT' && missing && index === parts.length - 1) return { target, relative, stat: null };
      throw error;
    }
    if (stat.isSymbolicLink()) fail('unsafe_link', 'Symbolic links and junctions are not supported by workspace files.');
    if (!inside(root, await fs.realpath(target))) fail('unsafe_link', 'The path leaves the workspace.');
    if (stat.isFile() && stat.nlink > 1) fail('unsafe_link', 'Files with multiple hard links are not supported.');
    if (!stat.isFile() && !stat.isDirectory()) fail('unsupported_file', 'Only ordinary files and folders are supported.');
    if (index < parts.length - 1 && !stat.isDirectory()) fail('invalid_path', 'A parent path is not a folder.');
  }
  return { target, relative, stat: await fs.lstat(target) };
}

async function readBytes(target) {
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > 1) fail('unsupported_file', 'Only ordinary files without hard links are supported.');
    if (stat.size > MAX_BYTES) fail('size_limit', 'This file exceeds the 8 MiB workspace file limit.');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length <= MAX_BYTES) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) fail('size_limit', 'This file exceeds the 8 MiB workspace file limit.');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

// Bounded snapshots serve both conflict detection and recovery. All descendants
// are validated, so moving a folder cannot move protected records or links.
async function snapshot(root, input, { write = false } = {}) {
  const first = await resolveTarget(root, input, { write, missing: true });
  if (!first.stat) return { exists: false, hash: 'absent', entries: [] };
  const entries = [];
  let totalBytes = 0;
  async function walk(relative, suffix) {
    if (entries.length >= MAX_ENTRIES) fail('size_limit', 'Folder operations are limited to 1,000 entries.');
    const entry = await resolveTarget(root, relative, { write });
    if (entry.stat.isDirectory()) {
      entries.push({ path: suffix, type: 'directory' });
      for (const name of (await fs.readdir(entry.target)).sort()) {
        await walk(`${relative}/${name}`, suffix ? `${suffix}/${name}` : name);
      }
    } else {
      const bytes = await readBytes(entry.target);
      totalBytes += bytes.length;
      if (totalBytes > MAX_BYTES) fail('size_limit', 'A recoverable change is limited to 8 MiB.');
      entries.push({ path: suffix, type: 'file', data: bytes.toString('base64'), mode: entry.stat.mode & 0o777 });
    }
  }
  await walk(first.relative, '');
  return { exists: true, hash: snapshotHash(entries), entries, bytes: totalBytes };
}

module.exports = { MAX_BYTES, MAX_ENTRIES, digest, snapshotHash, fail, inside, relativePath, checkPolicy, rootIdentity, resolveTarget, readBytes, snapshot };
