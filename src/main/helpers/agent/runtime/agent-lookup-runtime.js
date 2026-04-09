'use strict';

const fs = require('fs/promises');
const path = require('path');
const { resolveAgentRuntimeFactory } = require('../shared/agent-runtime-registry.js');
const { createAgentInventoryLookupRuntime } = require('../tools/agent-inventory-lookup');
const { createAgentRecordLookupRuntime } = require('../tools/agent-record-lookup.js');

let SQLJS_WASM_JS_PATH = '';
try {
  SQLJS_WASM_JS_PATH = require.resolve('sql.js/dist/sql-wasm.js');
} catch {
  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
  SQLJS_WASM_JS_PATH = path.join(projectRoot, 'vendor', 'sqljs', 'sql-wasm.js');
}
let sqlJsInitPromise = null;

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

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

function ensureObject(value) {
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
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 20) => {
      const seen = new Set();
      const out = [];
      asArray(values).forEach((value) => {
        const normalized = cleanText(value, 220);
        if (!normalized) {
          return;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key) || out.length >= max) {
          return;
        }
        seen.add(key);
        out.push(normalized);
      });
      return out;
    });
  const getBundlePaths = typeof deps.getBundlePaths === 'function'
    ? deps.getBundlePaths
    : (() => ({
      dataFilePath: '',
      protocolsPath: '',
      notebookPagesPath: '',
      sqlitePath: ''
    }));
  const hydrateSnapshotFromBundle = typeof deps.hydrateSnapshotFromBundle === 'function'
    ? deps.hydrateSnapshotFromBundle
    : (async ({ snapshot = {} } = {}) => ({
      snapshot: ensureObject(snapshot),
      bundlePaths: {},
      sidecarPaths: {},
      migration: null
    }));
  const syncBundleFromSnapshot = typeof deps.syncBundleFromSnapshot === 'function'
    ? deps.syncBundleFromSnapshot
    : (async () => ({ bundlePaths: {}, sidecarPaths: {} }));

  function buildSearchText(values) {
    return values
      .map((value) => cleanText(value, 600))
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function normalizeQuery(value) {
    const query = cleanText(value, 300).toLowerCase();
    const tokens = query
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .slice(0, 12);
    return { query, tokens };
  }

  function buildTerms({ query = '', terms = [], maxTerms = 10 }) {
    return uniqueStrings([
      ...asArray(terms),
      cleanText(query, 220)
    ], maxTerms);
  }

  function scoreByTerms(text, terms = []) {
    const haystack = String(text || '').toLowerCase();
    if (!haystack || !terms.length) {
      return 0;
    }
    return terms.reduce((score, term) => (
      haystack.includes(String(term || '').toLowerCase()) ? score + 1 : score
    ), 0);
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
        let score = scoreByTerms(searchText, normalizedTerms) * 10;
        if (normalizedQuery && primaryText === normalizedQuery) {
          score += 40;
        } else if (normalizedQuery && primaryText.includes(normalizedQuery)) {
          score += 15;
        }
        if (normalizedQuery && searchText.includes(normalizedQuery)) {
          score += 8;
        }
        return {
          ...row,
          _score: score
        };
      })
      .filter((row) => row._score > 0)
      .sort((left, right) => right._score - left._score)
      .slice(0, Math.max(1, Number(limit) || 6));
  }

  async function loadSnapshotFromDataFile(dataFilePath) {
    const resolvedPath = cleanText(dataFilePath, 2000);
    if (!resolvedPath) {
      return {};
    }
    try {
      const raw = await fs.readFile(resolvedPath, 'utf8');
      return ensureObject(safeParseJson(raw, {}));
    } catch {
      return {};
    }
  }

  async function buildLookupContext({
    dataFilePath = '',
    fallbackDataFilePath = '',
    snapshot = {}
  } = {}) {
    const resolvedDataFilePath = cleanText(dataFilePath || fallbackDataFilePath, 2000);
    const fallbackPath = cleanText(fallbackDataFilePath || dataFilePath, 2000);
    const baseSnapshot = ensureObject(snapshot);
    let sourceSnapshot = baseSnapshot;

    if (resolvedDataFilePath) {
      const loaded = await loadSnapshotFromDataFile(resolvedDataFilePath);
      if (Object.keys(loaded).length) {
        sourceSnapshot = loaded;
      }
    }

    const hydrated = await hydrateSnapshotFromBundle({
      dataFilePath: resolvedDataFilePath,
      snapshot: sourceSnapshot,
      fallbackDataFilePath: fallbackPath
    });

    const hydratedSnapshot = ensureObject(hydrated?.snapshot || sourceSnapshot);
    const bundlePaths = getBundlePaths({
      dataFilePath: resolvedDataFilePath,
      fallbackDataFilePath: fallbackPath
    });

    return {
      dataFilePath: resolvedDataFilePath,
      fallbackDataFilePath: fallbackPath,
      sqlitePath: cleanText(bundlePaths?.sqlitePath, 2200),
      hydratedSnapshot,
      bundlePaths
    };
  }

  async function withSqliteDatabase(sqlitePath, callback) {
    const targetPath = cleanText(sqlitePath, 2200);
    if (!targetPath) {
      return {
        ok: false,
        reason: 'missing_sqlite_path',
        result: null
      };
    }

    let bytes;
    try {
      bytes = await fs.readFile(targetPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          ok: false,
          reason: 'sqlite_missing',
          result: null
        };
      }
      throw error;
    }

    if (!bytes.length) {
      return {
        ok: false,
        reason: 'sqlite_empty',
        result: null
      };
    }

    const SQL = await loadSqlJs();
    const db = new SQL.Database(new Uint8Array(bytes));
    try {
      const result = await callback(db);
      return {
        ok: true,
        reason: '',
        result
      };
    } finally {
      db.close();
    }
  }

  function querySqlRows(db, sql, values = []) {
    const stmt = db.prepare(sql);
    const rows = [];
    try {
      stmt.bind(values);
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  function readSqliteTables(db) {
    const rows = querySqlRows(db, "SELECT name FROM sqlite_master WHERE type='table'", []);
    const set = new Set();
    asArray(rows).forEach((row) => {
      const name = cleanText(row?.name, 200).toLowerCase();
      if (name) {
        set.add(name);
      }
    });
    return set;
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
    const normalizedTerms = asArray(terms).map((term) => cleanText(term, 220).toLowerCase()).filter(Boolean);
    normalizedTerms.forEach((term) => {
      const sqlRows = querySqlRows(
        db,
        `SELECT ${selectColumns.join(', ')} FROM ${tableName} WHERE lower(search_text) LIKE ? LIMIT ?`,
        [`%${term}%`, Math.max(1, Number(rowLimit) || 40)]
      );
      asArray(sqlRows).forEach((row) => {
        const mapped = mapRow(row, term);
        const key = dedupeKey(mapped);
        if (!key) {
          return;
        }
        const existing = rowsByKey.get(key);
        if (!existing) {
          rowsByKey.set(key, {
            ...mapped,
            matched_terms: [term]
          });
          return;
        }
        existing.matched_terms = uniqueStrings([...existing.matched_terms, term], 8);
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
    if (shouldBackfill !== true) {
      return false;
    }
    if (!cleanText(dataFilePath, 2000)) {
      return false;
    }
    try {
      await syncBundleFromSnapshot({
        dataFilePath,
        snapshot,
        fallbackDataFilePath
      });
      return true;
    } catch {
      return false;
    }
  }

  function mergeRowsByKey(primaryRows, secondaryRows, toKey) {
    const merged = [];
    const seen = new Set();
    asArray(primaryRows).forEach((row) => {
      const key = toKey(row);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(row);
    });
    asArray(secondaryRows).forEach((row) => {
      const key = toKey(row);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(row);
    });
    return merged;
  }

  return {
    asArray,
    cleanText,
    ensureObject,
    safeParseJson,
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

function createAgentLookupRuntime(deps = {}) {
  const sharedLookupDeps = createAgentLookupSupport(deps);
  const buildInventorySearchTerms = typeof deps.buildInventorySearchTerms === 'function'
    ? deps.buildInventorySearchTerms
    : (({ fallbackQuery = '' } = {}) => sharedLookupDeps.uniqueStrings([fallbackQuery], 10));

  const inventoryLookupFactory = resolveAgentRuntimeFactory(deps, 'inventory-lookup');
  const recordLookupFactory = resolveAgentRuntimeFactory(deps, 'record-lookup');
  const inventoryLookupRuntime = typeof inventoryLookupFactory === 'function'
    ? inventoryLookupFactory({
      ...sharedLookupDeps,
      buildInventorySearchTerms
    })
    : createAgentInventoryLookupRuntime({
      ...sharedLookupDeps,
      buildInventorySearchTerms
    });
  const recordLookupRuntime = typeof recordLookupFactory === 'function'
    ? recordLookupFactory(sharedLookupDeps)
    : createAgentRecordLookupRuntime(sharedLookupDeps);

  function buildProtocolItemsFromSnapshot(snapshot, { query = '', limit = 6 } = {}) {
    const rows = sharedLookupDeps.asArray(snapshot?.protocols).map((protocol) => {
      const payload = sharedLookupDeps.ensureObject(protocol);
      const steps = sharedLookupDeps.asArray(payload.steps).map((step) => {
        if (typeof step === 'string') {
          return sharedLookupDeps.cleanText(step, 220);
        }
        const stepPayload = sharedLookupDeps.ensureObject(step);
        return sharedLookupDeps.cleanText(stepPayload.text || stepPayload.instruction || stepPayload.action, 220);
      }).filter(Boolean);
      return {
        id: sharedLookupDeps.cleanText(payload.id, 120),
        name: sharedLookupDeps.cleanText(payload.name, 220),
        category: sharedLookupDeps.cleanText(payload.category, 80),
        steps,
        search_text: sharedLookupDeps.buildSearchText([
          payload.id,
          payload.name,
          payload.category,
          payload.purpose,
          payload.description,
          steps.join(' ')
        ])
      };
    });

    const ranked = sharedLookupDeps.rankRows(rows, {
      terms: sharedLookupDeps.buildTerms({ query, terms: [query], maxTerms: 8 }),
      query,
      limit,
      getSearchText: (row) => row?.search_text,
      getPrimaryText: (row) => row?.name
    });

    return ranked.map((row) => ({
      id: sharedLookupDeps.cleanText(row.id, 120),
      name: sharedLookupDeps.cleanText(row.name, 220),
      category: sharedLookupDeps.cleanText(row.category, 80),
      steps: sharedLookupDeps.asArray(row.steps).slice(0, 8).map((step) => sharedLookupDeps.cleanText(step, 220)).filter(Boolean)
    }));
  }

  function buildNotebookItemsFromSnapshot(snapshot, { query = '', limit = 6 } = {}) {
    const rows = sharedLookupDeps.asArray(snapshot?.notebookEntries).map((entry) => {
      const payload = sharedLookupDeps.ensureObject(entry);
      return {
        id: sharedLookupDeps.cleanText(payload.id, 120),
        protocolName: sharedLookupDeps.cleanText(payload.protocolName, 220),
        result: sharedLookupDeps.cleanText(payload.result, 500),
        updatedAt: sharedLookupDeps.cleanText(payload.updatedAt || payload.createdAt, 80),
        search_text: sharedLookupDeps.buildSearchText([
          payload.id,
          payload.protocolId,
          payload.protocolName,
          payload.projectId,
          payload.projectName,
          payload.result,
          payload.updatedAt
        ])
      };
    });

    const ranked = sharedLookupDeps.rankRows(rows, {
      terms: sharedLookupDeps.buildTerms({ query, terms: [query], maxTerms: 8 }),
      query,
      limit,
      getSearchText: (row) => row?.search_text,
      getPrimaryText: (row) => row?.protocolName
    });

    return ranked.map((row) => ({
      id: sharedLookupDeps.cleanText(row.id, 120),
      protocolName: sharedLookupDeps.cleanText(row.protocolName, 220),
      result: sharedLookupDeps.cleanText(row.result, 500),
      updatedAt: sharedLookupDeps.cleanText(row.updatedAt, 80)
    }));
  }

  async function searchProtocolsIndex({
    dataFilePath = '',
    fallbackDataFilePath = '',
    query = '',
    limit = 6,
    snapshot = {}
  } = {}) {
    const requestedLimit = Math.max(1, Number(limit) || 6);
    const context = await sharedLookupDeps.buildLookupContext({
      dataFilePath,
      fallbackDataFilePath,
      snapshot
    });
    const searchResult = await recordLookupRuntime.searchRecordIndex({
      dataFilePath: context.dataFilePath,
      fallbackDataFilePath: context.fallbackDataFilePath,
      query,
      limit: Math.max(requestedLimit * 6, 24),
      searchTerms: [query],
      snapshot: context.hydratedSnapshot
    });

    const protocolById = new Map(
      sharedLookupDeps.asArray(context.hydratedSnapshot?.protocols).map((protocol) => {
        const payload = sharedLookupDeps.ensureObject(protocol);
        return [sharedLookupDeps.cleanText(payload.id, 120), payload];
      })
    );

    let items = sharedLookupDeps.asArray(searchResult.items)
      .filter((item) => sharedLookupDeps.cleanText(item?.record_type, 40) === 'protocol')
      .map((item) => {
        const protocol = protocolById.get(sharedLookupDeps.cleanText(item?.id, 120)) || {};
        const steps = sharedLookupDeps.asArray(protocol?.steps).map((step) => {
          if (typeof step === 'string') {
            return sharedLookupDeps.cleanText(step, 220);
          }
          const stepPayload = sharedLookupDeps.ensureObject(step);
          return sharedLookupDeps.cleanText(stepPayload.text || stepPayload.instruction || stepPayload.action, 220);
        }).filter(Boolean).slice(0, 8);
        return {
          id: sharedLookupDeps.cleanText(item?.id, 120),
          name: sharedLookupDeps.cleanText(protocol?.name || item?.title, 220),
          category: sharedLookupDeps.cleanText(protocol?.category, 80),
          steps
        };
      })
      .slice(0, requestedLimit);

    if (!items.length) {
      items = buildProtocolItemsFromSnapshot(context.hydratedSnapshot, {
        query,
        limit: requestedLimit
      });
    }

    return {
      items,
      usedSqlite: searchResult.usedSqlite === true,
      source: sharedLookupDeps.cleanText(searchResult.source, 80) || 'fallback_json',
      backfilledSql: searchResult.backfilledSql === true
    };
  }

  async function searchNotebookEntriesIndex({
    dataFilePath = '',
    fallbackDataFilePath = '',
    query = '',
    limit = 6,
    snapshot = {}
  } = {}) {
    const requestedLimit = Math.max(1, Number(limit) || 6);
    const context = await sharedLookupDeps.buildLookupContext({
      dataFilePath,
      fallbackDataFilePath,
      snapshot
    });
    const searchResult = await recordLookupRuntime.searchRecordIndex({
      dataFilePath: context.dataFilePath,
      fallbackDataFilePath: context.fallbackDataFilePath,
      query,
      limit: Math.max(requestedLimit * 6, 24),
      searchTerms: [query],
      snapshot: context.hydratedSnapshot
    });

    const notebookById = new Map(
      sharedLookupDeps.asArray(context.hydratedSnapshot?.notebookEntries).map((entry) => {
        const payload = sharedLookupDeps.ensureObject(entry);
        return [sharedLookupDeps.cleanText(payload.id, 120), payload];
      })
    );

    let items = sharedLookupDeps.asArray(searchResult.items)
      .filter((item) => sharedLookupDeps.cleanText(item?.record_type, 40) === 'notebook')
      .map((item) => {
        const entry = notebookById.get(sharedLookupDeps.cleanText(item?.id, 120)) || {};
        return {
          id: sharedLookupDeps.cleanText(item?.id, 120),
          protocolName: sharedLookupDeps.cleanText(entry?.protocolName || item?.linked_protocol_name || item?.title, 220),
          result: sharedLookupDeps.cleanText(entry?.result || item?.summary, 500),
          updatedAt: sharedLookupDeps.cleanText(entry?.updatedAt || entry?.createdAt || item?.updated_at, 80)
        };
      })
      .slice(0, requestedLimit);

    if (!items.length) {
      items = buildNotebookItemsFromSnapshot(context.hydratedSnapshot, {
        query,
        limit: requestedLimit
      });
    }

    return {
      items,
      usedSqlite: searchResult.usedSqlite === true,
      source: sharedLookupDeps.cleanText(searchResult.source, 80) || 'fallback_json',
      backfilledSql: searchResult.backfilledSql === true
    };
  }

  return {
    searchInventoryIndex: inventoryLookupRuntime.searchInventoryIndex,
    searchProtocolsIndex,
    searchNotebookEntriesIndex,
    searchRecordIndex: recordLookupRuntime.searchRecordIndex,
    executeInventoryLookup: inventoryLookupRuntime.executeInventoryLookup,
    executeRecordLookup: recordLookupRuntime.executeRecordLookup
  };
}

module.exports = {
  createAgentLookupRuntime
};
