import { exportNotebookEntryPdf, exportProjectNotebookEntriesPdf } from '../../pdf-export/index.js';
import { findLatestLinkedRecord } from '../../../services/notebook-linked-previews.js';
import {
  matchesNotebookType,
  resolveEntryExperimentName,
  resolveEntryProtocol
} from '../entry/entry-helpers.js';

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

  async function exportProjectPagesPdf({ project, entries } = {}) {
    if (!project) {
      return;
    }
    const projectEntries = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && matchesType(entry))
      .slice()
      .sort((a, b) => {
        const left = Date.parse(String(a?.createdAt || a?.updatedAt || ''));
        const right = Date.parse(String(b?.createdAt || b?.updatedAt || ''));
        return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
      });
    if (!projectEntries.length) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('No notebook pages to export for this project.');
      }
      return;
    }

    const protocols = getProtocols() || [];
    const gelAnalyses = getGelAnalyses() || [];
    const assays = getAssays() || [];

    const protocolsByEntryId = new Map();
    const linkedGelByEntryId = new Map();
    const linkedAssayByEntryId = new Map();
    const linkedGelPreviewImagesByEntryId = new Map();
    const linkedAssayPlotImagesByEntryId = new Map();

    const imageTasks = [];
    projectEntries.forEach((entry) => {
      protocolsByEntryId.set(entry.id, resolveEntryProtocol(entry, protocols));
      const linkedGel = findLatestLinkedRecord(gelAnalyses, entry.id);
      if (linkedGel) {
        linkedGelByEntryId.set(entry.id, linkedGel);
        imageTasks.push(
          previewImageLoader.resolveGelPreviewImage(linkedGel).then((image) => {
            linkedGelPreviewImagesByEntryId.set(entry.id, image || '');
          })
        );
      }
      const linkedAssay = findLatestLinkedRecord(assays, entry.id);
      if (linkedAssay) {
        linkedAssayByEntryId.set(entry.id, linkedAssay);
        imageTasks.push(
          previewImageLoader.resolveAssayPlotImage(linkedAssay).then((image) => {
            linkedAssayPlotImagesByEntryId.set(entry.id, image || '');
          })
        );
      }
    });

    await Promise.all(imageTasks);

    await exportProjectNotebookEntriesPdf({
      project,
      entries: projectEntries,
      protocolsByEntryId,
      linkedGelByEntryId,
      linkedGelPreviewImagesByEntryId,
      linkedAssayByEntryId,
      linkedAssayPlotImagesByEntryId
    });
  }

  return {
    onAddGelClick,
    onAddAssayClick,
    onAddSamplesClick,
    exportEntryPdf,
    exportProjectPagesPdf
  };
}
