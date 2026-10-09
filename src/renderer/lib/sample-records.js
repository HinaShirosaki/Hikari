import { getContainerWellName } from './inventory-containers.js';

export function makeDefaultSampleCode() {
  return `S-${Date.now().toString().slice(-6)}`;
}

export function normalizeSampleCode(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

// The readable storage location derived from a sample's container slot.
// wellIndex is null for a single (non-grid) container.
export function buildSampleLocation(section, container, wellIndex) {
  if (section === '4 Degree') {
    return { storageType: 'fridge', fridge: '4 Degree', shelf: container?.name || '' };
  }
  if (section === 'Room Temp') {
    return { storageType: 'rt_cabinet', cabinet: 'Room Temp', slot: container?.name || '' };
  }
  return {
    storageType: 'freezer',
    freezer: section,
    rack: '',
    box: container?.name || '',
    position: Number.isInteger(wellIndex) && wellIndex >= 0 ? getContainerWellName(container, wellIndex) : ''
  };
}

export function cloneMetadataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return Object.entries(value).reduce((accumulator, [key, raw]) => {
    const cleanKey = String(key || '').trim();
    if (cleanKey) {
      accumulator[cleanKey] = raw === null || raw === undefined ? '' : raw;
    }
    return accumulator;
  }, {});
}

export function formatSampleRecordLabel(sample) {
  const code = String(sample?.code || '').trim();
  const name = String(sample?.name || '').trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(sample?.id || 'Sample').trim();
}
