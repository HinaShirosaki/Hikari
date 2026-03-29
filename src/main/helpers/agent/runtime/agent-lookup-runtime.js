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

function defaultCleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
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

function createAgentLookupRuntime(deps = {}) {
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
  const buildInventorySearchTerms = typeof deps.buildInventorySearchTerms === 'function'
    ? deps.buildInventorySearchTerms
    : (({ fallbackQuery = '' } = {}) => uniqueStrings([fallbackQuery], 10));

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

  function resolvePersonalSections(inventoryPayload) {
    const inventory = ensureObject(inventoryPayload);
    if (Array.isArray(inventory.personal)) {
      return asArray(inventory.personal).map((zone) => ({
        zone: cleanText(zone?.zone, 120),
        items: asArray(zone?.items)
      })).filter((zone) => zone.zone || zone.items.length > 0);
    }
    if (inventory.personal && typeof inventory.personal === 'object') {
      return Object.entries(inventory.personal).map(([zoneName, rawItems]) => ({
        zone: cleanText(zoneName, 120),
        items: asArray(rawItems)
      })).filter((zone) => zone.zone || zone.items.length > 0);
    }
    return Object.entries(inventory)
      .filter(([zoneName, rawItems]) => zoneName !== 'chemicals' && zoneName !== 'personal' && Array.isArray(rawItems))
      .map(([zoneName, rawItems]) => ({
        zone: cleanText(zoneName, 120),
        items: asArray(rawItems)
      }));
  }

  function buildContainerMapFromSnapshot(snapshot) {
    const map = new Map();
    resolvePersonalSections(snapshot?.inventory).forEach((section) => {
      asArray(section.items).forEach((container) => {
        const id = cleanText(container?.id, 140);
        if (!id) {
          return;
        }
        const key = `${cleanText(section.zone, 120).toLowerCase()}::${id.toLowerCase()}`;
        map.set(key, {
          zone: cleanText(section.zone, 120),
          id,
          name: cleanText(container?.name, 220),
          type: cleanText(container?.type, 40),
          location: cleanText(container?.location, 220),
          quantity: cleanText(container?.quantity, 80),
          singleContent: cleanText(container?.singleContent, 260),
          wellsSummary: asArray(container?.wells)
            .map((well) => {
              if (typeof well === 'string') {
                return cleanText(well, 80);
              }
              const payload = ensureObject(well);
              return cleanText(payload.content || payload.name, 80);
            })
            .filter(Boolean)
            .slice(0, 24)
            .join(' ')
        });
      });
    });
    return map;
  }

  function formatSampleLocation(sample) {
    const location = ensureObject(sample?.location);
    const parts = Object.entries(location)
      .filter(([key]) => key !== 'storageType')
      .map(([, value]) => cleanText(value, 120))
      .filter(Boolean);
    return parts.join(' / ');
  }

  function buildInventoryFallbackItems({ snapshot = {}, query = '', searchTerms = [], limit = 8 }) {
    const containerMap = buildContainerMapFromSnapshot(snapshot);
    const chemicalItems = asArray(snapshot?.labInventory?.chemicals).map((chemical) => {
      const payload = ensureObject(chemical);
      return {
        kind: 'chemical',
        zone: 'Lab Inventory',
        id: cleanText(payload.id, 120),
        name: cleanText(payload.name, 220),
        quantity: '',
        amount: cleanText(payload.amountInStock || payload.amount, 80),
        cas: cleanText(payload.casNumber || payload.cas, 80),
        location: cleanText(payload.location || payload.locationCode, 220),
        supplier: cleanText(payload.vendor || payload.supplier, 180),
        search_text: buildSearchText([
          payload.id,
          payload.name,
          payload.amountInStock,
          payload.amount,
          payload.casNumber,
          payload.cas,
          payload.location,
          payload.locationCode,
          payload.vendor,
          payload.supplier,
          payload.catalogNumber,
          payload.unitSize
        ])
      };
    });

    const personalContainerItems = [...containerMap.values()].map((container) => ({
      kind: 'personal_container',
      zone: cleanText(container.zone, 120),
      id: cleanText(container.id, 120),
      name: cleanText(container.name, 220),
      quantity: cleanText(container.quantity, 80),
      amount: '',
      cas: '',
      location: cleanText(container.location, 220),
      supplier: '',
      search_text: buildSearchText([
        container.zone,
        container.id,
        container.name,
        container.quantity,
        container.location,
        container.type,
        container.singleContent,
        container.wellsSummary
      ])
    }));

    const sampleItems = asArray(snapshot?.samples).map((sample) => {
      const payload = ensureObject(sample);
      const link = ensureObject(payload.inventoryLink);
      const section = cleanText(link.section, 120);
      const containerId = cleanText(link.containerId, 120);
      const containerKey = `${section.toLowerCase()}::${containerId.toLowerCase()}`;
      const container = containerMap.get(containerKey);
      const wellIndex = Number.isFinite(Number(link.wellIndex)) ? Number(link.wellIndex) : null;
      const location = formatSampleLocation(payload) || cleanText(container?.location, 220);
      const name = cleanText(payload.name, 220);
      const code = cleanText(payload.code, 120);
      return {
        kind: 'personal_sample',
        zone: section || cleanText(container?.zone, 120),
        id: cleanText(payload.id, 120) || code,
        name: name || code,
        quantity: cleanText(payload.concentration, 80),
        amount: '',
        cas: '',
        location,
        supplier: '',
        matched_term: '',
        sample_type: cleanText(payload.type, 80),
        sample_code: code,
        lot: cleanText(payload.lot, 120),
        container_id: containerId,
        container_name: cleanText(container?.name, 220),
        well_index: wellIndex,
        notes: cleanText(payload.notes, 240),
        search_text: buildSearchText([
          payload.id,
          payload.code,
          payload.name,
          payload.type,
          payload.lot,
          payload.concentration,
          payload.notes,
          section,
          containerId,
          container?.name,
          wellIndex
        ])
      };
    }).filter((sample) => sample.id || sample.name);

    const ranked = rankRows(
      [...chemicalItems, ...personalContainerItems, ...sampleItems],
      {
        terms: searchTerms,
        query,
        limit: Math.max(Number(limit) || 8, 40),
        getSearchText: (row) => row?.search_text,
        getPrimaryText: (row) => row?.name
      }
    );

    const normalizedTerms = asArray(searchTerms).map((term) => cleanText(term, 220).toLowerCase()).filter(Boolean);
    const items = ranked.slice(0, Math.max(1, Number(limit) || 8)).map((row) => ({
      kind: cleanText(row.kind, 40),
      zone: cleanText(row.zone, 120),
      id: cleanText(row.id, 120),
      name: cleanText(row.name, 220),
      quantity: cleanText(row.quantity, 80),
      amount: cleanText(row.amount, 80),
      cas: cleanText(row.cas, 80),
      location: cleanText(row.location, 220),
      supplier: cleanText(row.supplier, 180),
      matched_term: cleanText(
        asArray(normalizedTerms).find((term) => String(row.search_text || '').includes(term)),
        140
      ) || cleanText(asArray(searchTerms)[0], 140),
      sample_type: cleanText(row.sample_type, 80),
      sample_code: cleanText(row.sample_code, 120),
      lot: cleanText(row.lot, 120),
      container_id: cleanText(row.container_id, 120),
      container_name: cleanText(row.container_name, 220),
      well_index: Number.isFinite(Number(row.well_index)) ? Number(row.well_index) : null,
      notes: cleanText(row.notes, 240)
    }));

    return {
      items,
      sampleCount: sampleItems.length,
      termsUsed: uniqueStrings(searchTerms, 10)
    };
  }

  async function searchInventorySqlite({ sqlitePath = '', query = '', searchTerms = [], limit = 8 }) {
    const dbResult = await withSqliteDatabase(sqlitePath, async (db) => {
      const tables = readSqliteTables(db);
      const hasChemicals = tables.has('inventory_chemicals');
      const hasPersonal = tables.has('inventory_personal');
      const hasSamples = tables.has('inventory_samples');
      const sampleRowCount = hasSamples
        ? Number(querySqlRows(db, 'SELECT COUNT(1) AS count FROM inventory_samples', [])[0]?.count || 0)
        : 0;

      const terms = uniqueStrings(searchTerms, 10);

      const chemicalRows = collectLikeMatches(db, {
        tableName: 'inventory_chemicals',
        selectColumns: ['id', 'name', 'amount', 'cas', 'location', 'supplier', 'search_text'],
        terms,
        tableAvailable: hasChemicals,
        mapRow: (row) => ({
          kind: 'chemical',
          zone: 'Lab Inventory',
          id: cleanText(row?.id, 120),
          name: cleanText(row?.name, 220),
          quantity: '',
          amount: cleanText(row?.amount, 80),
          cas: cleanText(row?.cas, 80),
          location: cleanText(row?.location, 220),
          supplier: cleanText(row?.supplier, 180),
          search_text: cleanText(row?.search_text, 4000)
        }),
        dedupeKey: (row) => `chemical::${cleanText(row.id, 120).toLowerCase()}`
      });

      const personalRows = collectLikeMatches(db, {
        tableName: 'inventory_personal',
        selectColumns: ['zone', 'id', 'name', 'quantity', 'location', 'search_text'],
        terms,
        tableAvailable: hasPersonal,
        mapRow: (row) => ({
          kind: 'personal_container',
          zone: cleanText(row?.zone, 120),
          id: cleanText(row?.id, 120),
          name: cleanText(row?.name, 220),
          quantity: cleanText(row?.quantity, 80),
          amount: '',
          cas: '',
          location: cleanText(row?.location, 220),
          supplier: '',
          search_text: cleanText(row?.search_text, 4000)
        }),
        dedupeKey: (row) => `container::${cleanText(row.zone, 120).toLowerCase()}::${cleanText(row.id, 120).toLowerCase()}`
      });

      const sampleRows = collectLikeMatches(db, {
        tableName: 'inventory_samples',
        selectColumns: [
          'id',
          'code',
          'name',
          'sample_type',
          'lot',
          'concentration',
          'section',
          'container_id',
          'container_name',
          'well_index',
          'location_text',
          'notes',
          'search_text'
        ],
        terms,
        tableAvailable: hasSamples,
        mapRow: (row) => ({
          kind: 'personal_sample',
          zone: cleanText(row?.section, 120),
          id: cleanText(row?.id, 120),
          name: cleanText(row?.name || row?.code, 220),
          quantity: cleanText(row?.concentration, 80),
          amount: '',
          cas: '',
          location: cleanText(row?.location_text, 220),
          supplier: '',
          sample_type: cleanText(row?.sample_type, 80),
          sample_code: cleanText(row?.code, 120),
          lot: cleanText(row?.lot, 120),
          container_id: cleanText(row?.container_id, 120),
          container_name: cleanText(row?.container_name, 220),
          well_index: Number.isFinite(Number(row?.well_index)) ? Number(row.well_index) : null,
          notes: cleanText(row?.notes, 240),
          search_text: cleanText(row?.search_text, 4000)
        }),
        dedupeKey: (row) => `sample::${cleanText(row.id || row.sample_code, 120).toLowerCase()}`
      });

      const ranked = rankRows(
        [...chemicalRows, ...personalRows, ...sampleRows],
        {
          terms,
          query,
          limit: Math.max(1, Number(limit) || 8),
          getSearchText: (row) => row?.search_text,
          getPrimaryText: (row) => row?.name
        }
      );

      return {
        usedSqlite: true,
        items: ranked.map((row) => {
          const matched = asArray(row.matched_terms).find((term) => String(row.search_text || '').includes(term));
          return {
            kind: cleanText(row.kind, 40),
            zone: cleanText(row.zone, 120),
            id: cleanText(row.id, 120),
            name: cleanText(row.name, 220),
            quantity: cleanText(row.quantity, 80),
            amount: cleanText(row.amount, 80),
            cas: cleanText(row.cas, 80),
            location: cleanText(row.location, 220),
            supplier: cleanText(row.supplier, 180),
            matched_term: cleanText(matched || asArray(searchTerms)[0], 140),
            sample_type: cleanText(row.sample_type, 80),
            sample_code: cleanText(row.sample_code, 120),
            lot: cleanText(row.lot, 120),
            container_id: cleanText(row.container_id, 120),
            container_name: cleanText(row.container_name, 220),
            well_index: Number.isFinite(Number(row.well_index)) ? Number(row.well_index) : null,
            notes: cleanText(row.notes, 240)
          };
        }),
        tableStatus: {
          inventory_chemicals_exists: hasChemicals,
          inventory_personal_exists: hasPersonal,
          inventory_samples_exists: hasSamples,
          inventory_samples_row_count: sampleRowCount
        }
      };
    });

    if (!dbResult.ok) {
      return {
        usedSqlite: false,
        sqliteReason: dbResult.reason,
        items: [],
        tableStatus: {
          inventory_chemicals_exists: false,
          inventory_personal_exists: false,
          inventory_samples_exists: false,
          inventory_samples_row_count: 0
        }
      };
    }

    return dbResult.result;
  }

  function buildRecordFallbackItems({ snapshot = {}, query = '', terms = [], limit = 8 }) {
    const records = [];

    asArray(snapshot?.notebookEntries).forEach((entry) => {
      const payload = ensureObject(entry);
      records.push({
        record_type: 'notebook',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.protocolName || payload.id, 220),
        project_id: cleanText(payload.projectId, 120),
        project_name: cleanText(payload.projectName, 220),
        summary: cleanText(payload.result, 500),
        linked_protocol_id: cleanText(payload.protocolId, 120),
        linked_protocol_name: cleanText(payload.protocolName, 220),
        updated_at: cleanText(payload.updatedAt || payload.createdAt, 80),
        search_text: buildSearchText([
          payload.id,
          payload.protocolId,
          payload.protocolName,
          payload.projectId,
          payload.projectName,
          payload.result,
          payload.updatedAt,
          JSON.stringify(payload.values || {})
        ])
      });
    });

    asArray(snapshot?.workflows).forEach((workflow) => {
      const payload = ensureObject(workflow);
      records.push({
        record_type: 'workflow',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.name || payload.id, 220),
        project_id: cleanText(payload.projectId, 120),
        project_name: cleanText(payload.projectName, 220),
        summary: cleanText(payload.description, 500),
        linked_protocol_id: '',
        linked_protocol_name: '',
        updated_at: cleanText(payload.updatedAt || payload.createdAt, 80),
        search_text: buildSearchText([
          payload.id,
          payload.name,
          payload.description,
          payload.projectId,
          payload.projectName,
          asArray(payload.blocks).map((block) => block?.text || block?.protocolId).join(' ')
        ])
      });
    });

    asArray(snapshot?.assays).forEach((assay) => {
      const payload = ensureObject(assay);
      records.push({
        record_type: 'assay',
        record_id: cleanText(payload.id || payload.assay_number, 120),
        title: cleanText(payload.name || payload.assay_number || payload.id, 220),
        project_id: cleanText(payload.project_id || payload.projectId, 120),
        project_name: cleanText(payload.project_name || payload.projectName, 220),
        summary: cleanText(payload.notes || payload.notebook_entry_protocol_name || payload.name, 500),
        linked_protocol_id: cleanText(payload.notebook_entry_protocol_id || payload.protocolId, 120),
        linked_protocol_name: cleanText(payload.notebook_entry_protocol_name || payload.protocolName, 220),
        updated_at: cleanText(payload.updated_at || payload.updatedAt || payload.created_at, 80),
        search_text: buildSearchText([
          payload.id,
          payload.assay_number,
          payload.name,
          payload.notes,
          payload.project_id,
          payload.project_name,
          payload.notebook_entry_protocol_name
        ])
      });
    });

    asArray(snapshot?.gelAnalyses).forEach((analysis) => {
      const payload = ensureObject(analysis);
      records.push({
        record_type: 'gel',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.name || payload.id, 220),
        project_id: cleanText(payload.project_id || payload.projectId, 120),
        project_name: cleanText(payload.project_name || payload.projectName, 220),
        summary: cleanText(payload.analysis_type || payload.notebook_entry_protocol_name || payload.name, 500),
        linked_protocol_id: cleanText(payload.notebook_entry_protocol_id || payload.protocolId, 120),
        linked_protocol_name: cleanText(payload.notebook_entry_protocol_name || payload.protocolName, 220),
        updated_at: cleanText(payload.updated_at || payload.updatedAt || payload.created_at, 80),
        search_text: buildSearchText([
          payload.id,
          payload.name,
          payload.analysis_type,
          payload.project_id,
          payload.project_name,
          payload.notebook_entry_protocol_name,
          asArray(payload.warnings).join(' ')
        ])
      });
    });

    asArray(snapshot?.protocols).forEach((protocol) => {
      const payload = ensureObject(protocol);
      records.push({
        record_type: 'protocol',
        record_id: cleanText(payload.id, 120),
        title: cleanText(payload.name || payload.id, 220),
        project_id: cleanText(payload.projectId, 120),
        project_name: cleanText(payload.projectName || payload.linkedProject, 220),
        summary: cleanText(payload.purpose || payload.description || payload.category, 500),
        linked_protocol_id: cleanText(payload.id, 120),
        linked_protocol_name: cleanText(payload.name, 220),
        updated_at: cleanText(payload.updatedAt || payload.createdAt, 80),
        search_text: buildSearchText([
          payload.id,
          payload.name,
          payload.purpose,
          payload.description,
          payload.category,
          payload.projectId,
          payload.projectName,
          payload.linkedProject,
          asArray(payload.steps).map((step) => {
            if (typeof step === 'string') {
              return step;
            }
            return step?.text || step?.instruction || step?.action || '';
          }).join(' ')
        ])
      });
    });

    const ranked = rankRows(records, {
      terms,
      query,
      limit: Math.max(Number(limit) || 8, 80),
      getSearchText: (row) => row?.search_text,
      getPrimaryText: (row) => row?.title
    });

    return ranked.slice(0, Math.max(1, Number(limit) || 8)).map((row) => ({
      record_type: cleanText(row.record_type, 40),
      id: cleanText(row.record_id, 120),
      title: cleanText(row.title, 220),
      project_id: cleanText(row.project_id, 120),
      project_name: cleanText(row.project_name, 220),
      summary: cleanText(row.summary, 500),
      linked_protocol_id: cleanText(row.linked_protocol_id, 120),
      linked_protocol_name: cleanText(row.linked_protocol_name, 220),
      updated_at: cleanText(row.updated_at, 80)
    }));
  }

  async function searchRecordSqlite({ sqlitePath = '', query = '', searchTerms = [], limit = 8 }) {
    const dbResult = await withSqliteDatabase(sqlitePath, async (db) => {
      const tables = readSqliteTables(db);
      const hasRecordIndex = tables.has('record_index');
      const terms = uniqueStrings(searchTerms, 10);

      if (!hasRecordIndex) {
        return {
          usedSqlite: true,
          items: [],
          tableStatus: {
            record_index_exists: false,
            record_index_row_count: 0
          }
        };
      }

      const rowCount = Number(querySqlRows(db, 'SELECT COUNT(1) AS count FROM record_index', [])[0]?.count || 0);
      const rows = collectLikeMatches(db, {
        tableName: 'record_index',
        selectColumns: [
          'record_type',
          'record_id',
          'title',
          'project_id',
          'project_name',
          'summary',
          'linked_protocol_id',
          'linked_protocol_name',
          'updated_at',
          'search_text'
        ],
        terms,
        tableAvailable: hasRecordIndex,
        mapRow: (row) => ({
          record_type: cleanText(row?.record_type, 40),
          record_id: cleanText(row?.record_id, 120),
          title: cleanText(row?.title, 220),
          project_id: cleanText(row?.project_id, 120),
          project_name: cleanText(row?.project_name, 220),
          summary: cleanText(row?.summary, 500),
          linked_protocol_id: cleanText(row?.linked_protocol_id, 120),
          linked_protocol_name: cleanText(row?.linked_protocol_name, 220),
          updated_at: cleanText(row?.updated_at, 80),
          search_text: cleanText(row?.search_text, 5000)
        }),
        dedupeKey: (row) => `${cleanText(row.record_type, 40).toLowerCase()}::${cleanText(row.record_id, 120).toLowerCase()}`
      });

      const ranked = rankRows(rows, {
        terms,
        query,
        limit: Math.max(1, Number(limit) || 8),
        getSearchText: (row) => row?.search_text,
        getPrimaryText: (row) => row?.title
      });

      return {
        usedSqlite: true,
        items: ranked.map((row) => ({
          record_type: cleanText(row.record_type, 40),
          id: cleanText(row.record_id, 120),
          title: cleanText(row.title, 220),
          project_id: cleanText(row.project_id, 120),
          project_name: cleanText(row.project_name, 220),
          summary: cleanText(row.summary, 500),
          linked_protocol_id: cleanText(row.linked_protocol_id, 120),
          linked_protocol_name: cleanText(row.linked_protocol_name, 220),
          updated_at: cleanText(row.updated_at, 80)
        })),
        tableStatus: {
          record_index_exists: true,
          record_index_row_count: rowCount
        }
      };
    });

    if (!dbResult.ok) {
      return {
        usedSqlite: false,
        sqliteReason: dbResult.reason,
        items: [],
        tableStatus: {
          record_index_exists: false,
          record_index_row_count: 0
        }
      };
    }

    return dbResult.result;
  }

  async function searchProtocolsSqlite({ sqlitePath = '', query = '', limit = 6 }) {
    const dbResult = await withSqliteDatabase(sqlitePath, async (db) => {
      const tables = readSqliteTables(db);
      if (!tables.has('protocol_index')) {
        return {
          usedSqlite: true,
          items: [],
          tableStatus: {
            protocol_index_exists: false,
            protocol_index_row_count: 0
          }
        };
      }
      const rowCount = Number(querySqlRows(db, 'SELECT COUNT(1) AS count FROM protocol_index', [])[0]?.count || 0);
      const terms = buildTerms({ query, terms: [query], maxTerms: 8 });
      const rows = collectLikeMatches(db, {
        tableName: 'protocol_index',
        selectColumns: ['id', 'name', 'category', 'description', 'steps_preview_json', 'search_text'],
        terms,
        tableAvailable: true,
        mapRow: (row) => ({
          id: cleanText(row?.id, 120),
          name: cleanText(row?.name, 220),
          category: cleanText(row?.category, 80),
          description: cleanText(row?.description, 500),
          search_text: cleanText(row?.search_text, 5000),
          steps: asArray(safeParseJson(row?.steps_preview_json, [])).map((step) => cleanText(step, 220)).filter(Boolean)
        }),
        dedupeKey: (row) => cleanText(row.id, 120).toLowerCase()
      });

      const ranked = rankRows(rows, {
        terms,
        query,
        limit,
        getSearchText: (row) => row?.search_text,
        getPrimaryText: (row) => row?.name
      });

      return {
        usedSqlite: true,
        items: ranked,
        tableStatus: {
          protocol_index_exists: true,
          protocol_index_row_count: rowCount
        }
      };
    });

    if (!dbResult.ok) {
      return {
        usedSqlite: false,
        sqliteReason: dbResult.reason,
        items: [],
        tableStatus: {
          protocol_index_exists: false,
          protocol_index_row_count: 0
        }
      };
    }

    return dbResult.result;
  }

  async function searchNotebookSqlite({ sqlitePath = '', query = '', limit = 6 }) {
    const dbResult = await withSqliteDatabase(sqlitePath, async (db) => {
      const tables = readSqliteTables(db);
      if (!tables.has('notebook_index')) {
        return {
          usedSqlite: true,
          items: [],
          tableStatus: {
            notebook_index_exists: false,
            notebook_index_row_count: 0
          }
        };
      }
      const rowCount = Number(querySqlRows(db, 'SELECT COUNT(1) AS count FROM notebook_index', [])[0]?.count || 0);
      const terms = buildTerms({ query, terms: [query], maxTerms: 8 });
      const rows = collectLikeMatches(db, {
        tableName: 'notebook_index',
        selectColumns: ['id', 'protocol_id', 'protocol_name', 'project_id', 'project_name', 'result', 'updated_at', 'search_text'],
        terms,
        tableAvailable: true,
        mapRow: (row) => ({
          id: cleanText(row?.id, 120),
          protocolId: cleanText(row?.protocol_id, 120),
          protocolName: cleanText(row?.protocol_name, 220),
          projectId: cleanText(row?.project_id, 120),
          projectName: cleanText(row?.project_name, 220),
          result: cleanText(row?.result, 500),
          updatedAt: cleanText(row?.updated_at, 80),
          search_text: cleanText(row?.search_text, 5000)
        }),
        dedupeKey: (row) => cleanText(row.id, 120).toLowerCase()
      });

      const ranked = rankRows(rows, {
        terms,
        query,
        limit,
        getSearchText: (row) => row?.search_text,
        getPrimaryText: (row) => row?.protocolName
      });

      return {
        usedSqlite: true,
        items: ranked,
        tableStatus: {
          notebook_index_exists: true,
          notebook_index_row_count: rowCount
        }
      };
    });

    if (!dbResult.ok) {
      return {
        usedSqlite: false,
        sqliteReason: dbResult.reason,
        items: [],
        tableStatus: {
          notebook_index_exists: false,
          notebook_index_row_count: 0
        }
      };
    }

    return dbResult.result;
  }

  function buildProtocolFallbackItems({ snapshot = {}, query = '', limit = 6 }) {
    const rows = asArray(snapshot?.protocols).map((protocol) => {
      const payload = ensureObject(protocol);
      const steps = asArray(payload.steps).map((step) => {
        if (typeof step === 'string') {
          return cleanText(step, 220);
        }
        const stepPayload = ensureObject(step);
        return cleanText(stepPayload.text || stepPayload.instruction || stepPayload.action, 220);
      }).filter(Boolean);
      return {
        id: cleanText(payload.id, 120),
        name: cleanText(payload.name, 220),
        category: cleanText(payload.category, 80),
        description: cleanText(payload.purpose || payload.description, 500),
        steps,
        search_text: buildSearchText([
          payload.id,
          payload.name,
          payload.category,
          payload.purpose,
          payload.description,
          steps.join(' ')
        ])
      };
    });

    const ranked = rankRows(rows, {
      terms: buildTerms({ query, terms: [query], maxTerms: 8 }),
      query,
      limit,
      getSearchText: (row) => row?.search_text,
      getPrimaryText: (row) => row?.name
    });

    return ranked.map((row) => ({
      id: cleanText(row.id, 120),
      name: cleanText(row.name, 220),
      category: cleanText(row.category, 80),
      steps: asArray(row.steps).slice(0, 8).map((step) => cleanText(step, 220)).filter(Boolean)
    }));
  }

  function buildNotebookFallbackItems({ snapshot = {}, query = '', limit = 6 }) {
    const rows = asArray(snapshot?.notebookEntries).map((entry) => {
      const payload = ensureObject(entry);
      return {
        id: cleanText(payload.id, 120),
        protocolId: cleanText(payload.protocolId, 120),
        protocolName: cleanText(payload.protocolName, 220),
        projectId: cleanText(payload.projectId, 120),
        projectName: cleanText(payload.projectName, 220),
        result: cleanText(payload.result, 500),
        updatedAt: cleanText(payload.updatedAt || payload.createdAt, 80),
        search_text: buildSearchText([
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

    const ranked = rankRows(rows, {
      terms: buildTerms({ query, terms: [query], maxTerms: 8 }),
      query,
      limit,
      getSearchText: (row) => row?.search_text,
      getPrimaryText: (row) => row?.protocolName
    });

    return ranked.map((row) => ({
      id: cleanText(row.id, 120),
      protocolName: cleanText(row.protocolName, 220),
      result: cleanText(row.result, 500),
      updatedAt: cleanText(row.updatedAt, 80)
    }));
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

  async function searchInventoryIndex({
    dataFilePath = '',
    fallbackDataFilePath = '',
    query = '',
    limit = 8,
    searchTerms = [],
    snapshot = {}
  } = {}) {
    const context = await buildLookupContext({
      dataFilePath,
      fallbackDataFilePath,
      snapshot
    });

    const termsUsed = buildTerms({
      query,
      terms: asArray(searchTerms),
      maxTerms: 10
    });

    const sqlResult = await searchInventorySqlite({
      sqlitePath: context.sqlitePath,
      query,
      searchTerms: termsUsed,
      limit
    });
    const fallbackResult = buildInventoryFallbackItems({
      snapshot: context.hydratedSnapshot,
      query,
      searchTerms: termsUsed,
      limit
    });

    let source = sqlResult.usedSqlite ? 'sqlite' : 'fallback_json';
    let items = asArray(sqlResult.items).slice(0, Math.max(1, Number(limit) || 8));

    if (!items.length && fallbackResult.items.length) {
      source = 'fallback_json';
      items = fallbackResult.items.slice(0, Math.max(1, Number(limit) || 8));
    }

    const hasSnapshotSamples = asArray(context.hydratedSnapshot?.samples).length > 0;
    const sqlSampleTableExists = sqlResult.tableStatus?.inventory_samples_exists === true;
    const sqlSampleRowCount = Number(sqlResult.tableStatus?.inventory_samples_row_count) || 0;

    const shouldBackfill = Boolean(
      context.dataFilePath
      && (
        !sqlResult.usedSqlite
        || (hasSnapshotSamples && (!sqlSampleTableExists || sqlSampleRowCount === 0))
        || (source === 'fallback_json' && fallbackResult.items.length > 0)
      )
    );

    const backfilledSql = await maybeBackfillSqlIndex({
      shouldBackfill,
      dataFilePath: context.dataFilePath,
      fallbackDataFilePath: context.fallbackDataFilePath,
      snapshot: context.hydratedSnapshot
    });

    if (backfilledSql) {
      const rerun = await searchInventorySqlite({
        sqlitePath: context.sqlitePath,
        query,
        searchTerms: termsUsed,
        limit
      });
      if (asArray(rerun.items).length) {
        const merged = mergeRowsByKey(
          rerun.items,
          fallbackResult.items,
          (row) => `${cleanText(row?.kind, 40)}::${cleanText(row?.zone, 120)}::${cleanText(row?.id, 120)}`
        );
        items = merged.slice(0, Math.max(1, Number(limit) || 8));
        source = merged.length > asArray(rerun.items).length ? 'sqlite+fallback' : 'sqlite';
      }
    }

    return {
      items,
      usedSqlite: source.startsWith('sqlite'),
      source,
      termsUsed,
      backfilledSql,
      query: cleanText(query, 300)
    };
  }

  async function searchRecordIndex({
    dataFilePath = '',
    fallbackDataFilePath = '',
    query = '',
    limit = 8,
    searchTerms = [],
    snapshot = {}
  } = {}) {
    const context = await buildLookupContext({
      dataFilePath,
      fallbackDataFilePath,
      snapshot
    });

    const termsUsed = buildTerms({ query, terms: searchTerms, maxTerms: 10 });
    const sqlResult = await searchRecordSqlite({
      sqlitePath: context.sqlitePath,
      query,
      searchTerms: termsUsed,
      limit
    });
    const fallbackItems = buildRecordFallbackItems({
      snapshot: context.hydratedSnapshot,
      query,
      terms: termsUsed,
      limit
    });

    let source = sqlResult.usedSqlite ? 'sqlite' : 'fallback_json';
    let items = asArray(sqlResult.items).slice(0, Math.max(1, Number(limit) || 8));
    if (!items.length && fallbackItems.length) {
      source = 'fallback_json';
      items = fallbackItems.slice(0, Math.max(1, Number(limit) || 8));
    }

    const shouldBackfill = Boolean(
      context.dataFilePath
      && (
        !sqlResult.usedSqlite
        || sqlResult.tableStatus?.record_index_exists !== true
        || Number(sqlResult.tableStatus?.record_index_row_count || 0) === 0
        || (source === 'fallback_json' && fallbackItems.length > 0)
      )
    );

    const backfilledSql = await maybeBackfillSqlIndex({
      shouldBackfill,
      dataFilePath: context.dataFilePath,
      fallbackDataFilePath: context.fallbackDataFilePath,
      snapshot: context.hydratedSnapshot
    });

    if (backfilledSql) {
      const rerun = await searchRecordSqlite({
        sqlitePath: context.sqlitePath,
        query,
        searchTerms: termsUsed,
        limit
      });
      if (asArray(rerun.items).length) {
        items = mergeRowsByKey(
          rerun.items,
          fallbackItems,
          (row) => `${cleanText(row?.record_type, 40)}::${cleanText(row?.id, 120)}`
        ).slice(0, Math.max(1, Number(limit) || 8));
        source = items.length > asArray(rerun.items).length ? 'sqlite+fallback' : 'sqlite';
      }
    }

    return {
      items,
      usedSqlite: source.startsWith('sqlite'),
      source,
      backfilledSql,
      query: cleanText(query, 300)
    };
  }

  async function searchProtocolsIndex({
    dataFilePath = '',
    fallbackDataFilePath = '',
    query = '',
    limit = 6,
    snapshot = {}
  } = {}) {
    const context = await buildLookupContext({
      dataFilePath,
      fallbackDataFilePath,
      snapshot
    });
    const sqlResult = await searchProtocolsSqlite({
      sqlitePath: context.sqlitePath,
      query,
      limit
    });
    const fallbackItems = buildProtocolFallbackItems({
      snapshot: context.hydratedSnapshot,
      query,
      limit
    });

    let items = asArray(sqlResult.items).slice(0, Math.max(1, Number(limit) || 6));
    let source = sqlResult.usedSqlite ? 'sqlite' : 'fallback_json';
    if (!items.length && fallbackItems.length) {
      items = fallbackItems;
      source = 'fallback_json';
    }

    const shouldBackfill = Boolean(
      context.dataFilePath
      && (
        !sqlResult.usedSqlite
        || sqlResult.tableStatus?.protocol_index_exists !== true
        || Number(sqlResult.tableStatus?.protocol_index_row_count || 0) === 0
      )
      && fallbackItems.length > 0
    );

    const backfilledSql = await maybeBackfillSqlIndex({
      shouldBackfill,
      dataFilePath: context.dataFilePath,
      fallbackDataFilePath: context.fallbackDataFilePath,
      snapshot: context.hydratedSnapshot
    });

    if (backfilledSql) {
      const rerun = await searchProtocolsSqlite({
        sqlitePath: context.sqlitePath,
        query,
        limit
      });
      if (asArray(rerun.items).length) {
        items = rerun.items.slice(0, Math.max(1, Number(limit) || 6));
        source = 'sqlite';
      }
    }

    return {
      items,
      usedSqlite: source.startsWith('sqlite'),
      source,
      backfilledSql
    };
  }

  async function searchNotebookEntriesIndex({
    dataFilePath = '',
    fallbackDataFilePath = '',
    query = '',
    limit = 6,
    snapshot = {}
  } = {}) {
    const context = await buildLookupContext({
      dataFilePath,
      fallbackDataFilePath,
      snapshot
    });
    const sqlResult = await searchNotebookSqlite({
      sqlitePath: context.sqlitePath,
      query,
      limit
    });
    const fallbackItems = buildNotebookFallbackItems({
      snapshot: context.hydratedSnapshot,
      query,
      limit
    });

    let items = asArray(sqlResult.items).slice(0, Math.max(1, Number(limit) || 6));
    let source = sqlResult.usedSqlite ? 'sqlite' : 'fallback_json';
    if (!items.length && fallbackItems.length) {
      items = fallbackItems;
      source = 'fallback_json';
    }

    const shouldBackfill = Boolean(
      context.dataFilePath
      && (
        !sqlResult.usedSqlite
        || sqlResult.tableStatus?.notebook_index_exists !== true
        || Number(sqlResult.tableStatus?.notebook_index_row_count || 0) === 0
      )
      && fallbackItems.length > 0
    );

    const backfilledSql = await maybeBackfillSqlIndex({
      shouldBackfill,
      dataFilePath: context.dataFilePath,
      fallbackDataFilePath: context.fallbackDataFilePath,
      snapshot: context.hydratedSnapshot
    });

    if (backfilledSql) {
      const rerun = await searchNotebookSqlite({
        sqlitePath: context.sqlitePath,
        query,
        limit
      });
      if (asArray(rerun.items).length) {
        items = rerun.items.slice(0, Math.max(1, Number(limit) || 6));
        source = 'sqlite';
      }
    }

    return {
      items,
      usedSqlite: source.startsWith('sqlite'),
      source,
      backfilledSql
    };
  }

  function deriveInventoryLookupQuery({ message = '', parserPayload = {} } = {}) {
    const parser = ensureObject(parserPayload);
    const entities = ensureObject(parser.entities);
    const inventorySearch = ensureObject(parser.inventory_search);
    return cleanText(
      inventorySearch.normalized_query
      || entities.inventory_item
      || entities.compound_name
      || entities.requested_output
      || message,
      300
    );
  }

  function deriveRecordLookupQuery({ message = '', parserPayload = {} } = {}) {
    const parser = ensureObject(parserPayload);
    const entities = ensureObject(parser.entities);
    return cleanText(
      entities.requested_output
      || entities.protocol_name
      || entities.project_name
      || entities.activity_type
      || message,
      300
    );
  }

  async function executeInventoryLookup({
    message = '',
    parserPayload = {},
    snapshot = {},
    dataFilePath = '',
    fallbackDataFilePath = '',
    limit = 8
  } = {}) {
    const parser = ensureObject(parserPayload);
    const query = deriveInventoryLookupQuery({ message, parserPayload: parser });
    const termsUsed = buildInventorySearchTerms({
      inventorySearch: ensureObject(parser.inventory_search),
      fallbackQuery: query,
      maxTerms: 10
    });

    const searchResult = await searchInventoryIndex({
      dataFilePath,
      fallbackDataFilePath,
      query,
      limit,
      searchTerms: termsUsed,
      snapshot
    });

    const items = asArray(searchResult.items).slice(0, Math.max(1, Number(limit) || 8));
    return {
      status: items.length ? 'matched' : 'no_match',
      query: cleanText(searchResult.query || query, 300),
      terms_used: uniqueStrings(searchResult.termsUsed || termsUsed, 10),
      source: cleanText(searchResult.source, 80) || 'fallback_json',
      backfilled_sql: searchResult.backfilledSql === true,
      items
    };
  }

  async function executeRecordLookup({
    message = '',
    parserPayload = {},
    snapshot = {},
    dataFilePath = '',
    fallbackDataFilePath = '',
    limit = 8
  } = {}) {
    const query = deriveRecordLookupQuery({ message, parserPayload });
    const parser = ensureObject(parserPayload);
    const entities = ensureObject(parser.entities);
    const terms = buildTerms({
      query,
      terms: [
        entities.project_name,
        entities.protocol_name,
        entities.workflow_step,
        entities.requested_output,
        entities.activity_type
      ],
      maxTerms: 10
    });

    const searchResult = await searchRecordIndex({
      dataFilePath,
      fallbackDataFilePath,
      query,
      limit,
      searchTerms: terms,
      snapshot
    });

    const items = asArray(searchResult.items).slice(0, Math.max(1, Number(limit) || 8));
    return {
      status: items.length ? 'matched' : 'no_match',
      query: cleanText(searchResult.query || query, 300),
      source: cleanText(searchResult.source, 80) || 'fallback_json',
      backfilled_sql: searchResult.backfilledSql === true,
      items
    };
  }

  const sharedLookupDeps = {
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
