import { clamp } from './pdf-viewer-anchors.js';
import {
  MAX_ZOOM,
  MIN_ZOOM
} from './pdf-viewer-constants.js';
import {
  applyPageSizing,
  cancelAllRenderTasks
} from './pdf-viewer-page-records.js';
import {
  renderPageRecord
} from './pdf-viewer-rendering.js';
import { isRenderingCancelled } from './pdf-viewer-loader.js';

export const installPdfViewerRenderController = (ctx) => {
  const { elements, state } = ctx;
  const { pageLayer } = elements;

  function applyDocumentScale(scale, { preserveScroll = false, resetScroll = false } = {}) {
    if (!pageLayer || !state.pageRecords.length) {
      return;
    }
    const anchor = preserveScroll ? ctx.getScrollAnchor() : null;
    state.zoom = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    applyPageSizing({ pageRecords: state.pageRecords, scale });
    if (resetScroll) {
      ctx.setStageScrollTop(0);
    } else if (anchor) {
      ctx.restoreScrollAnchor(anchor);
    }
  }

  async function renderDocumentPages({ preserveScroll = false, resetScroll = false } = {}) {
    if (!state.pdfDocument || !pageLayer) {
      ctx.refreshToolbar();
      ctx.paintHighlights();
      ctx.paintPins();
      return;
    }

    const activeRenderToken = ++state.renderToken;
    const isStale = () => activeRenderToken !== state.renderToken;
    cancelAllRenderTasks(state.pageRecords);
    const scale = ctx.getDocumentScale();

    applyDocumentScale(scale, { preserveScroll, resetScroll });
    ctx.refreshToolbar();
    ctx.paintHighlights();
    ctx.paintPins();
    ctx.updateCurrentPageFromScroll({ force: true });

    const outputScale = Math.max(ctx.getWindowRef()?.devicePixelRatio || 1, 1);

    try {
      for (const record of state.pageRecords) {
        if (isStale()) {
          return;
        }
        ctx.setStatus(`Rendering page ${record.pageNumber} of ${state.pageCount}...`);
        await renderPageRecord({
          pdfDocument: state.pdfDocument,
          record,
          scale,
          outputScale,
          isStale,
          onExternalLink: ctx.openExternalLink,
          onDestination: ctx.goToDestination,
          onNamedAction: ctx.handleNamedPdfAction,
          isLinkActivationEnabled: () => !state.placementMode
        });
      }
      if (isStale()) {
        return;
      }
      ctx.setTitle(state.paperTitle || 'Paper Viewer');
      ctx.setMeta(state.paperMeta || 'PDF preview');
      ctx.updateCurrentPageFromScroll({ force: true });
      ctx.setStatus(`Viewing page ${state.pageNumber} of ${state.pageCount}.`);
      ctx.refreshToolbar();
      ctx.paintHighlights();
      ctx.paintPins();
    } catch (error) {
      if (isRenderingCancelled(error)) {
        return;
      }
      ctx.setStatus(String(error?.message || error || 'Failed to render PDF.'), true);
    }
  }

  Object.assign(ctx, {
    applyDocumentScale,
    renderDocumentPages
  });
};
