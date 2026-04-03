'use strict';

const fs = require('fs/promises');
const { getBundlePaths } = require('./storage-paths');
const { readNotebookRowsFromSqlite, readProtocolRowsFromSqlite, readSqliteBundleIndex } = require('./storage-sql-read');
const { asArray, cleanText, cloneJson, ensureObject, readJsonFile } = require('./storage-utils');

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
  const hasSqlSamples = asArray(sqliteData.inventorySamples).length > 0;
  const hasSqlMeta = Object.keys(ensureObject(sqliteData.inventoryMeta)).length > 0;
  if (!hasSqlChemicals && !hasSqlPersonal && !hasSqlSamples && !hasSqlMeta) {
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
  if ((!Array.isArray(nextSnapshot.samples) || !nextSnapshot.samples.length) && hasSqlSamples) {
    nextSnapshot.samples = asArray(sqliteData.inventorySamples);
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

module.exports = {
  hydrateFromLegacyChemicals,
  hydrateInventoryFromSqliteSnapshot,
  hydrateSnapshotFromBundle
};
