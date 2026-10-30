import { clamp } from './pdf-viewer-anchors.js';
import {
  MAX_ZOOM,
  MIN_ZOOM
} from './pdf-viewer-constants.js';
import {
  applyPageSizing,
  cancelAllRenderTasks,
  clearPageRecordRender,
  clearPageRecordsOutsideRange
} from './pdf-viewer-page-records.js';
import {
  renderPageRecord
} from './pdf-viewer-rendering.js';
import { isRenderingCancelled } from './pdf-viewer-loader.js';

const ACTIVE_PAGE_RENDER_BUFFER = 4;
const RETAINED_PAGE_RENDER_BUFFER = 8;

export const installPdfViewerRenderController = (ctx) => {
  const { elements, state } = ctx;
  const { pageLayer } = elements;

  function clampPageRange(range = {}) {
    const pageCount = Math.max(Math.round(Number(state.pageCount) || 0), 1);
    const firstPageNumber = clamp(Math.round(Number(range.firstPageNumber) || state.pageNumber || 1), 1, pageCount);
    const lastPageNumber = clamp(Math.round(Number(range.lastPageNumber) || firstPageNumber), firstPageNumber, pageCount);
    return {
      firstPageNumber,
      lastPageNumber
    };
  }

  function getViewportPageRange() {
    const { stage } = elements;
    if (!stage || !state.pageRecords.length) {
      return clampPageRange({
        firstPageNumber: state.pageNumber,
        lastPageNumber: state.pageNumber
      });
    }

    const viewportHeight = Math.max(Number(stage.clientHeight) || 0, 0);
    if (viewportHeight <= 0) {
      return clampPageRange({
        firstPageNumber: state.pageNumber,
        lastPageNumber: state.pageNumber
      });
    }

    const viewportTop = Math.max(Number(stage.scrollTop) || 0, 0);
    const viewportBottom = viewportTop + viewportHeight;
    const visiblePageNumbers = state.pageRecords
      .filter((record) => {
        const pageTop = Number(record?.element?.offsetTop) || 0;
        const pageHeight = Number(record?.element?.offsetHeight) || 0;
        if (pageHeight <= 0) {
          return false;
        }
        const pageBottom = pageTop + pageHeight;
        return pageBottom >= viewportTop && pageTop <= viewportBottom;
      })
      .map((record) => record.pageNumber);

    if (!visiblePageNumbers.length) {
      return clampPageRange({
        firstPageNumber: state.pageNumber,
        lastPageNumber: state.pageNumber
      });
    }

    return clampPageRange({
      firstPageNumber: Math.min(...visiblePageNumbers),
      lastPageNumber: Math.max(...visiblePageNumbers)
    });
  }

  function getBufferedPageRange(bufferPages = ACTIVE_PAGE_RENDER_BUFFER) {
    const range = getViewportPageRange();
    const buffer = Math.max(0, Math.round(Number(bufferPages) || 0));
    return clampPageRange({
      firstPageNumber: range.firstPageNumber - buffer,
      lastPageNumber: range.lastPageNumber + buffer
    });
  }

  function getPendingNavigationPageRange(bufferPages = ACTIVE_PAGE_RENDER_BUFFER) {
    const pendingPageNumber = Math.round(Number(state.pendingNavigationPageNumber) || 0);
    if (pendingPageNumber < 1 || pendingPageNumber > state.pageCount) {
      return null;
    }
    const buffer = Math.max(0, Math.round(Number(bufferPages) || 0));
    return clampPageRange({
      firstPageNumber: pendingPageNumber - buffer,
      lastPageNumber: pendingPageNumber + buffer
    });
  }

  function getActiveRenderRanges(bufferPages = ACTIVE_PAGE_RENDER_BUFFER) {
    return [
      getBufferedPageRange(bufferPages),
      getPendingNavigationPageRange(bufferPages)
    ].filter(Boolean);
  }

  function getPageRecordsInRange(range = {}) {
    const normalizedRange = clampPageRange(range);
    return state.pageRecords.filter((record) => (
      record.pageNumber >= normalizedRange.firstPageNumber
      && record.pageNumber <= normalizedRange.lastPageNumber
    ));
  }

  function getPageRecordsInRanges(ranges = []) {
    const recordsByPageNumber = new Map();
    ranges.forEach((range) => {
      getPageRecordsInRange(range).forEach((record) => {
        recordsByPageNumber.set(record.pageNumber, record);
      });
    });
    return [...recordsByPageNumber.values()];
  }

  function pageNumberIsInRanges(pageNumber, ranges = []) {
    return ranges.some((range) => (
      pageNumber >= range.firstPageNumber
      && pageNumber <= range.lastPageNumber
    ));
  }

  function pruneRenderedPageRecords(range = null) {
    const retainRanges = Array.isArray(range)
      ? range.filter(Boolean)
      : [range || getBufferedPageRange(RETAINED_PAGE_RENDER_BUFFER)];
    if (!retainRanges.length) {
      return;
    }
    if (retainRanges.length === 1) {
      clearPageRecordsOutsideRange({
        pageRecords: state.pageRecords,
        firstPageNumber: retainRanges[0].firstPageNumber,
        lastPageNumber: retainRanges[0].lastPageNumber
      });
      return;
    }
    state.pageRecords.forEach((record) => {
      const pageNumber = Math.max(1, Math.round(Number(record?.pageNumber) || 1));
      if (!pageNumberIsInRanges(pageNumber, retainRanges)) {
        clearPageRecordRender(record);
      }
    });
  }

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
    if (state.renderFrame) {
      ctx.cancelScheduledRender?.();
    }
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
    const renderRanges = getActiveRenderRanges(ACTIVE_PAGE_RENDER_BUFFER);
    const retainRanges = getActiveRenderRanges(RETAINED_PAGE_RENDER_BUFFER);
    const pendingNavigationPageNumber = Math.round(Number(state.pendingNavigationPageNumber) || 0);
    pruneRenderedPageRecords(retainRanges);
    const recordsToRender = getPageRecordsInRanges(renderRanges)
      .sort((left, right) => {
        const leftPageNumber = Number(left?.pageNumber) || 1;
        const rightPageNumber = Number(right?.pageNumber) || 1;
        const leftDistance = Math.min(
          Math.abs(leftPageNumber - state.pageNumber),
          pendingNavigationPageNumber ? Math.abs(leftPageNumber - pendingNavigationPageNumber) : Number.POSITIVE_INFINITY
        );
        const rightDistance = Math.min(
          Math.abs(rightPageNumber - state.pageNumber),
          pendingNavigationPageNumber ? Math.abs(rightPageNumber - pendingNavigationPageNumber) : Number.POSITIVE_INFINITY
        );
        return leftDistance - rightDistance || left.pageNumber - right.pageNumber;
      });

    try {
      for (const record of recordsToRender) {
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
          isLinkActivationEnabled: () => !state.placementMode,
          skipIfRendered: true
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

  function scheduleVisiblePageRender() {
    if (!state.pdfDocument || state.renderFrame) {
      return;
    }
    const win = ctx.getWindowRef();
    const schedule = typeof win?.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame.bind(win)
      : (callback) => setTimeout(callback, 0);
    state.renderFrame = schedule(() => {
      state.renderFrame = 0;
      void renderDocumentPages({ preserveScroll: false, resetScroll: false });
    });
  }

  Object.assign(ctx, {
    applyDocumentScale,
    getActiveRenderRanges,
    getBufferedPageRange,
    getPageRecordsInRange,
    getPageRecordsInRanges,
    pruneRenderedPageRecords,
    renderDocumentPages,
    scheduleVisiblePageRender
  });
};
