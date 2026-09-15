import { exportNotebookEntryPdf, exportProjectNotebookEntriesPdf } from '../../pdf-export/index.js';
import { findLatestLinkedRecord } from '../../../services/notebook-linked-previews.js';
import {
  matchesNotebookType,
  resolveEntryProtocol
} from '../entry/entry-helpers.js';
import { showTransientNotice } from '../../../lib/notify.js';

export function createLinkedWorkActions({
  notebookType,
  ensureEntry,
  getNotebookEntries,
  getProtocols,
  getGelAnalyses,
  getAssays,
  getPdfSettings,
  previewImageLoader,
  resultFileAttachmentLoader,
  onCreateLinkedAssay
} = {}) {
  function matchesType(entry) {
    return matchesNotebookType(entry, notebookType);
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

  async function exportEntryPdf(entryId, { print = false } = {}) {
    const entries = getNotebookEntries() || [];
    const entry = entries.find((item) => item.id === entryId && matchesType(item));
    if (!entry) {
      return;
    }
    const protocol = resolveEntryProtocol(entry, getProtocols() || []);
    const linkedGel = findLatestLinkedRecord(getGelAnalyses() || [], entry.id);
    const linkedAssay = findLatestLinkedRecord(getAssays() || [], entry.id);
    const [linkedGelPreviewImage, linkedAssayPlotImage, resultFileImages] = await Promise.all([
      linkedGel ? previewImageLoader.resolveGelPreviewImage(linkedGel) : Promise.resolve(''),
      linkedAssay ? previewImageLoader.resolveAssayPlotImage(linkedAssay) : Promise.resolve(''),
      resultFileAttachmentLoader?.resolveEntryImages?.(entry) || Promise.resolve([])
    ]);
    await exportNotebookEntryPdf({
      entry,
      protocol,
      linkedGel,
      linkedGelPreviewImage,
      linkedAssay,
      linkedAssayPlotImage,
      resultFileImages,
      pdfSettings: getPdfSettings?.() || {},
      print
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
      showTransientNotice('No notebook pages to export for this project.', { type: 'error' });
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
    const resultFileImagesByEntryId = new Map();

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
      imageTasks.push(
        Promise.resolve(resultFileAttachmentLoader?.resolveEntryImages?.(entry) || []).then((images) => {
          resultFileImagesByEntryId.set(entry.id, Array.isArray(images) ? images : []);
        })
      );
    });

    await Promise.all(imageTasks);

    await exportProjectNotebookEntriesPdf({
      project,
      entries: projectEntries,
      protocolsByEntryId,
      linkedGelByEntryId,
      linkedGelPreviewImagesByEntryId,
      linkedAssayByEntryId,
      linkedAssayPlotImagesByEntryId,
      resultFileImagesByEntryId,
      pdfSettings: getPdfSettings?.() || {}
    });
  }

  return {
    onAddAssayClick,
    exportEntryPdf,
    exportProjectPagesPdf
  };
}
