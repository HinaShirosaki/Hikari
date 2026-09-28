'use strict';

const { persistSqliteDatabase } = require('../lib/sqlite-persist');
const { assertChemicalIndexWritable } = require('./chemical-index-guard');
const {
  applyChemicalSqliteSchema
} = require('./storage-sql-schema');
const {
  asArray,
  buildSearchText,
  cleanText,
  ensureObject,
  loadSqlJs
} = require('./storage-utils');

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

async function writeSqliteIndex(sqlitePath, applySchema, writeRows) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  try {
    applySchema(db);
    writeRows(db);
    await persistSqliteDatabase(sqlitePath, db);
  } finally {
    db.close();
  }
}

async function writeChemicalSqliteBundleIndex(sqlitePath, snapshot) {
  assertChemicalIndexWritable(sqlitePath);
  return writeSqliteIndex(sqlitePath, applyChemicalSqliteSchema, (db) => {
    writeSqlInventoryChemicals(db, snapshot);
    writeSqlInventoryMeta(db, snapshot);
  });
}

module.exports = {
  writeChemicalSqliteBundleIndex,
  writeSqlInventoryChemicals,
  writeSqlInventoryMeta,
};
