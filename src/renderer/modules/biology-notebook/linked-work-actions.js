import { exportNotebookEntryPdf } from '../pdf-export.js';
import { findLatestLinkedRecord } from '../notebook-linked-previews.js';
import {
  matchesNotebookType,
  resolveEntryExperimentName,
  resolveEntryProtocol
} from './entry-helpers.js';

export function createLinkedWorkActions({
  notebookType,
  experimentNameInput,
  ensureEntry,
  getNotebookEntries,
  getProtocols,
  getGelAnalyses,
  getAssays,
  getSettings,
  setSettings,
  persist,
  previewImageLoader,
  onCreateLinkedGel,
  onCreateLinkedAssay,
  onOpenSampleRecorder
} = {}) {
  function matchesType(entry) {
    return matchesNotebookType(entry, notebookType);
  }

  async function onAddGelClick() {
    const entry = await ensureEntry();
    if (!entry || typeof onCreateLinkedGel !== 'function') {
      return;
    }
    const gelName = String(experimentNameInput?.value || '').trim() || resolveEntryExperimentName(entry);
    onCreateLinkedGel({
      notebookEntryId: entry.id,
      projectId: entry.projectId,
      notebookType: entry.notebookType || notebookType,
      gelName
    });
  }

  async function onAddAssayClick() {
    const entry = await ensureEntry();
    if (!entry || typeof onCreateLinkedAssay !== 'function') {
      return;
    }
    onCreateLinkedAssay({
      notebookEntryId: entry.id,
      projectId: entry.projectId,
      notebookType: entry.notebookType || notebookType
    });
  }

  async function onAddSamplesClick() {
    const entry = await ensureEntry();
    if (!entry) {
      return;
    }
    const requestedAt = new Date().toISOString();
    const settings = getSettings() || {};
    const nextSettings = settings && typeof settings === 'object' ? settings : {};
    nextSettings.pendingNotebookSampleCapture = {
      notebookEntryId: entry.id,
      notebookType: entry.notebookType || notebookType,
      projectId: entry.projectId,
      projectName: entry.projectName,
      protocolName: entry.protocolName,
      experimentName: resolveEntryExperimentName(entry),
      requestedAt
    };
    setSettings?.(nextSettings);
    persist?.();

    if (typeof onOpenSampleRecorder === 'function') {
      onOpenSampleRecorder({
        notebookEntryId: entry.id,
        notebookType: entry.notebookType || notebookType,
        projectId: entry.projectId,
        projectName: entry.projectName,
        protocolName: entry.protocolName,
        experimentName: resolveEntryExperimentName(entry),
        requestedAt
      });
    }
  }

  async function exportEntryPdf(entryId) {
    const entries = getNotebookEntries() || [];
    const entry = entries.find((item) => item.id === entryId && matchesType(item));
    if (!entry) {
      return;
    }
    const protocol = resolveEntryProtocol(entry, getProtocols() || []);
    const linkedGel = findLatestLinkedRecord(getGelAnalyses() || [], entry.id);
    const linkedAssay = findLatestLinkedRecord(getAssays() || [], entry.id);
    const [linkedGelPreviewImage, linkedAssayPlotImage] = await Promise.all([
      linkedGel ? previewImageLoader.resolveGelPreviewImage(linkedGel) : Promise.resolve(''),
      linkedAssay ? previewImageLoader.resolveAssayPlotImage(linkedAssay) : Promise.resolve('')
    ]);
    await exportNotebookEntryPdf({
      entry,
      protocol,
      linkedGel,
      linkedGelPreviewImage,
      linkedAssay,
      linkedAssayPlotImage
    });
  }

  return {
    onAddGelClick,
    onAddAssayClick,
    onAddSamplesClick,
    exportEntryPdf
  };
}
