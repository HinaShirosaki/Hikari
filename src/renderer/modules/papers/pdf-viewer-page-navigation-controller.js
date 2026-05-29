import { clamp } from './pdf-viewer-anchors.js';
import {
  MAX_ZOOM,
  MIN_ZOOM
} from './pdf-viewer-constants.js';

export const installPdfViewerPageNavigationController = (ctx) => {
  const { elements, state } = ctx;
  const { shell, workspace, stage } = elements;

  function getDocumentScale() {
    if (!state.fitWidth) {
      return clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
    }

    const baseWidth = Math.max(state.maxBasePageWidth || state.pageMetrics[0]?.width || 0, 1);
    const win = ctx.getWindowRef();
    const computedStyle = typeof win?.getComputedStyle === 'function' && stage
      ? win.getComputedStyle(stage)
      : null;
    const horizontalPadding = (Number.parseFloat(computedStyle?.paddingLeft || '0') || 0)
      + (Number.parseFloat(computedStyle?.paddingRight || '0') || 0);
    const layoutWidth = [
      stage,
      workspace,
      shell
    ].reduce((width, element) => width || ctx.getElementLayoutWidth(element), 0);
    const viewportWidth = Math.max(layoutWidth - horizontalPadding, 320);
    return clamp(viewportWidth / baseWidth, MIN_ZOOM, MAX_ZOOM);
  }

  function getScrollAnchor() {
    if (!stage || !state.pageRecords.length) {
      return null;
    }
    const currentRecord = state.pageRecords.find((record) => record.pageNumber === state.pageNumber)
      || state.pageRecords[0]
      || null;
    if (!currentRecord?.element) {
      return null;
    }
    const pageHeight = Math.max(currentRecord.element.offsetHeight || 0, 1);
    const offsetWithinPage = (stage.scrollTop || 0) - currentRecord.element.offsetTop;
    return {
      pageNumber: currentRecord.pageNumber,
      offsetRatio: clamp(offsetWithinPage / pageHeight, 0, 1)
    };
  }

  function restoreScrollAnchor(anchor) {
    if (!stage || !anchor) {
      return;
    }
    const targetRecord = state.pageRecords.find((record) => record.pageNumber === anchor.pageNumber);
    if (!targetRecord?.element) {
      return;
    }
    const targetTop = targetRecord.element.offsetTop + ((targetRecord.element.offsetHeight || 0) * anchor.offsetRatio);
    stage.scrollTop = Math.max(Math.round(targetTop), 0);
  }

  function setStageScrollTop(top) {
    if (!stage) {
      return;
    }
    const nextTop = Math.max(Math.round(Number(top) || 0), 0);
    if (typeof stage.scrollTo === 'function') {
      try {
        stage.scrollTo({ top: nextTop, behavior: 'auto' });
        return;
      } catch {}
    }
    stage.scrollTop = nextTop;
  }

  function cancelScrollSync() {
    const win = ctx.getWindowRef();
    if (!state.scrollFrame || typeof win?.cancelAnimationFrame !== 'function') {
      state.scrollFrame = 0;
      return;
    }
    win.cancelAnimationFrame(state.scrollFrame);
    state.scrollFrame = 0;
  }

  function emitPageChange() {
    if (typeof state.onPageChange === 'function' && ctx.hasActiveDocument()) {
      state.onPageChange(state.pageNumber);
    }
  }

  function updateCurrentPageFromScroll({ force = false } = {}) {
    if (!ctx.hasActiveDocument() || !stage || !state.pageRecords.length) {
      return;
    }

    const scrollAnchor = (stage.scrollTop || 0) + Math.max((stage.clientHeight || 0) * 0.35, 1);
    let nextPageNumber = state.pageRecords[0]?.pageNumber || 1;
    let nearestDistance = Number.POSITIVE_INFINITY;

    state.pageRecords.forEach((record) => {
      const pageTop = record.element?.offsetTop || 0;
      const pageHeight = record.element?.offsetHeight || 0;
      const pageBottom = pageTop + pageHeight;
      if (scrollAnchor >= pageTop && scrollAnchor <= pageBottom) {
        nextPageNumber = record.pageNumber;
        nearestDistance = -1;
        return;
      }
      if (nearestDistance < 0) {
        return;
      }
      const pageCenter = pageTop + (pageHeight / 2);
      const distance = Math.abs(pageCenter - scrollAnchor);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nextPageNumber = record.pageNumber;
      }
    });

    if (!force && nextPageNumber === state.pageNumber) {
      return;
    }

    state.pageNumber = nextPageNumber;
    ctx.refreshToolbar();
    emitPageChange();
  }

  function scheduleScrollSync() {
    if (state.scrollFrame) {
      return;
    }
    const win = ctx.getWindowRef();
    const schedule = typeof win?.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame.bind(win)
      : (callback) => setTimeout(callback, 0);
    state.scrollFrame = schedule(() => {
      state.scrollFrame = 0;
      updateCurrentPageFromScroll();
    });
  }

  function goToPage(pageNumber, options = {}) {
    if (!state.pdfDocument || !stage) {
      return;
    }
    const nextPage = clamp(Math.round(Number(pageNumber) || 1), 1, state.pageCount);
    const targetRecord = state.pageRecords.find((record) => record.pageNumber === nextPage) || null;
    state.pageNumber = nextPage;
    ctx.refreshToolbar();
    emitPageChange();

    if (!targetRecord?.element) {
      return;
    }
    const yRatio = Number.isFinite(Number(options.yRatio)) ? clamp(Number(options.yRatio), 0, 1) : 0;
    const targetOffset = yRatio > 0
      ? (targetRecord.element.offsetHeight || 0) * yRatio - Math.max((stage.clientHeight || 0) * 0.35, 0)
      : -8;
    const targetTop = Math.max(targetRecord.element.offsetTop + targetOffset, 0);
    const behavior = options.behavior === 'smooth' ? 'smooth' : 'auto';
    if (typeof stage.scrollTo === 'function') {
      try {
        stage.scrollTo({ top: targetTop, behavior });
      } catch {
        stage.scrollTop = targetTop;
      }
    } else {
      stage.scrollTop = targetTop;
    }
    if (behavior === 'auto') {
      updateCurrentPageFromScroll({ force: true });
    } else {
      scheduleScrollSync();
    }
  }

  Object.assign(ctx, {
    getDocumentScale,
    getScrollAnchor,
    restoreScrollAnchor,
    setStageScrollTop,
    cancelScrollSync,
    emitPageChange,
    updateCurrentPageFromScroll,
    scheduleScrollSync,
    goToPage
  });
};
