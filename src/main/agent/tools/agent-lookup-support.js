'use strict';

const fs = require('fs/promises');
const path = require('path');
const { resolveSqlJsWasmJsPath } = require('../../lib/sqljs-path.js');

let sqlJsInitPromise = null;

async function loadSqlJs() {
  if (!sqlJsInitPromise) {
    sqlJsInitPromise = (async () => {
      // Resolve lazily: keep requiring this module cheap and non-throwing even when
      // sqljs can't be located (depth-independent walk-up, survives directory moves).
      const wasmJsPath = resolveSqlJsWasmJsPath(__dirname);
      const initSqlJs = require(wasmJsPath);
      return initSqlJs({
        locateFile: (fileName) => path.join(path.dirname(wasmJsPath), fileName)
      });
    })();
  }
  return sqlJsInitPromise;
}

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value) {
  return String(value || '');
}

function defaultEnsureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeParseJson(value, fallback = null) {
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function createAgentLookupSupport(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const ensureObject = typeof deps.ensureObject === 'function' ? deps.ensureObject : defaultEnsureObject;
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 20) => {
      const seen = new Set();
      const output = [];
      asArray(values).forEach((value) => {
        const normalized = cleanText(value, 220);
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key) || output.length >= max) {
          return;
        }
        seen.add(key);
        output.push(normalized);
      });
      return output;
    });
  const getBundlePaths = typeof deps.getBundlePaths === 'function'
    ? deps.getBundlePaths
    : (() => ({ sqlitePath: '' }));
  const hydrateSnapshotFromBundle = typeof deps.hydrateSnapshotFromBundle === 'function'
    ? deps.hydrateSnapshotFromBundle
    : (async ({ snapshot = {} } = {}) => ({ snapshot: ensureObject(snapshot), bundlePaths: {}, migration: null }));
  const syncBundleFromSnapshot = typeof deps.syncBundleFromSnapshot === 'function'
    ? deps.syncBundleFromSnapshot
    : (async () => ({ bundlePaths: {}, sidecarPaths: {} }));

  function buildSearchText(values) {
    return asArray(values)
      .map((value) => cleanText(value, 600))
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function normalizeQuery(value) {
    const query = cleanText(value, 300).toLowerCase();
    return {
      query,
      tokens: query
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 12)
    };
  }

  function buildTerms({ query = '', terms = [], maxTerms = 10 }) {
    return uniqueStrings([...asArray(terms), cleanText(query, 220)], maxTerms);
  }

  function rankRows(rows, {
    terms = [],
    query = '',
    limit = 6,
    getSearchText = (row) => row?.search_text || '',
    getPrimaryText = (row) => row?.name || row?.title || ''
  } = {}) {
    const { query: normalizedQuery } = normalizeQuery(query);
    const normalizedTerms = asArray(terms).map((term) => cleanText(term, 220).toLowerCase()).filter(Boolean);
    return asArray(rows)
      .map((row) => {
        const searchText = String(getSearchText(row) || '').toLowerCase();
        const primaryText = String(getPrimaryText(row) || '').toLowerCase();
        let score = normalizedTerms.reduce((total, term) => (searchText.includes(term) ? total + 10 : total), 0);
        if (normalizedQuery && primaryText === normalizedQuery) {
          score += 40;
        } else if (normalizedQuery && primaryText.includes(normalizedQuery)) {
          score += 15;
        }
        if (normalizedQuery && searchText.includes(normalizedQuery)) {
          score += 8;
        }
        return { ...row, _score: score };
      })
      .filter((row) => row._score > 0)
      .sort((left, right) => right._score - left._score)
      .slice(0, Math.max(1, Number(limit) || 6));
  }

  function mergeRowsByKey(primaryRows, secondaryRows, toKey) {
    const merged = [];
    const seen = new Set();
    [...asArray(primaryRows), ...asArray(secondaryRows)].forEach((row) => {
      const key = toKey(row);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(row);
    });
    return merged;
  }

  async function loadSnapshotFromDataFile(dataFilePath) {
    const resolvedPath = cleanText(dataFilePath, 2000);
    if (!resolvedPath) {
      return { snapshot: {}, warnings: [] };
    }
    try {
      const raw = await fs.readFile(resolvedPath, 'utf8');
      return { snapshot: ensureObject(safeParseJson(raw, {})), warnings: [] };
    } catch (error) {
      return {
        snapshot: {},
        warnings: error?.code === 'EPERM' || error?.code === 'EACCES'
          ? [`Permission denied reading the Hikari data file: ${String(error?.message || error)}`]
          : []
      };
    }
  }

  async function buildLookupContext({ dataFilePath = '', fallbackDataFilePath = '', snapshot = {} } = {}) {
    const resolvedDataFilePath = cleanText(dataFilePath || fallbackDataFilePath, 2000);
    const fallbackPath = cleanText(fallbackDataFilePath || dataFilePath, 2000);
    const baseSnapshot = ensureObject(snapshot);
    const liveNotebookBridge = ensureObject(baseSnapshot.notebook_lookup_bridge || baseSnapshot.notebookLookupBridge);
    const liveNotebookEntries = asArray(liveNotebookBridge.entries);
    const warnings = [];
    let sourceSnapshot = baseSnapshot;
    let loadedDataFile = false;

    if (resolvedDataFilePath) {
      const loaded = await loadSnapshotFromDataFile(resolvedDataFilePath);
      warnings.push(...asArray(loaded.warnings));
      if (Object.keys(loaded.snapshot).length) {
        sourceSnapshot = loaded.snapshot;
        loadedDataFile = true;
      }
    }

    const hydrated = await hydrateSnapshotFromBundle({
      dataFilePath: resolvedDataFilePath,
      fallbackDataFilePath: fallbackPath,
      snapshot: sourceSnapshot
    });
    const rawHydratedSnapshot = ensureObject(hydrated?.snapshot || sourceSnapshot);
    const hydratedSnapshot = liveNotebookEntries.length
      ? {
        ...rawHydratedSnapshot,
        notebookEntries: mergeRowsByKey(
          liveNotebookEntries,
          rawHydratedSnapshot.notebookEntries,
          (entry) => cleanText(entry?.id, 220)
        )
      }
      : rawHydratedSnapshot;
    const bundlePaths = hydrated?.bundlePaths && typeof hydrated.bundlePaths === 'object'
      ? hydrated.bundlePaths
      : getBundlePaths({
        dataFilePath: resolvedDataFilePath,
        fallbackDataFilePath: fallbackPath,
        storagePath: cleanText(hydratedSnapshot?.settings?.storagePath, 2000)
      });
    const migration = ensureObject(hydrated?.migration);
    warnings.push(...asArray(migration.warnings).map((warning) => String(warning || '')).filter(Boolean));

    return {
      dataFilePath: resolvedDataFilePath,
      fallbackDataFilePath: fallbackPath,
      sqlitePath: cleanText(bundlePaths?.sqlitePath, 2200),
      hydratedSnapshot,
      bundlePaths,
      migration,
      loadedDataFile,
      liveNotebookBridge: {
        entryCount: liveNotebookEntries.length,
        complete: liveNotebookBridge.complete === true
      },
      warnings: uniqueStrings(warnings, 20)
    };
  }

  async function withSqliteDatabase(sqlitePath, callback) {
    const targetPath = cleanText(sqlitePath, 2200);
    if (!targetPath) {
      return { ok: false, reason: 'missing_sqlite_path', result: null };
    }
    let bytes;
    try {
      bytes = await fs.readFile(targetPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { ok: false, reason: 'sqlite_missing', result: null };
      }
      throw error;
    }
    if (!bytes.length) {
      return { ok: false, reason: 'sqlite_empty', result: null };
    }
    const SQL = await loadSqlJs();
    let db;
    try {
      db = new SQL.Database(new Uint8Array(bytes));
      // sql.js parses lazily, so the constructor accepts a corrupt image and the
      // failure only surfaces on the first query. Force that here: a corrupt
      // index should read like a missing one and fall back to the snapshot
      // search, while real errors from the callback still propagate.
      db.exec('SELECT name FROM sqlite_master LIMIT 1');
    } catch {
      try { db?.close(); } catch { /* already unusable */ }
      return { ok: false, reason: 'sqlite_unreadable', result: null };
    }
    try {
      return { ok: true, reason: '', result: await callback(db) };
    } finally {
      db.close();
    }
  }

  function querySqlRows(db, sql, values = []) {
    const statement = db.prepare(sql);
    const rows = [];
    try {
      statement.bind(values);
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
    } finally {
      statement.free();
    }
    return rows;
  }

  function readSqliteTables(db) {
    return new Set(
      querySqlRows(db, "SELECT name FROM sqlite_master WHERE type='table'", [])
        .map((row) => cleanText(row?.name, 200).toLowerCase())
        .filter(Boolean)
    );
  }

  function collectLikeMatches(db, {
    tableName,
    selectColumns,
    terms = [],
    rowLimit = 40,
    tableAvailable = true,
    mapRow,
    dedupeKey
  }) {
    if (!tableAvailable) {
      return [];
    }
    const rowsByKey = new Map();
    asArray(terms).map((term) => cleanText(term, 220).toLowerCase()).filter(Boolean).forEach((term) => {
      querySqlRows(
        db,
        `SELECT ${selectColumns.join(', ')} FROM ${tableName} WHERE lower(search_text) LIKE ? LIMIT ?`,
        [`%${term}%`, Math.max(1, Number(rowLimit) || 40)]
      ).forEach((row) => {
        const mapped = mapRow(row, term);
        const key = dedupeKey(mapped);
        if (!key) {
          return;
        }
        const existing = rowsByKey.get(key);
        if (!existing) {
          rowsByKey.set(key, { ...mapped, matched_terms: [term] });
        } else {
          existing.matched_terms = uniqueStrings([...existing.matched_terms, term], 8);
        }
      });
    });
    return [...rowsByKey.values()];
  }

  async function maybeBackfillSqlIndex({
    shouldBackfill = false,
    dataFilePath = '',
    fallbackDataFilePath = '',
    snapshot = {}
  } = {}) {
    if (shouldBackfill !== true || !cleanText(dataFilePath, 2000)) {
      return false;
    }
    try {
      await syncBundleFromSnapshot({ dataFilePath, fallbackDataFilePath, snapshot });
      return true;
    } catch {
      return false;
    }
  }

  return {
    asArray,
    cleanText,
    ensureObject,
    uniqueStrings,
    buildSearchText,
    normalizeQuery,
    buildTerms,
    rankRows,
    buildLookupContext,
    withSqliteDatabase,
    readSqliteTables,
    collectLikeMatches,
    maybeBackfillSqlIndex,
    mergeRowsByKey,
    querySqlRows
  };
}

module.exports = {
  createAgentLookupSupport
};
