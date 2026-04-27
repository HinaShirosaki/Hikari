import { SAMPLE_TYPE_LABELS, getWellName } from '../personal-inventory/constants.js';
import { formatEntryTimestamp } from './entry-helpers.js';

export function normalizeSampleLookupText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addSamplePlaceholderAlias(aliases, alias, type) {
  const normalized = normalizeSampleLookupText(alias);
  if (normalized) {
    aliases.set(normalized, type);
  }
}

export function buildSamplePlaceholderTypeAliases() {
  const aliases = new Map();
  const extraAliases = {
    plasmid: ['plasmids', 'vector', 'vectors'],
    cell_line: ['cell', 'cells', 'cell line', 'cell lines'],
    strain: ['strains'],
    antibody: ['antibodies'],
    protein: ['proteins', 'purified protein', 'purified proteins'],
    chemical: ['chemicals', 'reagent', 'reagents'],
    compound: ['compounds', 'compund', 'compunds', 'small molecule', 'small molecules'],
    primer: ['primers', 'oligo', 'oligos']
  };

  Object.entries(SAMPLE_TYPE_LABELS).forEach(([type, label]) => {
    if (type === 'other') {
      return;
    }
    addSamplePlaceholderAlias(aliases, type, type);
    addSamplePlaceholderAlias(aliases, String(type || '').replace(/_/g, ' '), type);
    addSamplePlaceholderAlias(aliases, label, type);
    (extraAliases[type] || []).forEach((alias) => addSamplePlaceholderAlias(aliases, alias, type));
  });

  return aliases;
}

export function normalizeSampleType(type) {
  const key = String(type || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SAMPLE_TYPE_LABELS, key)) {
    return key;
  }
  return 'other';
}

export function getSampleTypeLabel(type) {
  const normalized = normalizeSampleType(type);
  return SAMPLE_TYPE_LABELS[normalized] || SAMPLE_TYPE_LABELS.other || 'Sample';
}

export function resolveSampleTypeForPlaceholder(name, aliases) {
  const normalized = normalizeSampleLookupText(name);
  if (!normalized || !aliases) {
    return '';
  }
  if (aliases.has(normalized)) {
    return aliases.get(normalized);
  }
  const singular = normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
  return aliases.get(singular) || '';
}

export function getContainerWellLabel(container, index) {
  const rawWell = Array.isArray(container?.wells) ? container.wells[index] : null;
  if (rawWell && typeof rawWell === 'object') {
    const explicitName = String(rawWell.name || '').trim();
    if (explicitName) {
      return explicitName;
    }
  }
  return getWellName(container, index);
}

export function formatSampleLocation(location) {
  if (!location || typeof location !== 'object') {
    return '-';
  }
  if (location.storageType === 'freezer') {
    return [location.freezer, location.rack, location.box, location.position].filter(Boolean).join(' / ') || '-';
  }
  if (location.storageType === 'fridge') {
    return [location.fridge, location.shelf].filter(Boolean).join(' / ') || '-';
  }
  if (location.storageType === 'desiccator') {
    return [location.desiccator, location.position].filter(Boolean).join(' / ') || '-';
  }
  return [location.cabinet, location.slot].filter(Boolean).join(' / ') || '-';
}

export function formatSampleInventoryLink(link, inventory = {}) {
  if (!link || typeof link !== 'object') {
    return '-';
  }
  const section = String(link.section || '').trim();
  const sectionItems = Array.isArray(inventory?.[section]) ? inventory[section] : [];
  const container = sectionItems.find((item) => item.id === link.containerId);
  if (!container) {
    return section ? `${section} / missing container` : '-';
  }
  if (link.wellIndex === null || link.wellIndex === undefined || link.wellIndex === '') {
    return `${section} / ${container.name || 'Container'}`;
  }
  return `${section} / ${container.name || 'Container'} / ${getContainerWellLabel(container, Number(link.wellIndex))}`;
}

export function formatSampleStorageLabel(sample, inventory = {}) {
  const inventoryLabel = formatSampleInventoryLink(sample?.inventoryLink, inventory);
  if (inventoryLabel && inventoryLabel !== '-') {
    return inventoryLabel;
  }
  const locationLabel = formatSampleLocation(sample?.location);
  return locationLabel && locationLabel !== '-' ? locationLabel : 'No storage location recorded';
}

export function formatSampleRecordLabel(sample) {
  const code = String(sample?.code || '').trim();
  const name = String(sample?.name || '').trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(sample?.id || 'Sample').trim();
}

export function formatSampleLinkValue(link) {
  const code = String(link?.sampleCode || '').trim();
  const name = String(link?.sampleName || '').trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || String(link?.sampleId || 'Sample').trim();
}

export function cloneMetadataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return Object.entries(value).reduce((accumulator, [key, raw]) => {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) {
      return accumulator;
    }
    accumulator[cleanKey] = raw === null || raw === undefined ? '' : raw;
    return accumulator;
  }, {});
}

export function normalizeNotebookSampleLink(rawLink) {
  if (!rawLink || typeof rawLink !== 'object') {
    return null;
  }
  const sampleId = String(rawLink.sampleId || '').trim();
  const sampleCode = String(rawLink.sampleCode || rawLink.code || '').trim();
  const sampleName = String(rawLink.sampleName || rawLink.name || '').trim();
  if (!sampleId && !sampleCode && !sampleName) {
    return null;
  }
  const sampleType = normalizeSampleType(rawLink.sampleType || rawLink.type);
  const linkedAt = String(rawLink.linkedAt || rawLink.savedAt || '').trim();
  return {
    id: String(rawLink.id || '').trim() || `notebook-sample-link-${sampleId || sampleCode || Date.now()}`,
    source: String(rawLink.source || '').trim() || 'notebook',
    placeholderKey: String(rawLink.placeholderKey || '').trim(),
    placeholderName: String(rawLink.placeholderName || '').trim(),
    placeholderType: normalizeSampleType(rawLink.placeholderType || sampleType),
    sampleId,
    sampleCode,
    sampleName,
    sampleType,
    sampleLot: String(rawLink.sampleLot || rawLink.lot || '').trim(),
    sampleConcentration: String(rawLink.sampleConcentration || rawLink.concentration || '').trim(),
    storageLabel: String(rawLink.storageLabel || '').trim(),
    location: cloneMetadataObject(rawLink.location),
    inventoryLink: cloneMetadataObject(rawLink.inventoryLink),
    linkedAt
  };
}

export function normalizeNotebookSampleLinks(rawLinks) {
  return Array.isArray(rawLinks)
    ? rawLinks.map((link) => normalizeNotebookSampleLink(link)).filter(Boolean)
    : [];
}

export function buildNotebookSampleLinkMetadata({
  key,
  name,
  placeholderType,
  sample,
  linkedAt = '',
  existingLink = null,
  inventory = {}
} = {}) {
  const timestamp = linkedAt || new Date().toISOString();
  return {
    id: existingLink?.id || `notebook-sample-link-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    source: 'notebook-placeholder',
    placeholderKey: String(key || '').trim(),
    placeholderName: String(name || '').trim(),
    placeholderType: normalizeSampleType(placeholderType),
    sampleId: String(sample?.id || '').trim(),
    sampleCode: String(sample?.code || '').trim(),
    sampleName: String(sample?.name || '').trim(),
    sampleType: normalizeSampleType(sample?.type),
    sampleLot: String(sample?.lot || '').trim(),
    sampleConcentration: String(sample?.concentration || '').trim(),
    storageLabel: formatSampleStorageLabel(sample, inventory),
    location: cloneMetadataObject(sample?.location),
    inventoryLink: cloneMetadataObject(sample?.inventoryLink),
    linkedAt: timestamp
  };
}

export function buildNotebookSampleNote(link, action = 'Linked') {
  const timeLabel = formatEntryTimestamp(link?.linkedAt || new Date().toISOString());
  const sampleLabel = formatSampleLinkValue(link);
  const typeLabel = getSampleTypeLabel(link?.sampleType);
  const placeholderLabel = String(link?.placeholderName || '').trim();
  const targetText = placeholderLabel ? ` to ${placeholderLabel}` : '';
  const storageLabel = String(link?.storageLabel || '').trim() || 'No storage location recorded';
  return `[${timeLabel}] ${action} sample ${sampleLabel} (${typeLabel})${targetText}. Saved in: ${storageLabel}.`;
}
