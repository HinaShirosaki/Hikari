import { formatInventoryLink } from './inventory-links.js';
import { formatLocation } from './location-fields.js';
import {
  cloneMetadataObject,
  formatSampleRecordLabel,
  formatSampleTypeLabel
} from './sample-utils.js';

function resolveSampleStorageLabel(ctx, sample) {
  const inventoryLabel = formatInventoryLink(ctx, sample?.inventoryLink);
  if (inventoryLabel && inventoryLabel !== '-') {
    return inventoryLabel;
  }
  const locationLabel = formatLocation(sample?.location);
  return locationLabel && locationLabel !== '-' ? locationLabel : 'No storage location recorded';
}

export function buildNotebookSampleCapture(ctx, record, capture = {}) {
  const notebookEntryId = String(capture?.notebookEntryId || '').trim();
  if (!notebookEntryId) {
    return null;
  }
  const entryIndex = (ctx.state.notebookEntries || []).findIndex((entry) => entry.id === notebookEntryId);
  if (entryIndex < 0) {
    return null;
  }

  const savedAt = new Date().toISOString();
  const storageLabel = resolveSampleStorageLabel(ctx, record);
  const sampleLink = {
    id: `notebook-sample-capture-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    source: String(capture?.source || '').trim() || 'sample-registry-capture',
    placeholderKey: '',
    placeholderName: '',
    placeholderType: '',
    sampleId: String(record?.id || '').trim(),
    sampleCode: String(record?.code || '').trim(),
    sampleName: String(record?.name || '').trim(),
    sampleType: String(record?.type || '').trim(),
    sampleLot: String(record?.lot || '').trim(),
    sampleConcentration: String(record?.concentration || '').trim(),
    storageLabel,
    location: cloneMetadataObject(record?.location),
    inventoryLink: cloneMetadataObject(record?.inventoryLink),
    linkedAt: savedAt,
    captureRequestedAt: String(capture?.requestedAt || '').trim()
  };
  const savedAtLabel = new Date(savedAt).toLocaleString();
  const note = `[${savedAtLabel}] Saved sample ${formatSampleRecordLabel(record)} (${formatSampleTypeLabel(record?.type, ctx.state.settings)}) from Add Samples. Saved in: ${storageLabel}.`;
  return { entryIndex, sampleLink, note, savedAt };
}
