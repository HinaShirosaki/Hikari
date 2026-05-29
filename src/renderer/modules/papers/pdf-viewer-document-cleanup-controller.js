import { cancelAllRenderTasks } from './pdf-viewer-page-records.js';

export const installPdfViewerDocumentCleanupController = (ctx) => {
  const { state } = ctx;

  async function cleanupLoadingTask() {
    const currentTask = state.loadingTask;
    state.loadingTask = null;
    if (!currentTask || typeof currentTask.destroy !== 'function') {
      return;
    }
    try {
      await currentTask.destroy();
    } catch {}
  }

  async function destroyPdfDocument(pdfDocument) {
    if (!pdfDocument || typeof pdfDocument.destroy !== 'function') {
      return;
    }
    try {
      await pdfDocument.destroy();
    } catch {}
  }

  async function cleanupDocument() {
    const currentDocument = state.pdfDocument;
    state.pdfDocument = null;
    await destroyPdfDocument(currentDocument);
  }

  async function resetViewer(message = '') {
    state.loadToken += 1;
    state.renderToken += 1;
    cancelAllRenderTasks(state.pageRecords);
    await cleanupLoadingTask();
    await cleanupDocument();
    ctx.renderEmptyViewer(message);
    if (typeof state.onClose === 'function') {
      state.onClose();
    }
  }

  Object.assign(ctx, {
    cleanupLoadingTask,
    destroyPdfDocument,
    cleanupDocument,
    resetViewer
  });
};
