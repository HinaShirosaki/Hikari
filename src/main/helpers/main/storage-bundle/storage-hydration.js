'use strict';

const { getBundlePaths } = require('./storage-paths');
const { readNotebookRowsFromSqlite, readProtocolRowsFromSqlite, readSqliteBundleIndex } = require('./storage-sql-read');
const { asArray, cleanText, cloneJson, ensureObject, readJsonFile } = require('./storage-utils');
const { hydrateWorkflowRootFromStoragePath } = require('./workflow-storage');

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

function mergeRecordsById(existingRecords, importedRecords, fallbackPrefix) {
  const byId = new Map();
  asArray(existingRecords).forEach((record, index) => {
    const source = ensureObject(record);
    const id = cleanText(source.id, 220) || `${fallbackPrefix}_existing_${index + 1}`;
    byId.set(id, {
      ...source,
      id
    });
  });
  asArray(importedRecords).forEach((record, index) => {
    const source = ensureObject(record);
    const id = cleanText(source.id, 220) || `${fallbackPrefix}_imported_${index + 1}`;
    const previous = byId.get(id) || {};
    byId.set(id, {
      ...previous,
      ...source,
      id
    });
  });
  return [...byId.values()];
}

function mergePaperRecords(existingRecords, importedRecords) {
  const byId = new Map();
  asArray(existingRecords).forEach((record, index) => {
    const source = ensureObject(record);
    const id = cleanText(source.id, 220) || `paper_existing_${index + 1}`;
    byId.set(id, {
      ...source,
      id
    });
  });
  asArray(importedRecords).forEach((record, index) => {
    const source = ensureObject(record);
    const id = cleanText(source.id, 220) || `paper_imported_${index + 1}`;
    const previous = ensureObject(byId.get(id));
    const merged = {
      ...previous,
      ...source,
      id
    };
    if (!cleanText(source.pdfDataUrl, 80)) {
      merged.pdfDataUrl = cleanText(previous.pdfDataUrl, 10_000_000);
    }
    if (!cleanText(source.storedFilePath, 2400)) {
      merged.storedFilePath = cleanText(previous.storedFilePath, 2400);
    }
    if (!cleanText(source.storedRelativePath, 2400)) {
      merged.storedRelativePath = cleanText(previous.storedRelativePath, 2400);
    }
    byId.set(id, merged);
  });
  return [...byId.values()];
}

function mergePaperExperimentLinks(existingLinks, importedLinks) {
  const byKey = new Map();
  const pushLink = (rawLink, prefix, index) => {
    const link = ensureObject(rawLink);
    const substantiveKey = [
      cleanText(link.paperId, 220),
      cleanText(link.entryId, 220),
      cleanText(link.projectId, 220),
      cleanText(link.note, 600)
    ].join('::');
    const key = substantiveKey || `${prefix}_${index + 1}`;
    if (!substantiveKey && !Object.keys(link).length) {
      return;
    }
    byKey.set(key, {
      ...(byKey.get(key) || {}),
      ...link
    });
  };
  asArray(existingLinks).forEach((link, index) => pushLink(link, 'existing', index));
  asArray(importedLinks).forEach((link, index) => pushLink(link, 'imported', index));
  return [...byKey.values()];
}

async function hydrateSnapshotFromBundle({
  dataFilePath,
  snapshot,
  fallbackDataFilePath = '',
  bundlePaths: explicitBundlePaths = null
} = {}) {
  const bundlePaths = explicitBundlePaths && typeof explicitBundlePaths === 'object'
    ? explicitBundlePaths
    : getBundlePaths({ dataFilePath, fallbackDataFilePath });
  const sourceSnapshot = cloneJson(snapshot, {});
  const nextSnapshot = cloneJson(sourceSnapshot, {});
  const migration = {
    applied: [],
    warnings: []
  };

  if (!bundlePaths.basePath && !bundlePaths.sqlitePath && !bundlePaths.protocolsPath && !bundlePaths.notebookPagesPath) {
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

  const workflowRootPath = cleanText(nextSnapshot?.settings?.storagePath, 2400);
  if (workflowRootPath) {
    const workflowHydrated = await hydrateWorkflowRootFromStoragePath({
      storagePath: workflowRootPath
    });
    if (workflowHydrated.exists) {
      nextSnapshot.workflowTemplates = mergeRecordsById(nextSnapshot.workflowTemplates, workflowHydrated.workflowTemplates, 'workflow_template');
      nextSnapshot.workflows = mergeRecordsById(nextSnapshot.workflows, workflowHydrated.workflows, 'workflow');
      nextSnapshot.notebookEntries = mergeRecordsById(nextSnapshot.notebookEntries, workflowHydrated.notebookEntries, 'notebook');
      nextSnapshot.papers = mergePaperRecords(nextSnapshot.papers, workflowHydrated.papers);
      nextSnapshot.paperExperimentLinks = mergePaperExperimentLinks(
        nextSnapshot.paperExperimentLinks,
        workflowHydrated.paperExperimentLinks
      );
      migration.applied.push('workflow_root_storage');
      asArray(workflowHydrated.warnings).forEach((warning) => {
        if (warning) {
          migration.warnings.push(String(warning));
        }
      });
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
  hydrateInventoryFromSqliteSnapshot,
  hydrateSnapshotFromBundle
};
