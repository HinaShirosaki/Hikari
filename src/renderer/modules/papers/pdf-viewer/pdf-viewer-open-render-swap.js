import { clamp } from './pdf-viewer-anchors.js';
import {
  MAX_ZOOM,
  MIN_ZOOM
} from './pdf-viewer-constants.js';
import {
  applyPageSizing,
  attachPageRecords,
  buildPageRecords,
  releasePageRecords
} from './pdf-viewer-page-records.js';
import { isRenderingCancelled } from './pdf-viewer-loader.js';
import {
  commitOffscreenToVisibleCanvas,
  renderPageCanvasToOffscreen
} from './pdf-viewer-rendering.js';

export const prepareAndSwapPageRecords = async (ctx, { pdfDocument, activeLoadToken } = {}) => {
  const { elements, state } = ctx;
  const { pageLayer } = elements;
  const previousPageRecords = state.pageRecords;
  const ownerDoc = pageLayer?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const newPageRecords = buildPageRecords({
    doc: ownerDoc,
    pageMetrics: state.pageMetrics,
    onCanvasContextLost: (record) => {
      record.renderedScale = 0;
      ctx.scheduleVisiblePageRender?.();
    }
  });
  const swapScale = (() => {
    const previousRecords = state.pageRecords;
    state.pageRecords = newPageRecords;
    try {
      return ctx.getDocumentScale();
    } finally {
      state.pageRecords = previousRecords;
    }
  })();
  state.zoom = clamp(swapScale, MIN_ZOOM, MAX_ZOOM);
  applyPageSizing({ pageRecords: newPageRecords, scale: swapScale });

  const isLoadStale = () => activeLoadToken !== state.loadToken;
  const outputScale = Math.max(ctx.getWindowRef()?.devicePixelRatio || 1, 1);
  // Open at the requested page: prerender it and scroll there before the first
  // visible-page render, so page 1 never flashes first.
  const startRecord = newPageRecords.find((record) => record.pageNumber === state.pageNumber)
    || newPageRecords[0]
    || null;
  let prerenderedStart = null;
  if (startRecord) {
    try {
      prerenderedStart = await renderPageCanvasToOffscreen({
        pdfDocument,
        record: startRecord,
        scale: swapScale,
        outputScale,
        isStale: isLoadStale
      });
    } catch (prerenderError) {
      if (!isRenderingCancelled(prerenderError)) {
        // The post-swap render path can still recover, so keep loading.
      }
    }
    if (isLoadStale()) {
      await ctx.destroyPdfDocument(pdfDocument);
      return false;
    }
    if (prerenderedStart) {
      commitOffscreenToVisibleCanvas({
        record: startRecord,
        offscreen: prerenderedStart.offscreen,
        cssWidth: prerenderedStart.cssWidth,
        cssHeight: prerenderedStart.cssHeight,
        bitmapWidth: prerenderedStart.bitmapWidth,
        bitmapHeight: prerenderedStart.bitmapHeight
      });
      startRecord.renderedScale = swapScale;
      try {
        prerenderedStart.page?.cleanup?.();
      } catch {}
    }
  }

  releasePageRecords({ pageLayer, pageRecords: previousPageRecords });
  state.pageRecords = newPageRecords;
  attachPageRecords({ pageLayer, pageRecords: newPageRecords });
  ctx.setStageScrollTop((startRecord?.element?.offsetTop || 0) - 8);
  await ctx.renderDocumentPages({ resetScroll: false, preserveScroll: false });
  return true;
};
