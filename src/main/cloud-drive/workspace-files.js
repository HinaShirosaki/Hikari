'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { writeFileAtomic } = require('../lib/shared-json-file');

const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 20000;
const EXCLUDED_FOLDERS = new Set(['.git', '.codex', '.aws', 'node_modules', '.hikari-cloud-recovery', 'Logs', 'Tmp']);
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => /^[a-f0-9]{64}$/.test(String(value));
const TIMESTAMP_SCHEMAS = new Set(['hikari_sample_container', 'hikari_sample_folders', 'hikari_unplaced_samples',
  'hikari_experiment_log', 'hikari_assay', 'hikari_gel', 'hikari_paper', 'hikari_protocols', 'hikari_notebook_pages']);
const fileIdentity = file => file?.contentHash || file?.hash || '';

function contentHash(relativePath, bytes) {
  if (!relativePath.endsWith('.json')) return hashBytes(bytes);
  try {
    const data = JSON.parse(bytes.toString('utf8'));
    if (!TIMESTAMP_SCHEMAS.has(data?.schema_name) || typeof data.updated_at !== 'string') return hashBytes(bytes);
    const { updated_at: _saveTimestamp, ...content } = data;
    // Only the storage wrapper's clock is ignored. Record timestamps, typed
    // scientific values, and every other property remain part of the identity.
    return hashBytes(Buffer.from(JSON.stringify(content)));
  } catch { return hashBytes(bytes); }
}

function excluded(relativePath) {
  const parts = relativePath.split('/');
  return parts.some(part => EXCLUDED_FOLDERS.has(part))
    || parts.some(part => part === '.DS_Store' || /^\.env(?:\.|$)/.test(part))
    || /(?:\.tmp|\.pending|\.lock|\.sqlite-(?:wal|shm|journal))$/i.test(relativePath);
}

function validateRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 2000 || excluded(value)) throw new Error('Invalid cloud workspace file path.');
  const parts = value.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || /[<>:"\\|?*\x00-\x1f]/.test(part)
      || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
      throw new Error(`Workspace path cannot sync across devices: ${value}`);
    }
  }
  return value;
}

function validateFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > MAX_FILES) throw new Error('Invalid cloud workspace manifest.');
  const folded = new Set();
  for (const [relativePath, file] of Object.entries(files)) {
    validateRelativePath(relativePath);
    const key = relativePath.normalize('NFC').toLowerCase();
    if (folded.has(key) || !validHash(file?.hash) || (file.contentHash && !validHash(file.contentHash))
      || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) {
      throw new Error('Cloud workspace contains invalid or colliding files.');
    }
    folded.add(key);
  }
  for (const key of folded) {
    const parts = key.split('/');
    for (let count = 1; count < parts.length; count++) {
      if (folded.has(parts.slice(0, count).join('/'))) throw new Error('Cloud workspace contains a file/folder collision.');
    }
  }
  return files;
}

async function safePath(root, relativePath, createParents = false) {
  validateRelativePath(relativePath);
  const parts = relativePath.split('/');
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (createParents) await fs.mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT' && !createParents) return null; throw error; });
    if (!stat) return path.join(root, ...parts);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Cloud sync cannot follow symlinks or replace folders.');
  }
  const target = path.join(root, ...parts);
  const stat = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Cloud sync cannot follow symlinks or replace folders.');
  return target;
}

async function readWorkspaceFile(root, relativePath) {
  const target = await safePath(root, relativePath);
  let handle;
  try {
    handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error(`Cloud sync supports files up to 256 MiB: ${relativePath}`);
    const bytes = await handle.readFile();
    if (bytes.length > MAX_FILE_BYTES) throw new Error('A workspace file grew while syncing. Please retry.');
    return bytes;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}

async function scanWorkspace(root) {
  const files = Object.create(null);
  let fileCount = 0;
  async function walk(folder, prefix = '') {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      // External tools can keep WAL databases here. Omitting a live journal
      // would lose committed data, so refuse the snapshot instead.
      if (/\.sqlite-(?:wal|journal)$/i.test(relativePath) && (await fs.stat(path.join(folder, entry.name))).size > 0) {
        throw new Error('Close the application writing the workspace SQLite journal before syncing.');
      }
      if (excluded(relativePath)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Cloud sync cannot include symbolic links: ${relativePath}`);
      validateRelativePath(relativePath);
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), relativePath);
      else if (entry.isFile()) {
        if (++fileCount > MAX_FILES) throw new Error('Cloud sync supports up to 20,000 files per workspace.');
        const bytes = await readWorkspaceFile(root, relativePath);
        if (!bytes) throw new Error('Workspace changed while syncing. Please retry.');
        files[relativePath] = { hash: hashBytes(bytes), size: bytes.length };
        const identity = contentHash(relativePath, bytes);
        if (identity !== files[relativePath].hash) files[relativePath].contentHash = identity;
      } else throw new Error(`Unsupported workspace file: ${relativePath}`);
    }
  }
  await walk(root);
  return validateFiles(files);
}

function sameFiles(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key]?.hash === right[key]?.hash);
}

function sameContentFiles(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => fileIdentity(left[key]) === fileIdentity(right[key]));
}

function mergeFiles(base, local, remotes, resolution = '') {
  const paths = new Set([...Object.keys(base), ...Object.keys(local), ...remotes.flatMap(files => Object.keys(files))]);
  const merged = Object.create(null);
  const conflicts = [];
  for (const relativePath of [...paths].sort()) {
    const baseline = fileIdentity(base[relativePath]);
    const localValue = local[relativePath] || null;
    const remoteValues = remotes.map(files => files[relativePath] || null);
    const changed = [localValue, ...remoteValues].filter(value => fileIdentity(value) !== baseline);
    const distinct = new Map(changed.map(value => [fileIdentity(value), value]));
    let value = distinct.size ? distinct.values().next().value : localValue;
    if (distinct.size > 1) {
      conflicts.push(relativePath);
      value = resolution === 'cloud' ? remoteValues.at(-1) : localValue;
    }
    if (value) merged[relativePath] = value;
  }
  validateFiles(merged);
  const reviewedFiles = conflicts.map(relativePath => ({ path: relativePath,
    base: fileIdentity(base[relativePath]), local: fileIdentity(local[relativePath]),
    cloud: remotes.map(files => fileIdentity(files[relativePath])) }));
  return { files: merged, conflicts, conflictId: hashBytes(Buffer.from(JSON.stringify(reviewedFiles))) };
}

// Every old local file is retained under a recovery folder before replacement.
// A partial filesystem failure is reported and can be retried without advancing
// the synchronization baseline. Recovery files never enter bundle discovery.
async function applyFiles({ root, before, after, getObject, assertCurrent, beforeApply = async () => {} }) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => before[key]?.hash !== after[key]?.hash);
  if (!changed.length) return { changed: 0, recoveryPath: '' };
  const transaction = path.join(root, '.hikari-cloud-recovery', randomUUID());
  const recoveryParent = path.dirname(transaction);
  await fs.mkdir(recoveryParent, { recursive: true });
  if ((await fs.lstat(recoveryParent)).isSymbolicLink()) throw new Error('Invalid cloud recovery directory.');
  await fs.mkdir(transaction);
  const journal = [];
  let installed = 0;
  try {
    for (const relativePath of changed) {
      await safePath(root, relativePath);
      const bytes = await readWorkspaceFile(root, relativePath);
      if ((bytes ? hashBytes(bytes) : '') !== (before[relativePath]?.hash || '')) throw new Error('Workspace changed while syncing. Please retry.');
      const index = journal.length;
      if (bytes) await fs.writeFile(path.join(transaction, `${index}.before`), bytes);
      if (after[relativePath]) {
        const incoming = await getObject(after[relativePath].hash);
        if (incoming.length !== after[relativePath].size || hashBytes(incoming) !== after[relativePath].hash) throw new Error('Cloud file verification failed. No unverified content was installed.');
        await fs.writeFile(path.join(transaction, `${index}.after`), incoming);
      }
      journal.push({ path: relativePath, before: before[relativePath] || null, after: after[relativePath] || null });
    }
    await writeFileAtomic(fs, path.join(transaction, 'journal.json'), JSON.stringify(journal, null, 2));
    await assertCurrent();
    if (!sameFiles(before, await scanWorkspace(root))) throw new Error('Workspace changed while syncing. Please retry.');
    await beforeApply();
    for (let index = 0; index < journal.length; index++) {
      await assertCurrent();
      await beforeApply();
      const entry = journal[index];
      const target = await safePath(root, entry.path, Boolean(entry.after));
      const current = await readWorkspaceFile(root, entry.path);
      if ((current ? hashBytes(current) : '') !== (entry.before?.hash || '')) throw new Error('Workspace changed while installing cloud changes. Recovery copies have been retained.');
      if (entry.after) {
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await fs.copyFile(path.join(transaction, `${index}.after`), temporary, constants.COPYFILE_EXCL);
          await fs.rename(temporary, target);
        } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
      } else await fs.rm(target);
      installed++;
    }
    return { changed: changed.length, recoveryPath: transaction };
  } catch (error) {
    error.localFilesChanged = installed > 0;
    error.message = `${error.message} Recovery copies: ${transaction}`;
    throw error;
  }
}

module.exports = { hashBytes, contentHash, validHash, validateFiles, validateRelativePath, scanWorkspace, readWorkspaceFile, sameFiles, sameContentFiles, mergeFiles, applyFiles };
