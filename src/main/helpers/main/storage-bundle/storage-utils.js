'use strict';

const fs = require('fs/promises');
const path = require('path');
const { resolveSqlJsWasmJsPath } = require('../sqljs-path.js');

const SQLJS_WASM_JS_PATH = resolveSqlJsWasmJsPath(__dirname);

let sqlJsInitPromise = null;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, _maxLength = 2000) {
  const text = String(value || '').trim();
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
    .map((value) => cleanText(value, 400))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

async function loadSqlJs() {
  if (!sqlJsInitPromise) {
    sqlJsInitPromise = (async () => {
      const initSqlJs = require(SQLJS_WASM_JS_PATH);
      return initSqlJs({
        locateFile: (fileName) => path.join(path.dirname(SQLJS_WASM_JS_PATH), fileName)
      });
    })();
  }
  return sqlJsInitPromise;
}

module.exports = {
  SQLJS_WASM_JS_PATH,
  asArray,
  buildSearchText,
  cleanText,
  cloneJson,
  ensureObject,
  loadSqlJs,
  normalizeFileTimestamp,
  parseJsonArray,
  parseJsonObject,
  readJsonFile
};
