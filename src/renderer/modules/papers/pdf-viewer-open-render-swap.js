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
    pageMetrics: state.pageMetrics
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
  const firstRecord = newPageRecords[0] || null;
  let prerenderedFirst = null;
  if (firstRecord) {
    try {
      prerenderedFirst = await renderPageCanvasToOffscreen({
        pdfDocument,
        record: firstRecord,
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
    if (prerenderedFirst) {
      commitOffscreenToVisibleCanvas({
        record: firstRecord,
        offscreen: prerenderedFirst.offscreen,
        cssWidth: prerenderedFirst.cssWidth,
        cssHeight: prerenderedFirst.cssHeight,
        bitmapWidth: prerenderedFirst.bitmapWidth,
        bitmapHeight: prerenderedFirst.bitmapHeight
      });
      try {
        prerenderedFirst.page?.cleanup?.();
      } catch {}
    }
  }

  releasePageRecords({ pageLayer, pageRecords: previousPageRecords });
  state.pageRecords = newPageRecords;
  attachPageRecords({ pageLayer, pageRecords: newPageRecords });
  ctx.setStageScrollTop(0);
  await ctx.renderDocumentPages({ resetScroll: false, preserveScroll: false });
  return true;
};
