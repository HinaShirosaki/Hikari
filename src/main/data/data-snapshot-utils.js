'use strict';

const { asArray } = require('../lib/normalize.js');

function cleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function normalizeChemicalStorePayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const locationCodeMap = source.locationCodeMap && typeof source.locationCodeMap === 'object'
    ? Object.fromEntries(
      Object.entries(source.locationCodeMap)
        .map(([key, value]) => [cleanText(key).toLowerCase(), cleanText(value).toUpperCase()])
        .filter(([key, value]) => key && value)
    )
    : {};
  const locationCodeNextByLocation = source.locationCodeNextByLocation && typeof source.locationCodeNextByLocation === 'object'
    ? Object.fromEntries(
      Object.entries(source.locationCodeNextByLocation)
        .map(([key, value]) => [cleanText(key).toLowerCase(), Number(value) || 0])
        .filter(([key, value]) => key && value > 0)
    )
    : {};
  return {
    chemicals: asArray(source.chemicals),
    blocks: asArray(source.blocks),
    lastLocationNumber: Number(source.lastLocationNumber) || 0,
    locationCodeMap,
    locationCodeNextByLocation
  };
}

function buildCompactIndexedSnapshot(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const labInventory = normalizeChemicalStorePayload(source.labInventory);
  return {
    ...source,
    protocols: [],
    notebookEntries: [],
    samples: [],
    labInventory: {
      chemicals: [],
      blocks: asArray(labInventory.blocks),
      lastLocationNumber: Number(labInventory.lastLocationNumber) || 0,
      locationCodeMap: labInventory.locationCodeMap || {},
      locationCodeNextByLocation: labInventory.locationCodeNextByLocation || {}
    },
    inventory: {},
    data_bundle: {
      mode: 'sqlite_indexed',
      updated_at: new Date().toISOString()
    }
  };
}

module.exports = {
  normalizeChemicalStorePayload,
  buildCompactIndexedSnapshot
};
