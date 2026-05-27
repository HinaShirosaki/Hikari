import { formatInventoryLink } from './inventory-links.js';
import { formatLocation } from './location-fields.js';
import {
  cloneMetadataObject,
  formatSampleRecordLabel,
  formatSampleTypeLabel
} from './sample-utils.js';

function appendNotebookResultLine(source, line) {
  const cleanLine = String(line || '').trim();
  if (!cleanLine) {
    return String(source || '').trim();
  }
  const current = String(source || '').trim();
  return current ? `${current}\n${cleanLine}` : cleanLine;
}

function resolveSampleStorageLabel(ctx, sample) {
  const inventoryLabel = formatInventoryLink(ctx, sample?.inventoryLink);
  if (inventoryLabel && inventoryLabel !== '-') {
    return inventoryLabel;
  }
  const locationLabel = formatLocation(sample?.location);
  return locationLabel && locationLabel !== '-' ? locationLabel : 'No storage location recorded';
}

export function appendPendingNotebookSampleCapture(ctx, record) {
  const capture = ctx.state.settings?.pendingNotebookSampleCapture;
  const notebookEntryId = String(capture?.notebookEntryId || '').trim();
  if (!notebookEntryId) {
    return null;
  }
  const entryIndex = (ctx.state.notebookEntries || []).findIndex((entry) => entry.id === notebookEntryId);
  if (entryIndex < 0) {
    ctx.state.settings.pendingNotebookSampleCapture = null;
    return null;
  }

  const savedAt = new Date().toISOString();
  const storageLabel = resolveSampleStorageLabel(ctx, record);
  const sampleLink = {
    id: `notebook-sample-capture-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    source: 'sample-registry-capture',
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
  const note = `[${savedAtLabel}] Saved sample ${formatSampleRecordLabel(record)} (${formatSampleTypeLabel(record?.type)}) from Add Samples. Saved in: ${storageLabel}.`;
  const currentEntry = ctx.state.notebookEntries[entryIndex];
  const nextEntry = {
    ...currentEntry,
    result: appendNotebookResultLine(currentEntry?.result, note),
    sampleLinks: (Array.isArray(currentEntry?.sampleLinks) ? currentEntry.sampleLinks : []).concat(sampleLink),
    updatedAt: savedAt
  };

  ctx.state.notebookEntries[entryIndex] = nextEntry;
  ctx.state.settings.pendingNotebookSampleCapture = null;
  return nextEntry;
}
