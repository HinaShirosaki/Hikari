'use strict';

const fs = require('fs/promises');
const { querySqlRows: readSqlRows } = require('../lib/sqlite.js');
const {
  asArray,
  cleanText,
  loadSqlJs,
  parseJsonObject
} = require('./storage-utils');

// The bundle index is derived from the sidecars and rewritten on every save,
// so an unusable one must never block hydration: hand back an empty index and a
// warning and let the folders on disk answer instead.
function emptyBundleIndex(exists, extra = {}) {
  return {
    exists,
    inventoryChemicals: [],
    inventoryMeta: {},
    ...extra
  };
}

async function readSqliteBundleIndex(sqlitePath) {
  try {
    const bytes = await fs.readFile(sqlitePath);
    if (!bytes.length) {
      return emptyBundleIndex(true);
    }
    const SQL = await loadSqlJs();
    const db = new SQL.Database(new Uint8Array(bytes));
    try {
      const tableRows = readSqlRows(db, "SELECT name FROM sqlite_master WHERE type='table'", []);
      const tableNames = new Set(asArray(tableRows).map((row) => cleanText(row?.name, 220).toLowerCase()).filter(Boolean));
      const inventoryChemicalRows = tableNames.has('inventory_chemicals')
        ? readSqlRows(db, 'SELECT * FROM inventory_chemicals', [])
        : [];
      const inventoryChemicals = inventoryChemicalRows.map((row) => parseJsonObject(row.raw_json) || {
        id: cleanText(row.id, 220),
        name: cleanText(row.name, 320),
        amount: cleanText(row.amount, 120),
        cas: cleanText(row.cas, 120),
        location: cleanText(row.location, 280),
        supplier: cleanText(row.supplier, 240)
      });
      const inventoryMetaRows = tableNames.has('inventory_meta')
        ? readSqlRows(db, 'SELECT * FROM inventory_meta', [])
        : [];
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
        inventoryMeta
      };
    } finally {
      db.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return emptyBundleIndex(false);
    }
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      return emptyBundleIndex(false, {
        permissionDenied: true,
        warning: `Permission denied reading SQLite bundle index: ${String(error?.message || error)}`
      });
    }
    // Corrupt or truncated image (a crash mid-save used to leave these), a
    // directory in its place, anything else unreadable: same answer as a
    // missing file, so the workspace still loads from its sidecars.
    return emptyBundleIndex(false, {
      unreadable: true,
      warning: `Ignoring unreadable SQLite bundle index ${sqlitePath}: ${String(error?.message || error)}`
    });
  }
}

module.exports = {
  readSqlRows,
  readSqliteBundleIndex
};
