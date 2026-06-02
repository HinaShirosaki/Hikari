import { fieldLabel } from './import-schema.js';

export function installImportRecords(ctx) {
  const { createId, state } = ctx;
  const normalizeLocationKey = (...args) => ctx.normalizeLocationKey(...args);
  const assignLocationCode = (...args) => ctx.assignLocationCode(...args);
  const parseLocationCode = (...args) => ctx.parseLocationCode(...args);
  const appendBlock = (...args) => ctx.appendBlock(...args);

function cleanImportCell(value) {
  return String(value ?? '').trim();
}

function mappedImportValue(row, inference, field) {
  const index = inference.fieldToColumn[field];
  if (index == null || index < 0) {
    return '';
  }
  return cleanImportCell(row[index]);
}

function normalizeImportedDate(value) {
  const raw = cleanImportCell(value);
  if (!raw) {
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 20000 && numeric < 80000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + (Math.round(numeric) * 86400000));
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return raw;
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function ensureImportedLocation(location) {
  const cleanLocation = cleanImportCell(location) || 'Imported';
  if (!state.settings || typeof state.settings !== 'object') {
    state.settings = {};
  }
  if (!Array.isArray(state.settings.inventoryLocations)) {
    state.settings.inventoryLocations = [];
  }
  const exists = state.settings.inventoryLocations.some((item) => normalizeLocationKey(item) === normalizeLocationKey(cleanLocation));
  if (!exists) {
    state.settings.inventoryLocations.push(cleanLocation);
  }
  return cleanLocation;
}

function findExistingChemicalForImport(record) {
  const casKey = cleanImportCell(record.casNumber).toLowerCase();
  const catalogKey = cleanImportCell(record.catalogNumber).toLowerCase();
  const vendorKey = cleanImportCell(record.vendor).toLowerCase();
  const nameKey = cleanImportCell(record.name).toLowerCase();
  const locationKey = normalizeLocationKey(record.location);

  if (casKey) {
    const matchByCas = state.labInventory.chemicals.find((item) => cleanImportCell(item.casNumber).toLowerCase() === casKey);
    if (matchByCas) {
      return matchByCas;
    }
  }
  if (catalogKey) {
    const matchByCatalog = state.labInventory.chemicals.find((item) => {
      return cleanImportCell(item.catalogNumber).toLowerCase() === catalogKey
        && (!vendorKey || cleanImportCell(item.vendor).toLowerCase() === vendorKey);
    });
    if (matchByCatalog) {
      return matchByCatalog;
    }
  }
  if (nameKey && locationKey) {
    return state.labInventory.chemicals.find((item) => {
      return cleanImportCell(item.name).toLowerCase() === nameKey
        && normalizeLocationKey(item.location) === locationKey;
    }) || null;
  }
  return null;
}

function mergeImportedChemicalRecord(imported, existing = null) {
  const sameLocation = normalizeLocationKey(imported.location) === normalizeLocationKey(existing?.location);
  const locationCode = assignLocationCode(imported.location, sameLocation ? existing?.locationCode || '' : '');
  const parsedLocationCode = parseLocationCode(locationCode);
  const locationNumber = Number(parsedLocationCode?.number || existing?.locationNumber || 0);
  state.labInventory.lastLocationNumber = Math.max(Number(state.labInventory.lastLocationNumber) || 0, locationNumber);

  const valueOrExisting = (field) => {
    const importedValue = cleanImportCell(imported[field]);
    return importedValue || cleanImportCell(existing?.[field]);
  };

  return {
    ...(existing || {}),
    id: existing?.id || createId(),
    name: cleanImportCell(imported.name) || cleanImportCell(existing?.name),
    casNumber: valueOrExisting('casNumber'),
    location: cleanImportCell(imported.location) || cleanImportCell(existing?.location) || 'Imported',
    locationCode,
    locationNumber,
    vendor: valueOrExisting('vendor'),
    catalogNumber: valueOrExisting('catalogNumber'),
    unitSize: valueOrExisting('unitSize'),
    price: valueOrExisting('price'),
    amountInStock: valueOrExisting('amountInStock'),
    url: valueOrExisting('url'),
    expirationDate: normalizeImportedDate(imported.expirationDate) || cleanImportCell(existing?.expirationDate),
    updatedAt: new Date().toISOString()
  };
}

function importChemicalRows(parsed, inference, fileName) {
  ensureLabInventoryShape();
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    importedIds: []
  };

  rows.forEach((row) => {
    const imported = {
      name: mappedImportValue(row, inference, 'name'),
      casNumber: mappedImportValue(row, inference, 'casNumber'),
      location: ensureImportedLocation(mappedImportValue(row, inference, 'location') || 'Imported'),
      vendor: mappedImportValue(row, inference, 'vendor'),
      catalogNumber: mappedImportValue(row, inference, 'catalogNumber'),
      unitSize: mappedImportValue(row, inference, 'unitSize'),
      price: mappedImportValue(row, inference, 'price'),
      amountInStock: mappedImportValue(row, inference, 'amountInStock'),
      url: mappedImportValue(row, inference, 'url'),
      expirationDate: mappedImportValue(row, inference, 'expirationDate')
    };
    if (!imported.name) {
      result.skipped += 1;
      return;
    }

    const existing = findExistingChemicalForImport(imported);
    const record = mergeImportedChemicalRecord(imported, existing);
    const index = state.labInventory.chemicals.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      state.labInventory.chemicals[index] = record;
      result.updated += 1;
    } else {
      state.labInventory.chemicals.push(record);
      result.created += 1;
    }
    result.importedIds.push(record.id);
  });

  if (result.created || result.updated) {
    ctx.selectedChemicalId = result.importedIds[0] || ctx.selectedChemicalId;
    appendBlock('IMPORT_CHEMICALS', {
      fileName: cleanImportCell(fileName),
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      mappedColumns: inference.decisions.map((decision) => ({
        header: decision.header,
        field: decision.field,
        source: decision.source
      }))
    });
  }

  return result;
}

function buildImportMappingSummary(inference) {
  const decisions = inference.decisions
    .slice(0, 8)
    .map((decision) => `${decision.header} -> ${fieldLabel(decision.field)}${decision.source === 'llm' ? ' (LLM)' : ''}`);
  const remainingCount = Math.max(0, inference.decisions.length - decisions.length);
  const summary = decisions.join(', ');
  return `${summary}${remainingCount ? `, +${remainingCount} more` : ''}`;
}

  Object.assign(ctx, {
    cleanImportCell,
    mappedImportValue,
    normalizeImportedDate,
    ensureImportedLocation,
    findExistingChemicalForImport,
    mergeImportedChemicalRecord,
    importChemicalRows,
    buildImportMappingSummary
  });
}
