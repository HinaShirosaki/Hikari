'use strict';

const fs = require('fs/promises');
const path = require('path');
const { SQLJS_WASM_JS_PATH, loadSqlJs } = require('../lib/sqlite.js');
const { asArray } = require('../lib/normalize.js');


function sanitizeFolderName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  // Separators are already gone, but a name of nothing but dots survives them
  // and still walks: path.join(root, 'Project', '..') is the storage root, and
  // every caller here joins this onto a trusted base.
  if (!cleaned || /^\.+$/.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

function toPosixRelative(rootPath, targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join('/');
}

function cleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function cloneJson(value, fallback) {
  try {
    if (!value || typeof value !== 'object') {
      return fallback;
    }
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function ensureObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(String(text || ''));
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function parseJsonArray(text) {
  try {
    const parsed = JSON.parse(String(text || ''));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = parseJsonObject(raw);
    if (!parsed) {
      return {
        exists: true,
        ok: false,
        error: `Invalid JSON object in ${filePath}`
      };
    }
    return {
      exists: true,
      ok: true,
      data: parsed
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, ok: false, error: '' };
    }
    return {
      exists: true,
      ok: false,
      error: String(error?.message || error)
    };
  }
}

function normalizeFileTimestamp(stat) {
  const source = stat && typeof stat === 'object' ? stat : {};
  const time = source.mtime instanceof Date ? source.mtime : null;
  if (!time || !Number.isFinite(time.getTime())) {
    return '';
  }
  return time.toISOString();
}

function buildSearchText(parts) {
  return asArray(parts)
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

// Reads a folder record file ({ [key]: record }) along with its mtime, for
// keepLatestById. A file without a record id is skipped, with a warning if it
// could not be parsed.
async function readRecordFile(filePath, key, warnings) {
  const payload = await readJsonFile(filePath);
  const record = ensureObject(payload.ok ? payload.data?.[key] : null);
  if (!cleanText(record.id, 220)) {
    if (payload.exists && payload.error) {
      warnings.push(payload.error);
    }
    return null;
  }
  const { mtimeMs } = await fs.stat(filePath).catch(() => ({ mtimeMs: 0 }));
  return { record, mtimeMs };
}

// Two folders can hold the same record: a root saved by an older build, or a
// save that crashed between writing a renamed record's new folder and pruning
// the old one. The file the latest save wrote wins; merging in folder-name
// order would let a stale copy override the current one.
function keepLatestById(byId, found, value = found.record) {
  const id = cleanText(found.record.id, 220);
  const current = byId.get(id);
  if (!current || found.mtimeMs > current.mtimeMs) {
    byId.set(id, { mtimeMs: found.mtimeMs, value });
  }
}

module.exports = {
  SQLJS_WASM_JS_PATH,
  asArray,
  buildSearchText,
  cleanText,
  cloneJson,
  ensureObject,
  keepLatestById,
  loadSqlJs,
  normalizeFileTimestamp,
  parseJsonArray,
  parseJsonObject,
  readJsonFile,
  readRecordFile,
  sanitizeFolderName,
  toPosixRelative
};
