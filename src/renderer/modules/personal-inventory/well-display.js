import { normalizeSampleType } from '../../lib/inventory-settings.js';
import { SAMPLE_TYPE_FIELDS } from './type-fields.js';

const STORAGE_KEY = 'hikari_sample_well_display_v1';

export const WELL_DISPLAY_FIELDS = Object.freeze(['code', 'type', 'lot', 'concentration', 'notes']);
const validFields = new Set(WELL_DISPLAY_FIELDS);
for (const [type, fields] of Object.entries(SAMPLE_TYPE_FIELDS)) {
  for (const { key } of fields) validFields.add(`${type}.${key}`);
}

export function isWellDisplayField(field) {
  return validFields.has(field);
}

export function readWellDisplayPreferences() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}');
    const fields = Array.isArray(saved.fields) ? saved.fields : [saved.field];
    return {
      fields: [...new Set(fields.filter(isWellDisplayField))],
      samples: new Map(saved.samples || [])
    };
  } catch {
    return { fields: [], samples: new Map() };
  }
}

export function saveWellDisplayPreferences({ fields, samples }) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ fields, samples: [...samples] }));
  } catch {
    // Keep using the in-memory preference if local storage is unavailable.
  }
}

export function wellDisplayKey(section, containerId, index) {
  return JSON.stringify([section, containerId, index]);
}

export function getDisplayedWellSample(display, section, containerId, index, linkedSamples) {
  const preferredId = display?.samples.get(wellDisplayKey(section, containerId, index));
  return linkedSamples.find(sample => sample.id === preferredId) || linkedSamples[0];
}

export function getWellDisplayText(display, section, containerId, index, linkedSamples, getSampleTypeLabel) {
  const sample = getDisplayedWellSample(display, section, containerId, index, linkedSamples);
  if (!sample) return { name: '', details: [] };
  const name = String(sample.name ?? '').trim() || String(sample.code || sample.id || '');
  const sampleType = normalizeSampleType(sample.type);
  const details = (display?.fields || []).map(field => {
    if (field === 'type') return getSampleTypeLabel(sample.type);
    const [type, key] = field.split('.');
    const value = key
      ? (sampleType === type ? sample.details?.[key] : '')
      : sample[field];
    return String(value ?? '').trim();
  }).filter(Boolean);
  return { name, details };
}
