import { getContainerWellName } from '../../../lib/inventory-containers.js';
import { getSampleTypeLabel } from '../../../lib/inventory-settings.js';
import { cloneMetadataObject, formatSampleRecordLabel } from '../../../lib/sample-records.js';

function formatStorageLabel(state, link) {
  const container = (state.inventory?.[link?.section] || []).find((item) => item.id === link?.containerId);
  if (!container) {
    return 'No storage location recorded';
  }
  const well = Number.isInteger(link.wellIndex) ? getContainerWellName(container, link.wellIndex) : '';
  return [link.section, container.name, well].filter(Boolean).join(' / ');
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
  const storageLabel = formatStorageLabel(ctx.state, record?.inventoryLink);
  const sampleLink = {
    id: `notebook-sample-capture-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    source: String(capture?.source || '').trim() || 'notebook-quick-add',
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
  const note = `[${savedAtLabel}] Saved sample ${formatSampleRecordLabel(record)} (${getSampleTypeLabel(ctx.state.settings, record?.type)}) from Add Samples. Saved in: ${storageLabel}.`;
  return { entryIndex, sampleLink, note, savedAt };
}
