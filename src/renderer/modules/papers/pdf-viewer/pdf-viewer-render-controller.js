import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("papers");
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
import { paperFailure } from '../localization.js';

const ACTIVE_PAGE_RENDER_BUFFER = 4;
const RETAINED_PAGE_RENDER_BUFFER = 8;
const ZOOM_SETTLE_MS = 150;

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

  // The page point under (clientX, clientY), as fractions of that page's box.
  // Pages stack top to bottom, so the first one ending below the point holds it
  // (or sits just under it, in the gap).
  function getFocusAnchor({ clientX, clientY }) {
    const record = state.pageRecords.find((item) => item.element.getBoundingClientRect().bottom >= clientY)
      || state.pageRecords.at(-1);
    const rect = record?.element.getBoundingClientRect();
    if (!rect?.width || !rect.height) {
      return null;
    }
    return {
      record,
      clientX,
      clientY,
      xRatio: (clientX - rect.left) / rect.width,
      yRatio: (clientY - rect.top) / rect.height
    };
  }

  function restoreFocusAnchor(anchor) {
    const { stage } = elements;
    const rect = anchor.record.element.getBoundingClientRect();
    stage.scrollLeft += rect.left + (anchor.xRatio * rect.width) - anchor.clientX;
    stage.scrollTop += rect.top + (anchor.yRatio * rect.height) - anchor.clientY;
  }

  function applyDocumentScale(scale, { preserveScroll = false, resetScroll = false, focus = null } = {}) {
    if (!pageLayer || !state.pageRecords.length) {
      return;
    }
    const focusAnchor = focus && elements.stage ? getFocusAnchor(focus) : null;
    const anchor = preserveScroll && !focusAnchor ? ctx.getScrollAnchor() : null;
    state.zoom = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    applyPageSizing({ pageRecords: state.pageRecords, scale });
    if (resetScroll) {
      ctx.setStageScrollTop(0);
    } else if (focusAnchor) {
      restoreFocusAnchor(focusAnchor);
    } else if (anchor) {
      ctx.restoreScrollAnchor(anchor);
    }
  }

  // Zoom gestures fire every frame. Re-rendering canvases + text layers per frame
  // stalls the main thread, so each frame only resizes pages (the old bitmaps
  // stretch, like Acrobat) and crisp pages render once the gesture pauses.
  function previewZoom(focus = null) {
    if (!state.pdfDocument || !pageLayer) {
      return;
    }
    state.renderToken += 1;
    cancelAllRenderTasks(state.pageRecords);
    ctx.cancelScheduledRender?.();
    // Reflowing ~100 text spans per page dominates a resize; the settle render rebuilds them.
    pageLayer.classList.add('is-zooming');
    applyDocumentScale(ctx.getDocumentScale(), { focus });
    ctx.refreshToolbar();
    ctx.paintHighlights();
    ctx.paintPins();
    ctx.updateCurrentPageFromScroll({ force: true });
    state.zoomSettleTimer = setTimeout(() => {
      state.zoomSettleTimer = 0;
      void renderDocumentPages();
    }, ZOOM_SETTLE_MS);
  }

  async function renderDocumentPageRecords({ preserveScroll = false, resetScroll = false } = {}) {
    if (state.renderFrame) {
      ctx.cancelScheduledRender?.();
    }
    if (!state.pdfDocument || !pageLayer) {
      ctx.refreshToolbar();
      ctx.paintHighlights();
      ctx.paintPins();
      return;
    }

    pageLayer.classList.remove('is-zooming');
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
    const { renderRanges, retainRanges } = getPassRanges(scale);
    state.renderPassKey = getRenderPassKey(scale, renderRanges);
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
        ctx.setStatus(i18nUi.text("Rendering page {p0} of {p1}...", { p0: record.pageNumber, p1: state.pageCount }));
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
      ctx.setStatus(i18nUi.text("Viewing page {p0} of {p1}.", { p0: state.pageNumber, p1: state.pageCount }));
      ctx.refreshToolbar();
      ctx.paintHighlights();
      ctx.paintPins();
    } catch (error) {
      if (isRenderingCancelled(error)) {
        return;
      }
      state.renderPassKey = '';
      ctx.setStatus(paperFailure(error, 'viewer.renderFailed'), true);
    }
  }

  // Bitmaps grow with scale², so keep fewer neighbour pages when zoomed in.
  function getPassRanges(scale) {
    const bufferDivisor = Math.max(scale, 1);
    return {
      renderRanges: getActiveRenderRanges(Math.ceil(ACTIVE_PAGE_RENDER_BUFFER / bufferDivisor)),
      retainRanges: getActiveRenderRanges(Math.ceil(RETAINED_PAGE_RENDER_BUFFER / bufferDivisor))
    };
  }

  // Any invalidation bumps renderToken, so an unchanged key means the last pass
  // is still valid and covers the same pages.
  function getRenderPassKey(scale, renderRanges) {
    return [state.renderToken, scale, ...renderRanges.map((range) => `${range.firstPageNumber}-${range.lastPageNumber}`)].join('|');
  }

  let latestRender = null;
  async function renderDocumentPages(options = {}) {
    let pending = renderDocumentPageRecords(options);
    latestRender = pending;
    // Scrolling can replace an in-flight render. Awaiters need the replacement's
    // text layer too, rather than continuing after the canceled render returns.
    while (pending) {
      await pending;
      if (pending === latestRender) return;
      pending = latestRender;
    }
  }

  function scheduleVisiblePageRender() {
    // A pending zoom-settle render covers whatever the scroll exposed.
    if (!state.pdfDocument || state.renderFrame || state.zoomSettleTimer) {
      return;
    }
    // Panning sideways, or within the same pages, needs no new pass: starting one
    // cancels the in-flight renders of the very pages on screen.
    const scale = ctx.getDocumentScale();
    if (state.renderPassKey && state.renderPassKey === getRenderPassKey(scale, getPassRanges(scale).renderRanges)) {
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
    previewZoom,
    pruneRenderedPageRecords,
    renderDocumentPages,
    scheduleVisiblePageRender
  });
};
