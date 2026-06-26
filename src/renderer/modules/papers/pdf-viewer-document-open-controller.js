import { hasPaperPdfMetadata } from './pdf-metadata.js';
import {
  buildViewerAssetUrl,
  loadPdfJsModule
} from './pdf-viewer-loader.js';
import { cancelAllRenderTasks, releasePageRecords } from './pdf-viewer-page-records.js';
import {
  loadEmbeddedPdfMetadata,
  loadPageMetrics
} from './pdf-viewer-rendering.js';
import { DEFAULT_ZOOM } from './pdf-viewer-constants.js';
import {
  applyPaperOpenShellState,
  capturePreviousOpenState,
  restorePreviousOpenState
} from './pdf-viewer-open-state.js';
import { prepareAndSwapPageRecords } from './pdf-viewer-open-render-swap.js';

export const installPdfViewerDocumentOpenController = (ctx) => {
  const { elements, state } = ctx;
  const { pageLayer } = elements;

  async function loadPdfDocument(pdfjsLib, pdfBytes, activeLoadToken) {
    const loadingTask = pdfjsLib.getDocument({
      data: pdfBytes,
      cMapUrl: buildViewerAssetUrl('./vendor/pdfjs/web/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: buildViewerAssetUrl('./vendor/pdfjs/web/standard_fonts/'),
      wasmUrl: buildViewerAssetUrl('./vendor/pdfjs/web/wasm/'),
      iccUrl: buildViewerAssetUrl('./vendor/pdfjs/web/iccs/'),
      useWorkerFetch: false
    });
    state.loadingTask = loadingTask;
    loadingTask.onProgress = ({ loaded = 0, total = 0 } = {}) => {
      if (activeLoadToken !== state.loadToken || !total) {
        return;
      }
      const percent = Math.round((loaded / total) * 100);
      ctx.setStatus(`Loading PDF... ${percent}%`);
    };
    return loadingTask.promise;
  }

  async function openPaper({ paper, summary = '', resolveBytes, onOpenExternal }) {
    if (!paper?.id || typeof resolveBytes !== 'function') {
      return false;
    }

    const previousState = capturePreviousOpenState(state);
    state.loadToken += 1;
    const activeLoadToken = state.loadToken;
    ctx.cancelScreenshotSelection?.({ silent: true });
    applyPaperOpenShellState(ctx, { paper, summary, resolveBytes, onOpenExternal });
    ctx.cancelScrollSync();
    ctx.cancelScheduledRender?.();
    cancelAllRenderTasks(state.pageRecords);
    await ctx.cleanupLoadingTask();
    if (activeLoadToken !== state.loadToken) {
      return false;
    }
    ctx.paintHighlights();
    ctx.paintPins();
    ctx.refreshToolbar();
    ctx.setTitle(state.paperTitle);
    ctx.setMeta(state.paperMeta);
    ctx.setStatus('Loading PDF...');

    try {
      const [pdfjsLib, pdfBytes] = await Promise.all([
        loadPdfJsModule(),
        resolveBytes(paper)
      ]);
      if (activeLoadToken !== state.loadToken) {
        return false;
      }

      const pdfDocument = await loadPdfDocument(pdfjsLib, pdfBytes, activeLoadToken);
      if (activeLoadToken !== state.loadToken) {
        await ctx.destroyPdfDocument(pdfDocument);
        return false;
      }

      state.loadingTask = null;
      ctx.setStatus('Preparing pages...');

      const [embeddedMetadata, pageMetrics] = await Promise.all([
        loadEmbeddedPdfMetadata(pdfDocument),
        loadPageMetrics(pdfDocument)
      ]);
      if (activeLoadToken !== state.loadToken) {
        await ctx.destroyPdfDocument(pdfDocument);
        return false;
      }

      state.pdfDocument = pdfDocument;
      state.pageNumber = 1;
      state.pageCount = Number(pdfDocument.numPages) || 1;
      state.pageMetrics = pageMetrics.metrics;
      state.maxBasePageWidth = pageMetrics.maxBasePageWidth;
      state.zoom = DEFAULT_ZOOM;
      state.fitWidth = true;
      state.bookmarks = await ctx.loadPdfBookmarks(pdfDocument);
      if (activeLoadToken !== state.loadToken) {
        await ctx.destroyPdfDocument(pdfDocument);
        return false;
      }
      ctx.emitBookmarksResolved();
      if (previousState.pdfDocument && previousState.pdfDocument !== pdfDocument) {
        Promise.resolve(ctx.destroyPdfDocument(previousState.pdfDocument)).catch(() => {});
      }

      if (hasPaperPdfMetadata(embeddedMetadata)) {
        if (embeddedMetadata.title) {
          state.paperTitle = embeddedMetadata.title;
          ctx.setTitle(state.paperTitle);
        }
        Promise.resolve(state.onMetadataResolved?.({
          paperId: state.paperId,
          metadata: embeddedMetadata
        })).catch(() => {});
      }

      return prepareAndSwapPageRecords(ctx, { pdfDocument, activeLoadToken });
    } catch (error) {
      if (activeLoadToken !== state.loadToken) {
        return false;
      }
      state.loadingTask = null;
      if (state.pdfDocument === previousState.pdfDocument) {
        restorePreviousOpenState(ctx, previousState);
      } else {
        await ctx.cleanupDocument();
        releasePageRecords({ pageLayer, pageRecords: state.pageRecords });
        state.pageRecords = [];
      }
      ctx.refreshToolbar();
      ctx.setStatus(String(error?.message || error || 'Failed to load PDF.'), true);
      return false;
    }
  }

  Object.assign(ctx, {
    openPaper
  });
};
