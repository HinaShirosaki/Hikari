const fs = require('fs/promises');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const { normalizeDataFilePath } = require('../../lib/main-utils');

const SQLJS_WASM_JS_PATH = path.join(PROJECT_ROOT, 'vendor', 'sqljs', 'sql-wasm.js');
const LEGACY_PROTOCOLS_FILE_NAME = 'protocols.json';
const LEGACY_NOTEBOOK_FILE_NAME = 'notebook-pages.json';
const PROTOCOLS_SCHEMA_NAME = 'enana_protocols';
const NOTEBOOK_SCHEMA_NAME = 'enana_notebook_pages';

let sqlJsInitPromise = null;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 500) {
  const text = String(value == null ? '' : value).trim();
  if (!text) {
    return '';
  }
  if (!Number.isFinite(Number(maxLength)) || maxLength <= 0) {
    return text;
  }
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.max(min, Math.min(max, numeric));
}

function safeParseJson(text, fallback = null) {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return fallback;
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function uniqueStrings(values, max = 30) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 220);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  if (Number.isFinite(Number(max)) && max > 0) {
    return out.slice(0, max);
  }
  return out;
}

function stripSupportedDataExtension(fileName) {
  const raw = cleanText(fileName, 260);
  const lower = raw.toLowerCase();
  if (lower.endsWith('.ena.json')) {
    return raw.slice(0, -'.ena.json'.length);
  }
  if (lower.endsWith('.json')) {
    return raw.slice(0, -'.json'.length);
  }
  if (lower.endsWith('.ena')) {
    return raw.slice(0, -'.ena'.length);
  }
  return raw;
}

function getBundlePaths({ dataFilePath, fallbackDataFilePath = '' } = {}) {
  const normalizedDataPath = normalizeDataFilePath(dataFilePath, fallbackDataFilePath);
  const effectiveDataPath = normalizedDataPath || normalizeDataFilePath(fallbackDataFilePath, '');
  const baseDir = effectiveDataPath ? path.dirname(effectiveDataPath) : process.cwd();
  const dataFileName = effectiveDataPath ? path.basename(effectiveDataPath) : 'enana-data.json';
  const baseName = stripSupportedDataExtension(dataFileName) || 'enana-data';
  return {
    dataFilePath: effectiveDataPath,
    baseDir,
    baseName,
    sqlitePath: path.join(baseDir, `${baseName}.index.sqlite`),
    protocolsPath: path.join(baseDir, `${baseName}.protocols.json`),
    notebookPagesPath: path.join(baseDir, `${baseName}.notebook-pages.json`),
    legacyProtocolsPath: path.join(baseDir, LEGACY_PROTOCOLS_FILE_NAME),
    legacyNotebookPagesPath: path.join(baseDir, LEGACY_NOTEBOOK_FILE_NAME)
  };
}

async function readJsonFileIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function normalizeChemicalStorePayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const locationCodeMap = source.locationCodeMap && typeof source.locationCodeMap === 'object'
    ? Object.fromEntries(
      Object.entries(source.locationCodeMap)
        .map(([key, value]) => [cleanText(key, 240).toLowerCase(), cleanText(value, 32).toUpperCase()])
        .filter(([key, value]) => key && value)
    )
    : {};
  const locationCodeNextByLocation = source.locationCodeNextByLocation && typeof source.locationCodeNextByLocation === 'object'
    ? Object.fromEntries(
      Object.entries(source.locationCodeNextByLocation)
        .map(([key, value]) => [cleanText(key, 240).toLowerCase(), Number(value) || 0])
        .filter(([key, value]) => key && value > 0)
    )
    : {};
  return {
    chemicals: asArray(source.chemicals).filter((item) => item && typeof item === 'object'),
    blocks: asArray(source.blocks),
    lastLocationNumber: Number(source.lastLocationNumber) || 0,
    locationCodeMap,
    locationCodeNextByLocation
  };
}

function extractNotebookResultFileAddresses(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const addresses = [];

  asArray(source.resultFileRecords).forEach((record) => {
    const filePath = cleanText(record?.path, 1600);
    if (filePath) {
      addresses.push(filePath);
    }
  });

  const storageFolder = cleanText(source.storageFolder, 800);
  if (storageFolder && !addresses.length) {
    asArray(source.resultFiles).forEach((name) => {
      const fileName = cleanText(name, 240);
      if (!fileName) {
        return;
      }
      addresses.push(path.join(storageFolder, 'ResultFiles', fileName));
    });
  }

  return uniqueStrings(addresses, 80);
}

function normalizeNotebookPageEntry(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const existingAddresses = asArray(source.resultFileAddresses)
    .map((item) => cleanText(item, 1600))
    .filter(Boolean);
  const derivedAddresses = extractNotebookResultFileAddresses(source);
  return {
    ...source,
    resultFileAddresses: uniqueStrings(existingAddresses.concat(derivedAddresses), 120)
  };
}

function normalizeProtocolsPayload(payload) {
  if (Array.isArray(payload)) {
    return { protocols: asArray(payload) };
  }
  const source = payload && typeof payload === 'object' ? payload : {};
  return { protocols: asArray(source.protocols) };
}

function normalizeNotebookPagesPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const pages = Array.isArray(payload) ? asArray(payload) : asArray(source.notebookPages);
  return {
    notebookPages: pages
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => normalizeNotebookPageEntry(entry))
  };
}

function mergeProtocolsAndNotebookIntoSnapshot(snapshot, sidecars = {}) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const snapshotProtocols = asArray(source.protocols);
  const snapshotNotebook = asArray(source.notebookEntries).map((entry) => normalizeNotebookPageEntry(entry));
  const protocols = sidecars?.protocols?.hasData ? sidecars.protocols.protocols : snapshotProtocols;
  const notebookPages = sidecars?.notebookPages?.hasData ? sidecars.notebookPages.notebookPages : snapshotNotebook;
  return {
    ...source,
    protocols,
    notebookEntries: notebookPages
  };
}

function normalizePersonalInventorySections(rawInventory) {
  if (Array.isArray(rawInventory)) {
    return asArray(rawInventory).map((section) => ({
      zone: cleanText(section?.zone, 80),
      items: asArray(section?.items).filter((item) => item && typeof item === 'object')
    })).filter((section) => section.zone || section.items.length);
  }

  if (!rawInventory || typeof rawInventory !== 'object') {
    return [];
  }

  if (Array.isArray(rawInventory.personal)) {
    return normalizePersonalInventorySections(rawInventory.personal);
  }

  if (rawInventory.personal && typeof rawInventory.personal === 'object') {
    return normalizePersonalInventorySections(rawInventory.personal);
  }

  return Object.entries(rawInventory).map(([zone, items]) => ({
    zone: cleanText(zone, 80),
    items: asArray(items).filter((item) => item && typeof item === 'object')
  })).filter((section) => section.zone || section.items.length);
}

function mergeInventoryIntoSnapshot(snapshot, inventoryPayload) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const inventory = inventoryPayload && typeof inventoryPayload === 'object' ? inventoryPayload : {};
  const labInventory = normalizeChemicalStorePayload(inventory.labInventory || {});
  const personalSections = normalizePersonalInventorySections(inventory.personalInventory || {});
  const groupedPersonal = {};
  personalSections.forEach((section) => {
    const zone = cleanText(section.zone, 80) || 'Unspecified';
    groupedPersonal[zone] = asArray(section.items);
  });

  return {
    ...source,
    labInventory,
    inventory: groupedPersonal
  };
}

async function readProtocolsSidecar(bundlePaths) {
  const primaryPayload = await readJsonFileIfExists(bundlePaths.protocolsPath);
  if (primaryPayload) {
    const normalized = normalizeProtocolsPayload(primaryPayload);
    return {
      hasData: true,
      filePath: bundlePaths.protocolsPath,
      fromLegacyPath: false,
      protocols: normalized.protocols
    };
  }

  const legacyPayload = await readJsonFileIfExists(bundlePaths.legacyProtocolsPath);
  if (legacyPayload) {
    const normalized = normalizeProtocolsPayload(legacyPayload);
    return {
      hasData: true,
      filePath: bundlePaths.legacyProtocolsPath,
      fromLegacyPath: true,
      protocols: normalized.protocols
    };
  }

  return {
    hasData: false,
    filePath: '',
    fromLegacyPath: false,
    protocols: []
  };
}

async function readNotebookPagesSidecar(bundlePaths) {
  const primaryPayload = await readJsonFileIfExists(bundlePaths.notebookPagesPath);
  if (primaryPayload) {
    const normalized = normalizeNotebookPagesPayload(primaryPayload);
    return {
      hasData: true,
      filePath: bundlePaths.notebookPagesPath,
      fromLegacyPath: false,
      notebookPages: normalized.notebookPages
    };
  }

  const legacyPayload = await readJsonFileIfExists(bundlePaths.legacyNotebookPagesPath);
  if (legacyPayload) {
    const normalized = normalizeNotebookPagesPayload(legacyPayload);
    return {
      hasData: true,
      filePath: bundlePaths.legacyNotebookPagesPath,
      fromLegacyPath: true,
      notebookPages: normalized.notebookPages
    };
  }

  return {
    hasData: false,
    filePath: '',
    fromLegacyPath: false,
    notebookPages: []
  };
}

async function writeProtocolsSidecar(protocolsPath, protocols) {
  const payload = {
    schema_name: PROTOCOLS_SCHEMA_NAME,
    schema_version: '1.0.0',
    updated_at: new Date().toISOString(),
    protocols: asArray(protocols)
  };
  await fs.mkdir(path.dirname(protocolsPath), { recursive: true });
  await fs.writeFile(protocolsPath, JSON.stringify(payload, null, 2), 'utf8');
}

async function writeNotebookPagesSidecar(notebookPagesPath, notebookEntries) {
  const payload = {
    schema_name: NOTEBOOK_SCHEMA_NAME,
    schema_version: '1.0.0',
    updated_at: new Date().toISOString(),
    notebookPages: asArray(notebookEntries).map((entry) => normalizeNotebookPageEntry(entry))
  };
  await fs.mkdir(path.dirname(notebookPagesPath), { recursive: true });
  await fs.writeFile(notebookPagesPath, JSON.stringify(payload, null, 2), 'utf8');
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

function applySchema(db) {
  db.run(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
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

async function openIndexedDatabase(sqlitePath) {
  const SQL = await loadSqlJs();
  let db;
  let existed = false;
  try {
    const bytes = await fs.readFile(sqlitePath);
    if (bytes.length > 0) {
      db = new SQL.Database(new Uint8Array(bytes));
      existed = true;
    } else {
      db = new SQL.Database();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      db = new SQL.Database();
    } else {
      throw error;
    }
  }

  applySchema(db);
  return { db, existed };
}

async function persistIndexedDatabase(sqlitePath, db) {
  const bytes = db.export();
  await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
  await fs.writeFile(sqlitePath, Buffer.from(bytes));
}

function buildProtocolStepPreview(protocol, maxSteps = 8) {
  const source = protocol && typeof protocol === 'object' ? protocol : {};
  return asArray(source.steps).map((step) => {
    if (typeof step === 'string') {
      return cleanText(step, 260);
    }
    return cleanText(step?.text || step?.instruction || step?.title || step?.name, 260);
  }).filter(Boolean).slice(0, maxSteps);
}

function buildProtocolSearchText(protocol) {
  const source = protocol && typeof protocol === 'object' ? protocol : {};
  const tags = asArray(source.tags).map((tag) => cleanText(tag, 120)).filter(Boolean);
  const previewSteps = buildProtocolStepPreview(source, 10);
  const text = [
    cleanText(source.name, 220),
    cleanText(source.category, 120),
    cleanText(source.description, 500),
    cleanText(source.linkedProjectName || source.projectName, 200),
    tags.join(' '),
    previewSteps.join(' ')
  ].join(' ').toLowerCase();
  return cleanText(text, 2500);
}

function buildNotebookSearchText(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const valuesText = source.values && typeof source.values === 'object'
    ? Object.entries(source.values).map(([key, value]) => `${cleanText(key, 120)} ${cleanText(value, 220)}`).join(' ')
    : '';
  const text = [
    cleanText(source.protocolName, 220),
    cleanText(source.result, 800),
    cleanText(source.projectName, 220),
    cleanText(source.updatedAt, 120),
    valuesText,
    asArray(source.resultFiles).map((item) => cleanText(item, 220)).join(' ')
  ].join(' ').toLowerCase();
  return cleanText(text, 3000);
}

function buildChemicalSearchText(item) {
  const source = item && typeof item === 'object' ? item : {};
  return cleanText([
    cleanText(source.name, 220),
    cleanText(source.cas || source.casNumber, 120),
    cleanText(source.locationLabel || source.location, 220),
    cleanText(source.supplier || source.vendor, 220),
    cleanText(source.catalogNo, 120),
    cleanText(source.amount, 120),
    cleanText(source.notes, 500)
  ].join(' ').toLowerCase(), 3200);
}

function buildPersonalSearchText(zone, item) {
  const source = item && typeof item === 'object' ? item : {};
  return cleanText([
    cleanText(zone, 80),
    cleanText(source.id, 120),
    cleanText(source.name || source.itemName, 220),
    cleanText(source.quantity || source.amount, 120),
    cleanText(source.location || source.position, 220),
    cleanText(source.sampleType || source.type, 120),
    cleanText(source.notes, 500)
  ].join(' ').toLowerCase(), 2600);
}

function replaceInventoryTables(db, snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const labInventory = normalizeChemicalStorePayload(source.labInventory || {});
  const personalSections = normalizePersonalInventorySections(source.inventory || {});

  db.run('BEGIN TRANSACTION');
  try {
    db.run('DELETE FROM inventory_meta');
    db.run('DELETE FROM inventory_chemicals');
    db.run('DELETE FROM inventory_personal');

    const chemStmt = db.prepare(`
      INSERT INTO inventory_chemicals (
        id, name, amount, cas, location, supplier, search_text, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    labInventory.chemicals.forEach((item, index) => {
      const chemical = item && typeof item === 'object' ? item : {};
      const id = cleanText(chemical.id, 120) || `chemical-${index + 1}`;
      chemStmt.run([
        id,
        cleanText(chemical.name, 220),
        cleanText(chemical.amount, 120),
        cleanText(chemical.cas || chemical.casNumber, 120),
        cleanText(chemical.locationLabel || chemical.location, 220),
        cleanText(chemical.supplier || chemical.vendor, 220),
        buildChemicalSearchText(chemical),
        JSON.stringify(chemical)
      ]);
    });
    chemStmt.free();

    const personalStmt = db.prepare(`
      INSERT INTO inventory_personal (
        zone, id, name, quantity, location, search_text, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    personalSections.forEach((section) => {
      const zone = cleanText(section.zone, 80) || 'Unspecified';
      asArray(section.items).forEach((item, index) => {
        const inventoryItem = item && typeof item === 'object' ? item : {};
        const id = cleanText(inventoryItem.id, 120)
          || cleanText(inventoryItem.name || inventoryItem.itemName, 120)
          || `item-${index + 1}`;
        personalStmt.run([
          zone,
          id,
          cleanText(inventoryItem.name || inventoryItem.itemName, 220),
          cleanText(inventoryItem.quantity || inventoryItem.amount, 120),
          cleanText(inventoryItem.location || inventoryItem.position, 220),
          buildPersonalSearchText(zone, inventoryItem),
          JSON.stringify(inventoryItem)
        ]);
      });
    });
    personalStmt.free();

    const metaStmt = db.prepare('INSERT INTO inventory_meta (key, value_json) VALUES (?, ?)');
    metaStmt.run(['lab_blocks', JSON.stringify(asArray(labInventory.blocks))]);
    metaStmt.run(['lab_last_location_number', JSON.stringify(Number(labInventory.lastLocationNumber) || 0)]);
    metaStmt.run(['lab_location_code_map', JSON.stringify(labInventory.locationCodeMap || {})]);
    metaStmt.run(['lab_location_code_next_by_location', JSON.stringify(labInventory.locationCodeNextByLocation || {})]);
    metaStmt.free();

    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

function replaceProtocolIndexTable(db, protocols) {
  db.run('BEGIN TRANSACTION');
  try {
    db.run('DELETE FROM protocol_index');
    const stmt = db.prepare(`
      INSERT INTO protocol_index (
        id, name, category, description, tags_json, linked_project, step_count,
        steps_preview_json, search_text, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    asArray(protocols).forEach((protocol, index) => {
      const source = protocol && typeof protocol === 'object' ? protocol : {};
      const id = cleanText(source.id, 120) || `protocol-${index + 1}`;
      const stepPreview = buildProtocolStepPreview(source, 8);
      stmt.run([
        id,
        cleanText(source.name, 220),
        cleanText(source.category, 120),
        cleanText(source.description, 1000),
        JSON.stringify(asArray(source.tags)),
        cleanText(source.linkedProjectName || source.projectName, 220),
        asArray(source.steps).length,
        JSON.stringify(stepPreview),
        buildProtocolSearchText(source),
        cleanText(source.updatedAt || source.createdAt, 80)
      ]);
    });
    stmt.free();
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

function replaceNotebookIndexTable(db, notebookEntries) {
  db.run('BEGIN TRANSACTION');
  try {
    db.run('DELETE FROM notebook_index');
    const stmt = db.prepare(`
      INSERT INTO notebook_index (
        id, protocol_id, protocol_name, project_id, project_name, result, updated_at,
        created_at, linked_refs_json, search_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    asArray(notebookEntries).forEach((entry, index) => {
      const source = normalizeNotebookPageEntry(entry);
      const id = cleanText(source.id, 120) || `notebook-${index + 1}`;
      const linkedRefs = {
        assays: asArray(source.linkedAssays || source.assayRefs),
        gels: asArray(source.linkedGels || source.gelRefs),
        files: asArray(source.resultFileAddresses || source.resultFiles)
      };
      stmt.run([
        id,
        cleanText(source.protocolId, 120),
        cleanText(source.protocolName, 220),
        cleanText(source.projectId, 120),
        cleanText(source.projectName, 220),
        cleanText(source.result, 1600),
        cleanText(source.updatedAt, 80),
        cleanText(source.createdAt, 80),
        JSON.stringify(linkedRefs),
        buildNotebookSearchText(source)
      ]);
    });
    stmt.free();
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
}

function decodeRawJson(value, fallback = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  const parsed = safeParseJson(value, fallback);
  if (!parsed || typeof parsed !== 'object') {
    return fallback;
  }
  return parsed;
}

async function readInventoryFromSqlite(sqlitePath) {
  if (!sqlitePath || !(await pathExists(sqlitePath))) {
    return null;
  }

  const { db } = await openIndexedDatabase(sqlitePath);
  try {
    const chemicalRows = queryAll(db, `
      SELECT id, name, amount, cas, location, supplier, raw_json
      FROM inventory_chemicals
      ORDER BY name COLLATE NOCASE ASC
    `);
    const personalRows = queryAll(db, `
      SELECT zone, id, name, quantity, location, raw_json
      FROM inventory_personal
      ORDER BY zone COLLATE NOCASE ASC, name COLLATE NOCASE ASC
    `);
    const metaRows = queryAll(db, 'SELECT key, value_json FROM inventory_meta');
    const meta = new Map(metaRows.map((row) => [cleanText(row.key, 120), row.value_json]));

    const chemicals = chemicalRows.map((row) => {
      const parsed = decodeRawJson(row.raw_json, {});
      return {
        ...parsed,
        id: cleanText(parsed.id || row.id, 120),
        name: cleanText(parsed.name || row.name, 220),
        amount: cleanText(parsed.amount || row.amount, 120),
        cas: cleanText(parsed.cas || parsed.casNumber || row.cas, 120),
        location: cleanText(parsed.location || parsed.locationLabel || row.location, 220),
        supplier: cleanText(parsed.supplier || parsed.vendor || row.supplier, 220)
      };
    });

    const groupedPersonal = {};
    personalRows.forEach((row) => {
      const parsed = decodeRawJson(row.raw_json, {});
      const zone = cleanText(row.zone, 80) || 'Unspecified';
      if (!groupedPersonal[zone]) {
        groupedPersonal[zone] = [];
      }
      groupedPersonal[zone].push({
        ...parsed,
        id: cleanText(parsed.id || row.id, 120),
        name: cleanText(parsed.name || parsed.itemName || row.name, 220),
        quantity: cleanText(parsed.quantity || parsed.amount || row.quantity, 120),
        location: cleanText(parsed.location || parsed.position || row.location, 220)
      });
    });

    return {
      labInventory: {
        chemicals,
        blocks: asArray(safeParseJson(meta.get('lab_blocks'), [])),
        lastLocationNumber: Number(safeParseJson(meta.get('lab_last_location_number'), 0)) || 0,
        locationCodeMap: normalizeChemicalStorePayload({
          locationCodeMap: safeParseJson(meta.get('lab_location_code_map'), {})
        }).locationCodeMap,
        locationCodeNextByLocation: normalizeChemicalStorePayload({
          locationCodeNextByLocation: safeParseJson(meta.get('lab_location_code_next_by_location'), {})
        }).locationCodeNextByLocation
      },
      personalInventory: groupedPersonal
    };
  } finally {
    db.close();
  }
}

function tokenize(value) {
  return cleanText(value, 300)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 16);
}

function scoreTextAgainstQuery(text, queryTokens, queryLower) {
  const haystack = cleanText(text, 5000).toLowerCase();
  if (!queryTokens.length) {
    return haystack ? 1 : 0;
  }
  let score = 0;
  queryTokens.forEach((token) => {
    if (haystack.includes(token)) {
      score += 1;
    }
  });
  if (queryLower && haystack.includes(queryLower)) {
    score += 3;
  }
  return score;
}

function rankRows(rows, query, searchTextAccessor, limit, idAccessor, nameAccessor) {
  const queryLower = cleanText(query, 220).toLowerCase();
  const queryTokens = tokenize(queryLower);
  const scored = asArray(rows).map((row) => {
    const searchText = searchTextAccessor(row);
    return {
      row,
      score: scoreTextAgainstQuery(searchText, queryTokens, queryLower)
    };
  }).filter((entry) => entry.score > 0 || !queryTokens.length);

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aName = cleanText(nameAccessor(a.row), 220).toLowerCase();
    const bName = cleanText(nameAccessor(b.row), 220).toLowerCase();
    if (aName !== bName) {
      return aName.localeCompare(bName);
    }
    const aId = cleanText(idAccessor(a.row), 120).toLowerCase();
    const bId = cleanText(idAccessor(b.row), 120).toLowerCase();
    return aId.localeCompare(bId);
  });

  return scored.slice(0, clamp(limit, 1, 50)).map((entry) => entry.row);
}

function toLikePattern(term) {
  const normalized = cleanText(term, 220).toLowerCase();
  if (!normalized) {
    return '%';
  }
  return `%${normalized.replace(/\s+/g, '%')}%`;
}

async function searchInventoryFromSqlite(sqlitePath, { query, limit, searchTerms }) {
  if (!sqlitePath || !(await pathExists(sqlitePath))) {
    return { usedSqlite: false, items: [], termsUsed: [] };
  }

  const { db } = await openIndexedDatabase(sqlitePath);
  try {
    const terms = uniqueStrings(searchTerms && searchTerms.length ? searchTerms : [query], 10);
    const cap = Math.max(clamp(limit, 1, 25) * 6, 40);
    const dedupe = new Map();

    for (const term of terms) {
      const pattern = toLikePattern(term);
      const chemicalRows = queryAll(db, `
        SELECT
          'chemical_inventory' AS kind,
          id,
          name,
          amount,
          cas,
          location,
          supplier,
          search_text,
          raw_json
        FROM inventory_chemicals
        WHERE search_text LIKE ?
        LIMIT ?
      `, [pattern, cap]);
      chemicalRows.forEach((row) => {
        const key = `chemical::${cleanText(row.id, 120).toLowerCase()}`;
        if (!dedupe.has(key)) {
          dedupe.set(key, { ...row, matched_term: term });
        }
      });

      const personalRows = queryAll(db, `
        SELECT
          'personal_inventory' AS kind,
          zone,
          id,
          name,
          quantity,
          location,
          search_text,
          raw_json
        FROM inventory_personal
        WHERE search_text LIKE ?
        LIMIT ?
      `, [pattern, cap]);
      personalRows.forEach((row) => {
        const key = `personal::${cleanText(row.zone, 80).toLowerCase()}::${cleanText(row.id, 120).toLowerCase()}`;
        if (!dedupe.has(key)) {
          dedupe.set(key, { ...row, matched_term: term });
        }
      });
    }

    let candidates = Array.from(dedupe.values());
    if (!candidates.length) {
      candidates = queryAll(db, `
        SELECT
          'chemical_inventory' AS kind,
          id,
          name,
          amount,
          cas,
          location,
          supplier,
          search_text,
          raw_json
        FROM inventory_chemicals
        LIMIT ?
      `, [cap]).concat(queryAll(db, `
        SELECT
          'personal_inventory' AS kind,
          zone,
          id,
          name,
          quantity,
          location,
          search_text,
          raw_json
        FROM inventory_personal
        LIMIT ?
      `, [cap]));
    }

    const ranked = rankRows(
      candidates,
      query,
      (row) => cleanText(row.search_text, 4000),
      limit,
      (row) => cleanText(row.id, 120),
      (row) => cleanText(row.name, 220)
    );

    const items = ranked.map((row) => {
      const parsed = decodeRawJson(row.raw_json, {});
      if (cleanText(row.kind, 40) === 'personal_inventory') {
        return {
          kind: 'personal_inventory',
          zone: cleanText(row.zone, 80),
          id: cleanText(parsed.id || row.id, 120),
          name: cleanText(parsed.name || parsed.itemName || row.name, 220),
          quantity: cleanText(parsed.quantity || parsed.amount || row.quantity, 120),
          location: cleanText(parsed.location || parsed.position || row.location, 220),
          matched_term: cleanText(row.matched_term, 120)
        };
      }
      return {
        kind: 'chemical_inventory',
        id: cleanText(parsed.id || row.id, 120),
        name: cleanText(parsed.name || row.name, 220),
        amount: cleanText(parsed.amount || row.amount, 120),
        cas: cleanText(parsed.cas || parsed.casNumber || row.cas, 120),
        location: cleanText(parsed.location || parsed.locationLabel || row.location, 220),
        supplier: cleanText(parsed.supplier || parsed.vendor || row.supplier, 220),
        matched_term: cleanText(row.matched_term, 120)
      };
    });

    return {
      usedSqlite: true,
      items,
      termsUsed: terms.slice(0, 6)
    };
  } finally {
    db.close();
  }
}

function searchInventoryFromSnapshot(snapshot, query, limit, searchTerms) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const personalItems = normalizePersonalInventorySections(source.inventory || {})
    .flatMap((section) => asArray(section.items).map((item) => ({
      kind: 'personal_inventory',
      zone: cleanText(section.zone, 80),
      id: cleanText(item?.id, 120),
      name: cleanText(item?.name || item?.itemName, 220),
      quantity: cleanText(item?.quantity || item?.amount, 120),
      location: cleanText(item?.location || item?.position, 220)
    })));

  const chemicalItems = normalizeChemicalStorePayload(source.labInventory || {}).chemicals.map((item) => ({
    kind: 'chemical_inventory',
    id: cleanText(item?.id, 120),
    name: cleanText(item?.name, 220),
    amount: cleanText(item?.amount, 120),
    cas: cleanText(item?.cas || item?.casNumber, 120),
    location: cleanText(item?.locationLabel || item?.location, 220),
    supplier: cleanText(item?.supplier || item?.vendor, 220)
  }));

  const merged = personalItems.concat(chemicalItems).map((item) => ({
    ...item,
    search_text: cleanText([
      item.kind,
      item.zone,
      item.id,
      item.name,
      item.quantity,
      item.amount,
      item.cas,
      item.location,
      item.supplier
    ].join(' ').toLowerCase(), 2500)
  }));

  const terms = uniqueStrings(searchTerms && searchTerms.length ? searchTerms : [query], 10);
  const rankedMap = new Map();
  terms.forEach((term) => {
    const subset = rankRows(
      merged,
      term,
      (row) => row.search_text,
      Math.max(limit * 2, 20),
      (row) => row.id || row.name,
      (row) => row.name || row.id
    );
    subset.forEach((item) => {
      const key = `${cleanText(item.kind, 40).toLowerCase()}::${cleanText(item.id || item.name, 220).toLowerCase()}`;
      if (!rankedMap.has(key)) {
        rankedMap.set(key, { ...item, matched_term: term });
      }
    });
  });

  const ranked = rankRows(
    Array.from(rankedMap.values()),
    query,
    (row) => row.search_text,
    limit,
    (row) => row.id || row.name,
    (row) => row.name || row.id
  );
  return {
    usedSqlite: false,
    items: ranked,
    termsUsed: terms.slice(0, 6)
  };
}

async function searchInventoryIndex({
  dataFilePath,
  fallbackDataFilePath = '',
  query = '',
  limit = 6,
  searchTerms = [],
  snapshot = null
} = {}) {
  const bundlePaths = getBundlePaths({ dataFilePath, fallbackDataFilePath });
  const sqliteResult = await searchInventoryFromSqlite(bundlePaths.sqlitePath, {
    query,
    limit,
    searchTerms
  });
  if (sqliteResult.items.length || sqliteResult.usedSqlite) {
    return {
      ...sqliteResult,
      bundlePaths
    };
  }
  return {
    ...searchInventoryFromSnapshot(snapshot, query, limit, searchTerms),
    bundlePaths
  };
}

async function searchProtocolsFromSqlite(sqlitePath, query, limit) {
  if (!sqlitePath || !(await pathExists(sqlitePath))) {
    return { usedSqlite: false, rows: [] };
  }

  const { db } = await openIndexedDatabase(sqlitePath);
  try {
    const pattern = toLikePattern(query || '');
    const rows = queryAll(db, `
      SELECT id, name, category, description, steps_preview_json, search_text
      FROM protocol_index
      WHERE search_text LIKE ?
      LIMIT ?
    `, [pattern, Math.max(limit * 6, 40)]);

    let candidates = rows;
    if (!candidates.length) {
      candidates = queryAll(db, `
        SELECT id, name, category, description, steps_preview_json, search_text
        FROM protocol_index
        LIMIT ?
      `, [Math.max(limit * 6, 40)]);
    }

    const ranked = rankRows(
      candidates,
      query,
      (row) => cleanText(row.search_text, 4000),
      limit,
      (row) => cleanText(row.id, 120),
      (row) => cleanText(row.name, 220)
    );
    return { usedSqlite: true, rows: ranked };
  } finally {
    db.close();
  }
}

function searchProtocolsFromSnapshot(snapshot, query, limit) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const rows = asArray(source.protocols).map((protocol, index) => {
    const id = cleanText(protocol?.id, 120) || `protocol-${index + 1}`;
    return {
      id,
      name: cleanText(protocol?.name, 220),
      category: cleanText(protocol?.category, 120),
      steps_preview_json: JSON.stringify(buildProtocolStepPreview(protocol, 8)),
      search_text: buildProtocolSearchText(protocol)
    };
  });
  return {
    usedSqlite: false,
    rows: rankRows(
      rows,
      query,
      (row) => row.search_text,
      limit,
      (row) => row.id,
      (row) => row.name
    )
  };
}

function buildProtocolDetailMap(protocols) {
  const byId = new Map();
  asArray(protocols).forEach((protocol, index) => {
    const id = cleanText(protocol?.id, 120) || `protocol-${index + 1}`;
    byId.set(id, protocol);
  });
  return byId;
}

async function searchProtocolsIndex({
  dataFilePath,
  fallbackDataFilePath = '',
  query = '',
  limit = 6,
  snapshot = null
} = {}) {
  const bundlePaths = getBundlePaths({ dataFilePath, fallbackDataFilePath });
  const [sidecarProtocols, sqliteResult] = await Promise.all([
    readProtocolsSidecar(bundlePaths),
    searchProtocolsFromSqlite(bundlePaths.sqlitePath, query, limit)
  ]);

  const fallbackSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const detailProtocols = sidecarProtocols.hasData ? sidecarProtocols.protocols : asArray(fallbackSnapshot.protocols);
  const detailMap = buildProtocolDetailMap(detailProtocols);
  const candidateRows = sqliteResult.rows.length
    ? sqliteResult.rows
    : searchProtocolsFromSnapshot(fallbackSnapshot, query, limit).rows;

  const items = candidateRows.map((row) => {
    const id = cleanText(row.id, 120);
    const detail = detailMap.get(id);
    const previewFromDetail = buildProtocolStepPreview(detail, 8);
    const previewFromIndex = asArray(safeParseJson(row.steps_preview_json, []))
      .map((step) => cleanText(step, 260))
      .filter(Boolean);
    const steps = previewFromDetail.length ? previewFromDetail : previewFromIndex;
    return {
      id,
      name: cleanText(detail?.name || row.name, 220),
      category: cleanText(detail?.category || row.category, 120),
      steps
    };
  }).filter((item) => item.id || item.name).slice(0, clamp(limit, 1, 20));

  return {
    usedSqlite: sqliteResult.usedSqlite,
    items,
    bundlePaths
  };
}

async function searchNotebookFromSqlite(sqlitePath, query, limit) {
  if (!sqlitePath || !(await pathExists(sqlitePath))) {
    return { usedSqlite: false, rows: [] };
  }

  const { db } = await openIndexedDatabase(sqlitePath);
  try {
    const pattern = toLikePattern(query || '');
    const rows = queryAll(db, `
      SELECT id, protocol_name, result, updated_at, search_text
      FROM notebook_index
      WHERE search_text LIKE ?
      LIMIT ?
    `, [pattern, Math.max(limit * 6, 60)]);

    let candidates = rows;
    if (!candidates.length) {
      candidates = queryAll(db, `
        SELECT id, protocol_name, result, updated_at, search_text
        FROM notebook_index
        LIMIT ?
      `, [Math.max(limit * 6, 60)]);
    }
    const ranked = rankRows(
      candidates,
      query,
      (row) => cleanText(row.search_text, 4000),
      limit,
      (row) => cleanText(row.id, 120),
      (row) => cleanText(row.protocol_name, 220)
    );
    return { usedSqlite: true, rows: ranked };
  } finally {
    db.close();
  }
}

function searchNotebookFromSnapshot(snapshot, query, limit) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const rows = asArray(source.notebookEntries).map((entry, index) => ({
    id: cleanText(entry?.id, 120) || `notebook-${index + 1}`,
    protocol_name: cleanText(entry?.protocolName, 220),
    result: cleanText(entry?.result, 1200),
    updated_at: cleanText(entry?.updatedAt, 80),
    search_text: buildNotebookSearchText(entry)
  }));
  return {
    usedSqlite: false,
    rows: rankRows(
      rows,
      query,
      (row) => row.search_text,
      limit,
      (row) => row.id,
      (row) => row.protocol_name
    )
  };
}

function buildNotebookDetailMap(notebookEntries) {
  const map = new Map();
  asArray(notebookEntries).forEach((entry, index) => {
    const id = cleanText(entry?.id, 120) || `notebook-${index + 1}`;
    map.set(id, normalizeNotebookPageEntry(entry));
  });
  return map;
}

async function searchNotebookEntriesIndex({
  dataFilePath,
  fallbackDataFilePath = '',
  query = '',
  limit = 6,
  snapshot = null
} = {}) {
  const bundlePaths = getBundlePaths({ dataFilePath, fallbackDataFilePath });
  const [sidecarNotebook, sqliteResult] = await Promise.all([
    readNotebookPagesSidecar(bundlePaths),
    searchNotebookFromSqlite(bundlePaths.sqlitePath, query, limit)
  ]);
  const fallbackSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const detailEntries = sidecarNotebook.hasData ? sidecarNotebook.notebookPages : asArray(fallbackSnapshot.notebookEntries);
  const detailMap = buildNotebookDetailMap(detailEntries);
  const candidateRows = sqliteResult.rows.length
    ? sqliteResult.rows
    : searchNotebookFromSnapshot(fallbackSnapshot, query, limit).rows;

  const items = candidateRows.map((row) => {
    const id = cleanText(row.id, 120);
    const detail = detailMap.get(id);
    return {
      id,
      protocolName: cleanText(detail?.protocolName || row.protocol_name, 220),
      result: cleanText(detail?.result || row.result, 1200),
      updatedAt: cleanText(detail?.updatedAt || row.updated_at, 80)
    };
  }).filter((item) => item.id || item.protocolName).slice(0, clamp(limit, 1, 20));

  return {
    usedSqlite: sqliteResult.usedSqlite,
    items,
    bundlePaths
  };
}

async function createMigrationBackup(bundlePaths, payload) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(
    bundlePaths.baseDir,
    `${bundlePaths.baseName}.migration-backup-${stamp}.json`
  );
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, JSON.stringify(payload, null, 2), 'utf8');
  return backupPath;
}

async function syncBundleFromSnapshot({
  dataFilePath,
  snapshot,
  fallbackDataFilePath = ''
} = {}) {
  const bundlePaths = getBundlePaths({ dataFilePath, fallbackDataFilePath });
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  await fs.mkdir(bundlePaths.baseDir, { recursive: true });
  await Promise.all([
    writeProtocolsSidecar(bundlePaths.protocolsPath, asArray(source.protocols)),
    writeNotebookPagesSidecar(bundlePaths.notebookPagesPath, asArray(source.notebookEntries))
  ]);

  const { db } = await openIndexedDatabase(bundlePaths.sqlitePath);
  try {
    replaceInventoryTables(db, source);
    replaceProtocolIndexTable(db, asArray(source.protocols));
    replaceNotebookIndexTable(db, asArray(source.notebookEntries));
    await persistIndexedDatabase(bundlePaths.sqlitePath, db);
  } finally {
    db.close();
  }

  return {
    bundlePaths,
    sidecarPaths: {
      protocolsPath: bundlePaths.protocolsPath,
      notebookPagesPath: bundlePaths.notebookPagesPath
    }
  };
}

async function readLegacyChemicalsPayload(legacyChemicalsPath) {
  if (!legacyChemicalsPath) {
    return null;
  }
  const payload = await readJsonFileIfExists(legacyChemicalsPath);
  if (!payload) {
    return null;
  }
  return normalizeChemicalStorePayload(payload);
}

async function hydrateSnapshotFromBundle({
  dataFilePath,
  snapshot,
  fallbackDataFilePath = '',
  legacyChemicalsPath = ''
} = {}) {
  const bundlePaths = getBundlePaths({ dataFilePath, fallbackDataFilePath });
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const [protocolsSidecar, notebookSidecar] = await Promise.all([
    readProtocolsSidecar(bundlePaths),
    readNotebookPagesSidecar(bundlePaths)
  ]);

  let merged = mergeProtocolsAndNotebookIntoSnapshot(source, {
    protocols: protocolsSidecar,
    notebookPages: notebookSidecar
  });

  let inventoryPayload = await readInventoryFromSqlite(bundlePaths.sqlitePath);
  let migrated = false;
  let migrationBackupPath = '';

  if (!inventoryPayload) {
    const legacyChemicals = await readLegacyChemicalsPayload(legacyChemicalsPath);
    const mergedChemicals = normalizeChemicalStorePayload(merged.labInventory || {});
    if (!mergedChemicals.chemicals.length && legacyChemicals) {
      merged = {
        ...merged,
        labInventory: {
          ...mergedChemicals,
          ...legacyChemicals
        }
      };
    }

    const hasMigrationData = asArray(merged.protocols).length > 0
      || asArray(merged.notebookEntries).length > 0
      || normalizeChemicalStorePayload(merged.labInventory || {}).chemicals.length > 0
      || normalizePersonalInventorySections(merged.inventory || {}).length > 0;

    if (hasMigrationData && bundlePaths.dataFilePath) {
      migrationBackupPath = await createMigrationBackup(bundlePaths, {
        data_file_path: bundlePaths.dataFilePath,
        legacy_sources: {
          protocols_sidecar: protocolsSidecar.filePath,
          notebook_sidecar: notebookSidecar.filePath,
          chemicals_json: legacyChemicalsPath
        },
        migrated_payload: {
          labInventory: normalizeChemicalStorePayload(merged.labInventory || {}),
          inventory: merged.inventory && typeof merged.inventory === 'object' ? merged.inventory : {},
          protocols: asArray(merged.protocols),
          notebookEntries: asArray(merged.notebookEntries)
        }
      });

      await syncBundleFromSnapshot({
        dataFilePath: bundlePaths.dataFilePath,
        snapshot: merged,
        fallbackDataFilePath
      });
      inventoryPayload = await readInventoryFromSqlite(bundlePaths.sqlitePath);
      migrated = true;
    }
  }

  if (inventoryPayload) {
    merged = mergeInventoryIntoSnapshot(merged, inventoryPayload);
  }

  // Backfill new sidecar paths if we loaded old legacy sidecars.
  if (protocolsSidecar.fromLegacyPath && asArray(merged.protocols).length > 0) {
    await writeProtocolsSidecar(bundlePaths.protocolsPath, asArray(merged.protocols));
  }
  if (notebookSidecar.fromLegacyPath && asArray(merged.notebookEntries).length > 0) {
    await writeNotebookPagesSidecar(bundlePaths.notebookPagesPath, asArray(merged.notebookEntries));
  }

  return {
    snapshot: merged,
    bundlePaths,
    sidecarPaths: {
      protocolsPath: bundlePaths.protocolsPath,
      notebookPagesPath: bundlePaths.notebookPagesPath
    },
    migration: {
      migrated,
      backupPath: migrationBackupPath
    }
  };
}

module.exports = {
  getBundlePaths,
  normalizeNotebookPageEntry,
  normalizeChemicalStorePayload,
  syncBundleFromSnapshot,
  hydrateSnapshotFromBundle,
  searchInventoryIndex,
  searchProtocolsIndex,
  searchNotebookEntriesIndex
};
