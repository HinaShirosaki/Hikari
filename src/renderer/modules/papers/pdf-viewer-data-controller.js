import { computePdfAnchorFromClientPoint } from './pdf-viewer-anchors.js';
import {
  normalizeCommentList,
  normalizeHighlightList
} from './pdf-viewer-normalizers.js';

export const installPdfViewerDataController = (ctx) => {
  const { elements, state } = ctx;
  const { pageLayer } = elements;

  function setComments(comments = []) {
    state.comments = normalizeCommentList(comments);
    ctx.hideHighlightCommentPopover();
    ctx.paintPins();
  }

  function setHighlights(highlights = []) {
    state.highlights = normalizeHighlightList(highlights);
    ctx.hideHighlightCommentPopover();
    ctx.paintHighlights();
  }

  function setSelectedCommentId(commentId = '') {
    state.selectedCommentId = String(commentId || '').trim();
    ctx.paintPins();
  }

  function setPlacementMode(enabled) {
    state.placementMode = Boolean(enabled) && ctx.hasActiveDocument();
    if (state.placementMode) {
      ctx.clearSelection();
      state.pendingSelection = null;
    }
    ctx.refreshToolbar();
    ctx.paintPins();
  }

  function handleOverlayClick(event) {
    if (!state.placementMode || !ctx.hasActiveDocument() || typeof state.onPlacement !== 'function') {
      return;
    }

    const overlayElement = event?.target?.closest?.('.papers-viewer-overlay');
    if (!overlayElement || !pageLayer?.contains?.(overlayElement)) {
      return;
    }

    const rect = overlayElement.getBoundingClientRect?.();
    const anchor = computePdfAnchorFromClientPoint({
      clientX: event?.clientX,
      clientY: event?.clientY,
      rect
    });
    if (!anchor) {
      return;
    }

    const pageNumber = Math.max(1, Math.round(Number(overlayElement.dataset.pageNumber) || state.pageNumber || 1));
    state.onPlacement({
      pageNumber,
      anchorX: anchor.anchorX,
      anchorY: anchor.anchorY
    });
  }

  function handleResize() {
    ctx.hideSelectionMenu();
    ctx.hideSelectionCommentPopover();
    ctx.hideSelectionSearchPopover();
    ctx.hideHighlightCommentPopover();
    if (!state.pdfDocument) {
      ctx.paintHighlights();
      ctx.paintPins();
      return;
    }
    if (state.fitWidth) {
      void ctx.renderDocumentPages({ preserveScroll: true });
      return;
    }
    ctx.paintPins();
    ctx.updateCurrentPageFromScroll({ force: true });
    ctx.scheduleVisiblePageRender?.();
  }

  function handleStageScroll() {
    ctx.hideSelectionMenu();
    ctx.hideSelectionCommentPopover();
    if (!state.searchMatches.length) {
      ctx.hideSelectionSearchPopover();
    }
    ctx.hideHighlightCommentPopover();
    ctx.scheduleScrollSync();
    ctx.scheduleVisiblePageRender?.();
  }

  Object.assign(ctx, {
    setComments,
    setHighlights,
    setSelectedCommentId,
    setPlacementMode,
    handleOverlayClick,
    handleResize,
    handleStageScroll
  });
};
