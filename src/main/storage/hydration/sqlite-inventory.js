'use strict';

const { asArray, cleanText, ensureObject, parseJsonObject } = require('../storage-utils');

function isPermissionDeniedError(error) {
  return error?.code === 'EPERM' || error?.code === 'EACCES';
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

  const hasContainers = Object.values(ensureObject(nextSnapshot.inventory)).some((list) => asArray(list).length > 0);
  if (!hasContainers && hasSqlPersonal) {
    nextSnapshot.inventory = inventoryPersonalMap;
  }
  if ((!Array.isArray(nextSnapshot.samples) || !nextSnapshot.samples.length) && hasSqlSamples) {
    nextSnapshot.samples = asArray(sqliteData.inventorySamples);
  }

  return true;
}

function mergeInventorySqliteSnapshots(primarySqliteData, secondarySqliteData) {
  const primary = ensureObject(primarySqliteData);
  const secondary = ensureObject(secondarySqliteData);
  return {
    inventoryChemicals: asArray(primary.inventoryChemicals).length
      ? asArray(primary.inventoryChemicals)
      : asArray(secondary.inventoryChemicals),
    inventoryPersonal: asArray(primary.inventoryPersonal).length
      ? asArray(primary.inventoryPersonal)
      : asArray(secondary.inventoryPersonal),
    inventorySamples: asArray(primary.inventorySamples).length
      ? asArray(primary.inventorySamples)
      : asArray(secondary.inventorySamples),
    inventoryMeta: Object.keys(ensureObject(primary.inventoryMeta)).length
      ? ensureObject(primary.inventoryMeta)
      : ensureObject(secondary.inventoryMeta)
  };
}

function readProtocolsFromSidecar(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  if (payload.protocol && typeof payload.protocol === 'object' && !Array.isArray(payload.protocol)) {
    return [payload.protocol];
  }
  return asArray(payload.protocols);
}

function readNotebookEntriesFromSidecar(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  return asArray(payload.notebookPages);
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function mergeSamplesSidecarIntoSnapshot(nextSnapshot, payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  let applied = false;
  if (hasOwn(payload, 'samples')) {
    nextSnapshot.samples = asArray(payload.samples);
    applied = true;
  }
  if (hasOwn(payload, 'inventory')) {
    nextSnapshot.inventory = ensureObject(payload.inventory);
    applied = true;
  }
  if (hasOwn(payload, 'inventoryFolders')) {
    nextSnapshot.inventoryFolders = ensureObject(payload.inventoryFolders);
    applied = true;
  }
  return applied;
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
    const storedFilePath = cleanText(source.storedFilePath, 2400);
    const storedRelativePath = cleanText(source.storedRelativePath, 2400);
    byId.set(id, {
      ...source,
      id,
      ...(storedFilePath || storedRelativePath ? { pdfDataUrl: '' } : {})
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
    if (!cleanText(source.storedFilePath, 2400)) {
      merged.storedFilePath = cleanText(previous.storedFilePath, 2400);
    }
    if (!cleanText(source.storedRelativePath, 2400)) {
      merged.storedRelativePath = cleanText(previous.storedRelativePath, 2400);
    }
    const hasStoredPdfReference = Boolean(cleanText(merged.storedFilePath, 2400))
      || Boolean(cleanText(merged.storedRelativePath, 2400));
    if (hasStoredPdfReference) {
      merged.pdfDataUrl = '';
    } else if (!cleanText(source.pdfDataUrl, 80)) {
      merged.pdfDataUrl = cleanText(previous.pdfDataUrl, 10_000_000);
    }
    byId.set(id, merged);
  });
  return [...byId.values()];
}

function readRecordIndexPayloadsByType(rows, recordType) {
  const targetType = cleanText(recordType, 80).toLowerCase();
  if (!targetType) {
    return [];
  }
  return asArray(rows)
    .map((row) => ensureObject(row))
    .filter((row) => cleanText(row.record_type, 80).toLowerCase() === targetType)
    .map((row) => parseJsonObject(row.raw_json))
    .filter((record) => record && typeof record === 'object' && !Array.isArray(record));
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

module.exports = {
  hasOwn,
  hydrateInventoryFromSqliteSnapshot,
  isPermissionDeniedError,
  mergeInventorySqliteSnapshots,
  mergePaperExperimentLinks,
  mergePaperRecords,
  mergeRecordsById,
  mergeSamplesSidecarIntoSnapshot,
  readNotebookEntriesFromSidecar,
  readProtocolsFromSidecar,
  readRecordIndexPayloadsByType
};
