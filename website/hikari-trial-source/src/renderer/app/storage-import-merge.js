import { asArray } from '../lib/normalize.js';

function cloneDefaultValue(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function mergeRecordsById(existingRecords, importedRecords, fallbackPrefix) {
  const byId = new Map();
  asArray(existingRecords).forEach((record, index) => {
    const source = record && typeof record === 'object' ? record : {};
    const id = String(source.id || `${fallbackPrefix}_existing_${index + 1}`).trim();
    byId.set(id, {
      ...source,
      id
    });
  });
  asArray(importedRecords).forEach((record, index) => {
    const source = record && typeof record === 'object' ? record : {};
    const id = String(source.id || `${fallbackPrefix}_imported_${index + 1}`).trim();
    byId.set(id, {
      ...source,
      id
    });
  });
  return [...byId.values()];
}

function mergeInventoryMap(existingInventory, importedInventory) {
  const merged = {};
  const mergeZone = (zoneName, containers) => {
    const zone = String(zoneName || '').trim();
    if (!zone) {
      return;
    }
    const zoneMap = new Map(
      asArray(merged[zone]).map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const id = String(source.id || `${zone}_existing_${index + 1}`).trim();
        return [
          id,
          {
            ...source,
            id
          }
        ];
      })
    );
    asArray(containers).forEach((item, index) => {
      const source = item && typeof item === 'object' ? item : {};
      const id = String(source.id || `${zone}_imported_${index + 1}`).trim();
      zoneMap.set(id, {
        ...source,
        id
      });
    });
    merged[zone] = [...zoneMap.values()];
  };

  Object.entries(existingInventory && typeof existingInventory === 'object' ? existingInventory : {})
    .forEach(([zone, containers]) => mergeZone(zone, containers));
  Object.entries(importedInventory && typeof importedInventory === 'object' ? importedInventory : {})
    .forEach(([zone, containers]) => mergeZone(zone, containers));

  return merged;
}

function mergePaperRecords(existingRecords, importedRecords) {
  const merged = new Map();
  const pushRecord = (record, index, prefix) => {
    const source = record && typeof record === 'object' ? record : {};
    const id = String(source.id || `${prefix}_${index + 1}`).trim();
    const previous = merged.get(id) || {};
    const next = {
      ...previous,
      ...source,
      id
    };
    if (!String(source.storedFilePath || '').trim()) {
      next.storedFilePath = String(previous.storedFilePath || '').trim();
    }
    if (!String(source.storedRelativePath || '').trim()) {
      next.storedRelativePath = String(previous.storedRelativePath || '').trim();
    }
    const hasStoredPdfReference = Boolean(String(next.storedFilePath || '').trim())
      || Boolean(String(next.storedRelativePath || '').trim());
    if (hasStoredPdfReference) {
      next.pdfDataUrl = '';
    } else if (!String(source.pdfDataUrl || '').trim()) {
      next.pdfDataUrl = String(previous.pdfDataUrl || '').trim();
    }
    merged.set(id, next);
  };
  asArray(existingRecords).forEach((record, index) => pushRecord(record, index, 'paper_existing'));
  asArray(importedRecords).forEach((record, index) => pushRecord(record, index, 'paper_imported'));
  return [...merged.values()];
}

function mergeLabInventory(existingLabInventory, importedLabInventory) {
  const mergedBlocksMap = new Map();
  asArray(existingLabInventory.blocks).forEach((block, index) => {
    const source = block && typeof block === 'object' ? block : {};
    const key = String(source.hash || `${source.index || 0}_${source.timestamp || ''}_${index}`).trim();
    mergedBlocksMap.set(key, source);
  });
  asArray(importedLabInventory.blocks).forEach((block, index) => {
    const source = block && typeof block === 'object' ? block : {};
    const key = String(source.hash || `${source.index || 0}_${source.timestamp || ''}_${index}`).trim();
    mergedBlocksMap.set(key, source);
  });

  const mergedBlocks = [...mergedBlocksMap.values()].sort((left, right) => {
    const leftIndex = Number(left?.index) || 0;
    const rightIndex = Number(right?.index) || 0;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return String(left?.timestamp || '').localeCompare(String(right?.timestamp || ''));
  });

  return {
    ...existingLabInventory,
    ...importedLabInventory,
    chemicals: mergeRecordsById(existingLabInventory.chemicals, importedLabInventory.chemicals, 'chemical'),
    blocks: mergedBlocks,
    locationCodeMap: {
      ...(existingLabInventory.locationCodeMap && typeof existingLabInventory.locationCodeMap === 'object'
        ? existingLabInventory.locationCodeMap
        : {}),
      ...(importedLabInventory.locationCodeMap && typeof importedLabInventory.locationCodeMap === 'object'
        ? importedLabInventory.locationCodeMap
        : {})
    },
    locationCodeNextByLocation: {
      ...(existingLabInventory.locationCodeNextByLocation && typeof existingLabInventory.locationCodeNextByLocation === 'object'
        ? existingLabInventory.locationCodeNextByLocation
        : {}),
      ...(importedLabInventory.locationCodeNextByLocation && typeof importedLabInventory.locationCodeNextByLocation === 'object'
        ? importedLabInventory.locationCodeNextByLocation
        : {})
    },
    lastLocationNumber: Math.max(
      Number(existingLabInventory.lastLocationNumber) || 0,
      Number(importedLabInventory.lastLocationNumber) || 0
    )
  };
}

export {
  cloneDefaultValue,
  mergeInventoryMap,
  mergeLabInventory,
  mergePaperRecords,
  mergeRecordsById
};
