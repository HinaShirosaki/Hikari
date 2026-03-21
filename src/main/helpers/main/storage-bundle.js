'use strict';

const fs = require('fs/promises');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SQLJS_WASM_JS_PATH = path.join(PROJECT_ROOT, 'vendor', 'sqljs', 'sql-wasm.js');

const PROTOCOL_SIDECAR_SCHEMA = 'enana_protocols';
const NOTEBOOK_SIDECAR_SCHEMA = 'enana_notebook_pages';
const SIDECAR_SCHEMA_VERSION = '1.0.0';
const STORAGE_MANIFEST_FILE_NAME = 'enana-storage-manifest.json';

let sqlJsInitPromise = null;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (!Number.isFinite(Number(maxLength)) || maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength);
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

function hasSupportedDataExtension(filePath) {
  return /\.(?:json|ena)$/i.test(String(filePath || '').trim());
}

function stripDataFileSuffix(filePath) {
  const raw = String(filePath || '');
  if (/\.ena\.json$/i.test(raw)) {
    return raw.replace(/\.ena\.json$/i, '');
  }
  if (/\.json$/i.test(raw)) {
    return raw.replace(/\.json$/i, '');
  }
  if (/\.ena$/i.test(raw)) {
    return raw.replace(/\.ena$/i, '');
  }
  return raw;
}

function resolveDataFilePath(dataFilePath, fallbackDataFilePath = '') {
  const preferred = cleanText(dataFilePath, 2400);
  const fallback = cleanText(fallbackDataFilePath, 2400);
  const candidate = preferred || fallback;
  if (!candidate) {
    return '';
  }
  if (hasSupportedDataExtension(candidate)) {
    return path.resolve(candidate);
  }
  return path.resolve(`${candidate}.json`);
}

function getBundlePaths({ dataFilePath, fallbackDataFilePath = '' } = {}) {
  const resolvedDataFilePath = resolveDataFilePath(dataFilePath, fallbackDataFilePath);
  if (!resolvedDataFilePath) {
    return {
      dataFilePath: '',
      basePath: '',
      protocolsPath: '',
      notebookPagesPath: '',
      sqlitePath: ''
    };
  }
  const basePath = stripDataFileSuffix(resolvedDataFilePath);
  return {
    dataFilePath: resolvedDataFilePath,
    basePath,
    protocolsPath: `${basePath}.protocols.json`,
    notebookPagesPath: `${basePath}.notebook-pages.json`,
    sqlitePath: `${basePath}.index.sqlite`
  };
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

function ensureObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function extractProtocolStepText(step) {
  if (typeof step === 'string') {
    return cleanText(step, 1200);
  }
  const source = ensureObject(step);
  return cleanText(source.text || source.instruction || source.action || source.title, 1200);
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

function applySqliteSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_chemicals (
      id TEXT PRIMARY KEY,
      name TEXT,
      amount TEXT,
      cas TEXT,
      location TEXT,
      supplier TEXT,
      search_text TEXT,
      raw_json TEXT
    );
    CREATE TABLE IF NOT EXISTS inventory_personal (
      zone TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT,
      quantity TEXT,
      location TEXT,
      search_text TEXT,
      raw_json TEXT,
      PRIMARY KEY (zone, id)
    );
    CREATE TABLE IF NOT EXISTS protocol_index (
      id TEXT PRIMARY KEY,
      name TEXT,
      category TEXT,
      description TEXT,
      tags_json TEXT,
      linked_project TEXT,
      step_count INTEGER,
      steps_preview_json TEXT,
      search_text TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS notebook_index (
      id TEXT PRIMARY KEY,
      protocol_id TEXT,
      protocol_name TEXT,
      project_id TEXT,
      project_name TEXT,
      result TEXT,
      updated_at TEXT,
      created_at TEXT,
      linked_refs_json TEXT,
      search_text TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_chemicals_search ON inventory_chemicals(search_text);
    CREATE INDEX IF NOT EXISTS idx_inventory_personal_search ON inventory_personal(search_text);
    CREATE INDEX IF NOT EXISTS idx_protocol_index_search ON protocol_index(search_text);
    CREATE INDEX IF NOT EXISTS idx_notebook_index_search ON notebook_index(search_text);
  `);
}

function readSqlRows(db, sql, values = []) {
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

function writeSqlInventoryChemicals(db, snapshot) {
  const chemicals = asArray(ensureObject(snapshot.labInventory).chemicals);
  chemicals.forEach((rawChemical, index) => {
    const chemical = ensureObject(rawChemical);
    const id = cleanText(chemical.id, 220) || `chemical_${index + 1}`;
    const name = cleanText(chemical.name, 320);
    const amount = cleanText(chemical.amountInStock || chemical.amount, 120);
    const cas = cleanText(chemical.casNumber || chemical.cas, 120);
    const location = cleanText(chemical.location || chemical.locationCode, 280);
    const supplier = cleanText(chemical.vendor || chemical.supplier, 240);
    const searchText = buildSearchText([
      id,
      name,
      amount,
      cas,
      location,
      supplier,
      chemical.catalogNumber,
      chemical.unitSize
    ]);
    db.run(
      `INSERT OR REPLACE INTO inventory_chemicals
        (id, name, amount, cas, location, supplier, search_text, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        amount,
        cas,
        location,
        supplier,
        searchText,
        JSON.stringify({
          ...chemical,
          amount,
          cas,
          supplier
        })
      ]
    );
  });
}

function writeSqlInventoryPersonal(db, snapshot) {
  const inventory = ensureObject(snapshot.inventory);
  Object.entries(inventory).forEach(([zoneName, rawContainers]) => {
    const zone = cleanText(zoneName, 200);
    asArray(rawContainers).forEach((rawContainer, index) => {
      const container = ensureObject(rawContainer);
      const id = cleanText(container.id, 220) || `${zone || 'zone'}_${index + 1}`;
      const name = cleanText(container.name, 320);
      const quantity = cleanText(container.quantity, 120);
      const location = cleanText(container.location, 240);
      const wellsSummary = asArray(container.wells)
        .map((well) => (typeof well === 'string' ? cleanText(well, 60) : cleanText(ensureObject(well).content, 60)))
        .filter(Boolean)
        .slice(0, 24)
        .join(' ');
      const searchText = buildSearchText([
        zone,
        id,
        name,
        quantity,
        location,
        container.type,
        container.singleContent,
        wellsSummary
      ]);
      db.run(
        `INSERT OR REPLACE INTO inventory_personal
          (zone, id, name, quantity, location, search_text, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          zone,
          id,
          name,
          quantity,
          location,
          searchText,
          JSON.stringify(container)
        ]
      );
    });
  });
}

function writeSqlProtocolIndex(db, snapshot, updatedAtDefault) {
  const protocols = asArray(snapshot.protocols);
  protocols.forEach((rawProtocol, index) => {
    const protocol = ensureObject(rawProtocol);
    const id = cleanText(protocol.id, 220) || `protocol_${index + 1}`;
    const name = cleanText(protocol.name, 320);
    const category = cleanText(protocol.category, 120);
    const description = cleanText(protocol.purpose || protocol.description, 4000);
    const tags = asArray(protocol.tags).map((value) => cleanText(value, 120)).filter(Boolean);
    const linkedProject = cleanText(protocol.linkedProject || protocol.projectName || protocol.projectId, 240);
    const steps = asArray(protocol.steps).map((step) => extractProtocolStepText(step)).filter(Boolean);
    const searchText = buildSearchText([
      id,
      name,
      category,
      description,
      linkedProject,
      tags.join(' '),
      asArray(protocol.materials).join(' '),
      steps.join(' '),
      asArray(protocol.troubleshooting)
        .map((row) => (typeof row === 'string' ? row : JSON.stringify(row)))
        .join(' ')
    ]);
    db.run(
      `INSERT OR REPLACE INTO protocol_index
        (id, name, category, description, tags_json, linked_project, step_count, steps_preview_json, search_text, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        category,
        description,
        JSON.stringify(tags),
        linkedProject,
        Math.max(0, steps.length),
        JSON.stringify(steps.slice(0, 80)),
        searchText,
        cleanText(protocol.updatedAt || protocol.createdAt, 80) || updatedAtDefault
      ]
    );
  });
}

function writeSqlNotebookIndex(db, snapshot, updatedAtDefault) {
  const notebookEntries = asArray(snapshot.notebookEntries);
  notebookEntries.forEach((rawEntry, index) => {
    const entry = ensureObject(rawEntry);
    const id = cleanText(entry.id, 220) || `notebook_${index + 1}`;
    const protocolId = cleanText(entry.protocolId, 220);
    const protocolName = cleanText(entry.protocolName, 320);
    const projectId = cleanText(entry.projectId, 220);
    const projectName = cleanText(entry.projectName, 320);
    const result = cleanText(entry.result, 12000);
    const updatedAt = cleanText(entry.updatedAt, 80) || updatedAtDefault;
    const createdAt = cleanText(entry.createdAt, 80);
    const linkedRefs = {
      assays: asArray(entry.assayIds || entry.assays).map((value) => cleanText(value, 120)).filter(Boolean),
      gels: asArray(entry.gelIds || entry.gels).map((value) => cleanText(value, 120)).filter(Boolean),
      files: asArray(entry.resultFiles || entry.resultFileAddresses).map((value) => cleanText(value, 240)).filter(Boolean)
    };
    const searchText = buildSearchText([
      id,
      protocolName,
      projectName,
      result,
      updatedAt,
      asArray(entry.resultFiles).join(' '),
      JSON.stringify(entry.values || {})
    ]);
    db.run(
      `INSERT OR REPLACE INTO notebook_index
        (id, protocol_id, protocol_name, project_id, project_name, result, updated_at, created_at, linked_refs_json, search_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        protocolId,
        protocolName,
        projectId,
        projectName,
        result,
        updatedAt,
        createdAt,
        JSON.stringify(linkedRefs),
        searchText
      ]
    );
  });
}

function writeSqlInventoryMeta(db, snapshot) {
  const labInventory = ensureObject(snapshot.labInventory);
  const metaRows = [
    ['lab_blocks', JSON.stringify(asArray(labInventory.blocks))],
    ['lab_last_location_number', JSON.stringify(Number(labInventory.lastLocationNumber) || 0)],
    ['lab_location_code_map', JSON.stringify(ensureObject(labInventory.locationCodeMap))],
    ['lab_location_code_next_by_location', JSON.stringify(ensureObject(labInventory.locationCodeNextByLocation))]
  ];
  metaRows.forEach(([key, valueJson]) => {
    db.run(
      'INSERT OR REPLACE INTO inventory_meta (key, value_json) VALUES (?, ?)',
      [key, valueJson]
    );
  });
}

async function writeSqliteBundleIndex(sqlitePath, snapshot) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  const updatedAtDefault = new Date().toISOString();
  try {
    applySqliteSchema(db);
    writeSqlInventoryChemicals(db, snapshot);
    writeSqlInventoryPersonal(db, snapshot);
    writeSqlProtocolIndex(db, snapshot, updatedAtDefault);
    writeSqlNotebookIndex(db, snapshot, updatedAtDefault);
    writeSqlInventoryMeta(db, snapshot);
    const bytes = db.export();
    await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
    await fs.writeFile(sqlitePath, Buffer.from(bytes));
  } finally {
    db.close();
  }
}

function readProtocolRowsFromSqlite(rows) {
  return asArray(rows).map((row, index) => {
    const source = ensureObject(row);
    const id = cleanText(source.id, 220) || `protocol_${index + 1}`;
    const name = cleanText(source.name, 320) || `Protocol ${index + 1}`;
    return {
      id,
      name,
      category: cleanText(source.category, 120),
      purpose: cleanText(source.description, 4000),
      materials: [],
      steps: parseJsonArray(source.steps_preview_json).map((step) => ({
        id: `${id}_step_${Math.random().toString(16).slice(2, 8)}`,
        text: cleanText(step, 1200),
        placeholders: []
      })),
      troubleshooting: [],
      tags: parseJsonArray(source.tags_json),
      linkedProject: cleanText(source.linked_project, 240),
      createdAt: cleanText(source.updated_at, 80),
      updatedAt: cleanText(source.updated_at, 80)
    };
  });
}

function readNotebookRowsFromSqlite(rows) {
  return asArray(rows).map((row, index) => {
    const source = ensureObject(row);
    return {
      id: cleanText(source.id, 220) || `notebook_${index + 1}`,
      protocolId: cleanText(source.protocol_id, 220),
      protocolName: cleanText(source.protocol_name, 320),
      projectId: cleanText(source.project_id, 220),
      projectName: cleanText(source.project_name, 320),
      result: cleanText(source.result, 12000),
      resultFiles: [],
      resultFileRecords: [],
      resultFileAddresses: [],
      updatedAt: cleanText(source.updated_at, 80),
      createdAt: cleanText(source.created_at, 80)
    };
  });
}

async function readSqliteBundleIndex(sqlitePath) {
  try {
    const bytes = await fs.readFile(sqlitePath);
    if (!bytes.length) {
      return {
        exists: true,
        inventoryChemicals: [],
        inventoryPersonal: [],
        protocolRows: [],
        notebookRows: [],
        inventoryMeta: {}
      };
    }
    const SQL = await loadSqlJs();
    const db = new SQL.Database(new Uint8Array(bytes));
    try {
      const inventoryChemicals = readSqlRows(db, 'SELECT * FROM inventory_chemicals', [])
        .map((row) => parseJsonObject(row.raw_json) || {
          id: cleanText(row.id, 220),
          name: cleanText(row.name, 320),
          amount: cleanText(row.amount, 120),
          cas: cleanText(row.cas, 120),
          location: cleanText(row.location, 280),
          supplier: cleanText(row.supplier, 240)
        });
      const inventoryPersonal = readSqlRows(db, 'SELECT * FROM inventory_personal', [])
        .map((row) => ({
          zone: cleanText(row.zone, 200),
          item: parseJsonObject(row.raw_json) || {
            id: cleanText(row.id, 220),
            name: cleanText(row.name, 320),
            quantity: cleanText(row.quantity, 120),
            location: cleanText(row.location, 240)
          }
        }));
      const protocolRows = readSqlRows(db, 'SELECT * FROM protocol_index', []);
      const notebookRows = readSqlRows(db, 'SELECT * FROM notebook_index', []);
      const inventoryMetaRows = readSqlRows(db, 'SELECT * FROM inventory_meta', []);
      const inventoryMeta = {};
      inventoryMetaRows.forEach((row) => {
        const key = cleanText(row.key, 220);
        if (!key) {
          return;
        }
        try {
          inventoryMeta[key] = JSON.parse(String(row.value_json || 'null'));
        } catch {
          inventoryMeta[key] = null;
        }
      });
      return {
        exists: true,
        inventoryChemicals,
        inventoryPersonal,
        protocolRows,
        notebookRows,
        inventoryMeta
      };
    } finally {
      db.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        inventoryChemicals: [],
        inventoryPersonal: [],
        protocolRows: [],
        notebookRows: [],
        inventoryMeta: {}
      };
    }
    throw error;
  }
}

function buildProtocolsSidecar(snapshot, updatedAt) {
  return {
    schema_name: PROTOCOL_SIDECAR_SCHEMA,
    schema_version: SIDECAR_SCHEMA_VERSION,
    updated_at: updatedAt,
    protocols: asArray(snapshot.protocols)
  };
}

function buildNotebookPagesSidecar(snapshot, updatedAt) {
  return {
    schema_name: NOTEBOOK_SIDECAR_SCHEMA,
    schema_version: SIDECAR_SCHEMA_VERSION,
    updated_at: updatedAt,
    notebookPages: asArray(snapshot.notebookEntries)
  };
}

async function syncBundleFromSnapshot({
  dataFilePath,
  snapshot,
  fallbackDataFilePath = ''
} = {}) {
  const bundlePaths = getBundlePaths({ dataFilePath, fallbackDataFilePath });
  if (!bundlePaths.dataFilePath) {
    return {
      bundlePaths,
      sidecarPaths: {}
    };
  }
  const updatedAt = new Date().toISOString();
  const safeSnapshot = ensureObject(snapshot);
  await fs.mkdir(path.dirname(bundlePaths.dataFilePath), { recursive: true });
  await fs.writeFile(
    bundlePaths.protocolsPath,
    JSON.stringify(buildProtocolsSidecar(safeSnapshot, updatedAt), null, 2),
    'utf8'
  );
  await fs.writeFile(
    bundlePaths.notebookPagesPath,
    JSON.stringify(buildNotebookPagesSidecar(safeSnapshot, updatedAt), null, 2),
    'utf8'
  );
  await writeSqliteBundleIndex(bundlePaths.sqlitePath, safeSnapshot);
  return {
    bundlePaths,
    sidecarPaths: {
      protocolsPath: bundlePaths.protocolsPath,
      notebookPagesPath: bundlePaths.notebookPagesPath
    }
  };
}

function hydrateInventoryFromSqliteSnapshot(nextSnapshot, sqliteData) {
  const inventoryPersonalMap = {};
  asArray(sqliteData.inventoryPersonal).forEach((row) => {
    const zone = cleanText(row.zone, 200);
    if (!zone) {
      return;
    }
    if (!inventoryPersonalMap[zone]) {
      inventoryPersonalMap[zone] = [];
    }
    inventoryPersonalMap[zone].push(row.item);
  });

  const hasSqlChemicals = asArray(sqliteData.inventoryChemicals).length > 0;
  const hasSqlPersonal = Object.keys(inventoryPersonalMap).length > 0;
  const hasSqlMeta = Object.keys(ensureObject(sqliteData.inventoryMeta)).length > 0;
  if (!hasSqlChemicals && !hasSqlPersonal && !hasSqlMeta) {
    return false;
  }

  const existingLabInventory = ensureObject(nextSnapshot.labInventory);
  nextSnapshot.labInventory = {
    ...existingLabInventory,
    chemicals: hasSqlChemicals
      ? asArray(sqliteData.inventoryChemicals)
      : asArray(existingLabInventory.chemicals),
    blocks: Array.isArray(sqliteData.inventoryMeta?.lab_blocks)
      ? sqliteData.inventoryMeta.lab_blocks
      : asArray(existingLabInventory.blocks),
    lastLocationNumber: Number(sqliteData.inventoryMeta?.lab_last_location_number)
      || Number(existingLabInventory.lastLocationNumber)
      || 0,
    locationCodeMap: ensureObject(sqliteData.inventoryMeta?.lab_location_code_map),
    locationCodeNextByLocation: ensureObject(sqliteData.inventoryMeta?.lab_location_code_next_by_location)
  };

  if (hasSqlPersonal) {
    nextSnapshot.inventory = inventoryPersonalMap;
  }

  return true;
}

function hydrateFromLegacyChemicals(nextSnapshot, legacyChemicals) {
  const source = asArray(legacyChemicals);
  if (!source.length) {
    return false;
  }
  const currentLabInventory = ensureObject(nextSnapshot.labInventory);
  if (asArray(currentLabInventory.chemicals).length > 0) {
    return false;
  }
  nextSnapshot.labInventory = {
    ...currentLabInventory,
    chemicals: source
  };
  return true;
}

function readProtocolsFromSidecar(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  return asArray(payload.protocols);
}

function readNotebookEntriesFromSidecar(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  return asArray(payload.notebookPages);
}

async function hydrateSnapshotFromBundle({
  dataFilePath,
  snapshot,
  fallbackDataFilePath = '',
  legacyChemicalsPath = ''
} = {}) {
  const bundlePaths = getBundlePaths({ dataFilePath, fallbackDataFilePath });
  const sourceSnapshot = cloneJson(snapshot, {});
  const nextSnapshot = cloneJson(sourceSnapshot, {});
  const migration = {
    applied: [],
    warnings: []
  };

  if (!bundlePaths.dataFilePath) {
    return {
      snapshot: nextSnapshot,
      bundlePaths,
      sidecarPaths: {},
      migration: null
    };
  }

  const protocolSidecar = await readJsonFile(bundlePaths.protocolsPath);
  if (protocolSidecar.ok) {
    nextSnapshot.protocols = readProtocolsFromSidecar(protocolSidecar.data);
    migration.applied.push('protocol_sidecar');
  } else if (protocolSidecar.exists && protocolSidecar.error) {
    migration.warnings.push(protocolSidecar.error);
  }

  const notebookSidecar = await readJsonFile(bundlePaths.notebookPagesPath);
  if (notebookSidecar.ok) {
    nextSnapshot.notebookEntries = readNotebookEntriesFromSidecar(notebookSidecar.data);
    migration.applied.push('notebook_sidecar');
  } else if (notebookSidecar.exists && notebookSidecar.error) {
    migration.warnings.push(notebookSidecar.error);
  }

  const sqliteData = await readSqliteBundleIndex(bundlePaths.sqlitePath);
  if (sqliteData.exists) {
    const hydratedInventory = hydrateInventoryFromSqliteSnapshot(nextSnapshot, sqliteData);
    if (hydratedInventory) {
      migration.applied.push('inventory_sqlite');
    }
    if ((!Array.isArray(nextSnapshot.protocols) || !nextSnapshot.protocols.length) && asArray(sqliteData.protocolRows).length) {
      nextSnapshot.protocols = readProtocolRowsFromSqlite(sqliteData.protocolRows);
      migration.applied.push('protocol_sqlite_fallback');
    }
    if ((!Array.isArray(nextSnapshot.notebookEntries) || !nextSnapshot.notebookEntries.length) && asArray(sqliteData.notebookRows).length) {
      nextSnapshot.notebookEntries = readNotebookRowsFromSqlite(sqliteData.notebookRows);
      migration.applied.push('notebook_sqlite_fallback');
    }
  }

  if (legacyChemicalsPath) {
    try {
      const legacyRaw = await fs.readFile(legacyChemicalsPath, 'utf8');
      const legacyPayload = JSON.parse(legacyRaw);
      const hydratedLegacy = hydrateFromLegacyChemicals(nextSnapshot, legacyPayload);
      if (hydratedLegacy) {
        migration.applied.push('legacy_chemicals_fallback');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        migration.warnings.push(String(error?.message || error));
      }
    }
  }

  return {
    snapshot: nextSnapshot,
    bundlePaths,
    sidecarPaths: {
      protocolsPath: bundlePaths.protocolsPath,
      notebookPagesPath: bundlePaths.notebookPagesPath
    },
    migration: migration.applied.length || migration.warnings.length ? migration : null
  };
}

function isBundleCandidateName(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (!lower || lower === STORAGE_MANIFEST_FILE_NAME.toLowerCase()) {
    return false;
  }
  if (lower.endsWith('.index.sqlite')) {
    return false;
  }
  return hasSupportedDataExtension(lower);
}

function looksLikeEnanaSnapshot(payload) {
  const source = ensureObject(payload);
  return [
    Array.isArray(source.protocols),
    Array.isArray(source.notebookEntries),
    source.settings && typeof source.settings === 'object',
    source.data_bundle && typeof source.data_bundle === 'object',
    source.labInventory && typeof source.labInventory === 'object',
    source.inventory && typeof source.inventory === 'object',
    Array.isArray(source.members),
    Array.isArray(source.projects)
  ].some(Boolean);
}

function toPosixRelative(rootPath, targetPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join('/');
}

async function buildEntryMeta(rootPath, absPath, role = 'other') {
  try {
    const stat = await fs.stat(absPath);
    const isDirectory = stat.isDirectory();
    return {
      relative_path: toPosixRelative(rootPath, absPath) || '.',
      type: isDirectory ? 'directory' : 'file',
      role,
      size_bytes: isDirectory ? 0 : Math.max(0, Number(stat.size) || 0),
      modified_at: normalizeFileTimestamp(stat)
    };
  } catch {
    return null;
  }
}

function detectManifestRole(relativePath) {
  const normalized = String(relativePath || '').toLowerCase();
  if (!normalized || normalized === '.') {
    return 'root';
  }
  if (normalized === STORAGE_MANIFEST_FILE_NAME.toLowerCase()) {
    return 'storage_manifest';
  }
  if (normalized.endsWith('.protocols.json')) {
    return 'protocol_sidecar';
  }
  if (normalized.endsWith('.notebook-pages.json')) {
    return 'notebook_sidecar';
  }
  if (normalized.endsWith('.index.sqlite')) {
    return 'sqlite_index';
  }
  if (normalized === 'sequenceviewer/sequence-library.sqlite') {
    return 'sequence_library_index';
  }
  if (normalized.startsWith('sequenceviewer/entries/')) {
    return 'sequence_entry_file';
  }
  if (hasSupportedDataExtension(normalized)) {
    return 'data_file';
  }
  return 'other';
}

async function collectManifestEntries(rootPath, maxDepth = 3) {
  const rows = [];
  async function walk(currentPath, depth) {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = path.join(currentPath, entry.name);
      const relativePath = toPosixRelative(rootPath, absPath);
      const role = detectManifestRole(relativePath);
      const meta = await buildEntryMeta(rootPath, absPath, role);
      if (meta) {
        rows.push(meta);
      }
      if (entry.isDirectory() && depth < maxDepth) {
        await walk(absPath, depth + 1);
      }
    }
  }
  await walk(rootPath, 0);
  rows.sort((left, right) => String(left.relative_path || '').localeCompare(String(right.relative_path || '')));
  return rows;
}

function mergeByIdMap(targetMap, records, fallbackPrefix) {
  asArray(records).forEach((rawRecord, index) => {
    const record = ensureObject(rawRecord);
    const id = cleanText(record.id, 220) || `${fallbackPrefix}_${index + 1}`;
    targetMap.set(id, {
      ...record,
      id
    });
  });
}

function mergeInventoryMap(targetInventoryMap, inventoryPayload) {
  const source = ensureObject(inventoryPayload);
  Object.entries(source).forEach(([zoneName, rawContainers]) => {
    const zone = cleanText(zoneName, 220);
    if (!zone) {
      return;
    }
    if (!targetInventoryMap.has(zone)) {
      targetInventoryMap.set(zone, new Map());
    }
    const zoneMap = targetInventoryMap.get(zone);
    asArray(rawContainers).forEach((rawContainer, index) => {
      const container = ensureObject(rawContainer);
      const id = cleanText(container.id, 220) || `${zone}_${index + 1}`;
      zoneMap.set(id, {
        ...container,
        id
      });
    });
  });
}

function normalizeBundleSummary(snapshot) {
  const source = ensureObject(snapshot);
  const labInventory = ensureObject(source.labInventory);
  let personalContainerCount = 0;
  Object.values(ensureObject(source.inventory)).forEach((containers) => {
    personalContainerCount += asArray(containers).length;
  });
  return {
    protocols: asArray(source.protocols).length,
    notebookEntries: asArray(source.notebookEntries).length,
    chemicals: asArray(labInventory.chemicals).length,
    personalInventoryContainers: personalContainerCount
  };
}

async function summarizeSequenceLibrary(storagePath) {
  const sequenceDbPath = path.join(storagePath, 'SequenceViewer', 'sequence-library.sqlite');
  const summary = {
    exists: false,
    path: sequenceDbPath,
    entryCount: 0,
    statusCounts: {
      saved: 0,
      temporary: 0
    }
  };
  try {
    const bytes = await fs.readFile(sequenceDbPath);
    if (!bytes.length) {
      return summary;
    }
    const SQL = await loadSqlJs();
    const db = new SQL.Database(new Uint8Array(bytes));
    try {
      summary.exists = true;
      const countRows = readSqlRows(db, 'SELECT COUNT(*) AS count FROM sequence_entries', []);
      summary.entryCount = Math.max(0, Number(countRows[0]?.count) || 0);
      const statusRows = readSqlRows(
        db,
        'SELECT status, COUNT(*) AS count FROM sequence_entries GROUP BY status',
        []
      );
      statusRows.forEach((row) => {
        const status = cleanText(row.status, 80).toLowerCase();
        if (status === 'saved' || status === 'temporary') {
          summary.statusCounts[status] = Math.max(0, Number(row.count) || 0);
        }
      });
      return summary;
    } finally {
      db.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return summary;
    }
    throw error;
  }
}

async function importStorageRoot({ storagePath = '' } = {}) {
  const resolvedStoragePath = path.resolve(cleanText(storagePath, 2400));
  if (!resolvedStoragePath) {
    throw new Error('Missing storage path.');
  }
  const storageStat = await fs.stat(resolvedStoragePath);
  if (!storageStat.isDirectory()) {
    throw new Error('Storage path must be a directory.');
  }

  const warnings = [];
  const dirEntries = await fs.readdir(resolvedStoragePath, { withFileTypes: true });
  const candidateFiles = [];

  for (const entry of dirEntries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!isBundleCandidateName(entry.name)) {
      continue;
    }
    const absPath = path.join(resolvedStoragePath, entry.name);
    const stat = await fs.stat(absPath);
    candidateFiles.push({
      path: absPath,
      modifiedAt: Number(stat.mtimeMs) || 0
    });
  }

  candidateFiles.sort((left, right) => left.modifiedAt - right.modifiedAt);

  const protocolMap = new Map();
  const notebookMap = new Map();
  const chemicalMap = new Map();
  const inventoryZoneMap = new Map();
  const blockMap = new Map();
  let lastLocationNumber = 0;
  let locationCodeMap = {};
  let locationCodeNextByLocation = {};
  const bundleSummaries = [];

  for (const candidate of candidateFiles) {
    const candidatePath = candidate.path;
    let parsed = null;
    try {
      const raw = await fs.readFile(candidatePath, 'utf8');
      parsed = parseJsonObject(raw);
    } catch (error) {
      warnings.push(`Failed to read ${toPosixRelative(resolvedStoragePath, candidatePath)}: ${String(error?.message || error)}`);
      continue;
    }

    if (!parsed) {
      warnings.push(`Skipped ${toPosixRelative(resolvedStoragePath, candidatePath)} because JSON payload is invalid.`);
      continue;
    }

    const bundlePaths = getBundlePaths({ dataFilePath: candidatePath });
    const sidecarExists = await Promise.all([
      fs.access(bundlePaths.protocolsPath).then(() => true).catch(() => false),
      fs.access(bundlePaths.notebookPagesPath).then(() => true).catch(() => false),
      fs.access(bundlePaths.sqlitePath).then(() => true).catch(() => false)
    ]);

    if (!looksLikeEnanaSnapshot(parsed) && !sidecarExists.some(Boolean)) {
      continue;
    }

    const hydrated = await hydrateSnapshotFromBundle({
      dataFilePath: candidatePath,
      snapshot: parsed
    });
    const hydratedSnapshot = ensureObject(hydrated.snapshot);
    const summary = normalizeBundleSummary(hydratedSnapshot);
    mergeByIdMap(protocolMap, hydratedSnapshot.protocols, 'protocol');
    mergeByIdMap(notebookMap, hydratedSnapshot.notebookEntries, 'notebook');
    mergeByIdMap(chemicalMap, ensureObject(hydratedSnapshot.labInventory).chemicals, 'chemical');
    mergeInventoryMap(inventoryZoneMap, hydratedSnapshot.inventory);

    asArray(ensureObject(hydratedSnapshot.labInventory).blocks).forEach((block, index) => {
      const normalizedBlock = ensureObject(block);
      const blockKey = cleanText(normalizedBlock.hash, 240)
        || `${cleanText(normalizedBlock.index, 40)}_${cleanText(normalizedBlock.timestamp, 120)}_${index}`;
      blockMap.set(blockKey, normalizedBlock);
    });
    lastLocationNumber = Math.max(
      lastLocationNumber,
      Number(ensureObject(hydratedSnapshot.labInventory).lastLocationNumber) || 0
    );
    locationCodeMap = {
      ...locationCodeMap,
      ...ensureObject(ensureObject(hydratedSnapshot.labInventory).locationCodeMap)
    };
    locationCodeNextByLocation = {
      ...locationCodeNextByLocation,
      ...ensureObject(ensureObject(hydratedSnapshot.labInventory).locationCodeNextByLocation)
    };

    bundleSummaries.push({
      data_file_path: toPosixRelative(resolvedStoragePath, candidatePath),
      bundle_paths: {
        protocols_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.protocolsPath),
        notebook_pages_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.notebookPagesPath),
        sqlite_path: toPosixRelative(resolvedStoragePath, hydrated.bundlePaths.sqlitePath)
      },
      counts: summary,
      migration: hydrated.migration || null
    });
  }

  const mergedInventory = {};
  for (const [zone, zoneMap] of inventoryZoneMap.entries()) {
    mergedInventory[zone] = [...zoneMap.values()];
  }

  const mergedBlocks = [...blockMap.values()].sort((left, right) => {
    const leftIndex = Number(left.index) || 0;
    const rightIndex = Number(right.index) || 0;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return String(left.timestamp || '').localeCompare(String(right.timestamp || ''));
  });

  const statePatch = {
    protocols: [...protocolMap.values()],
    notebookEntries: [...notebookMap.values()],
    labInventory: {
      chemicals: [...chemicalMap.values()],
      blocks: mergedBlocks,
      lastLocationNumber,
      locationCodeMap,
      locationCodeNextByLocation
    },
    inventory: mergedInventory
  };

  const sequenceLibrary = await summarizeSequenceLibrary(resolvedStoragePath);
  const summary = {
    bundles: bundleSummaries.length,
    protocols: statePatch.protocols.length,
    notebookEntries: statePatch.notebookEntries.length,
    chemicals: statePatch.labInventory.chemicals.length,
    personalInventoryContainers: Object.values(statePatch.inventory)
      .reduce((sum, list) => sum + asArray(list).length, 0),
    sequenceEntries: Number(sequenceLibrary.entryCount) || 0
  };

  const discoveredFiles = await collectManifestEntries(resolvedStoragePath, 3);
  const manifest = {
    schema_name: 'enana_storage_manifest',
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    root_path: resolvedStoragePath,
    discovered_files: discoveredFiles,
    bundles: bundleSummaries,
    sequence_library: {
      relative_path: toPosixRelative(resolvedStoragePath, sequenceLibrary.path),
      exists: sequenceLibrary.exists,
      entry_count: sequenceLibrary.entryCount,
      status_counts: sequenceLibrary.statusCounts
    },
    summary,
    warnings
  };
  const manifestPath = path.join(resolvedStoragePath, STORAGE_MANIFEST_FILE_NAME);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return {
    statePatch,
    summary,
    manifestPath,
    warnings,
    bundles: bundleSummaries,
    sequenceLibrary
  };
}

module.exports = {
  STORAGE_MANIFEST_FILE_NAME,
  getBundlePaths,
  syncBundleFromSnapshot,
  hydrateSnapshotFromBundle,
  importStorageRoot
};
