import { clamp } from './pdf-viewer-anchors.js';
import {
  normalizeHighlightBoxes,
  normalizePageDimension,
  pdfQuadPointsToBoxes
} from './pdf-viewer-geometry.js';
import {
  renderHighlights,
  renderPins
} from './pdf-viewer-overlays.js';
import {
  buildHighlightPopoverMarkup,
  copyPdfHighlightText,
  normalizePdfHighlightText
} from './pdf-viewer-search.js';

export const installPdfViewerHighlightController = (ctx) => {
  const { elements, state } = ctx;
  const { pageLayer, shell, highlightCommentPopover, selectionMenu, selectionCommentPopover, selectionSearchPopover } = elements;
  let highlightPopoverHideTimer = 0;
  let activeHighlightId = '';
  let activeHighlightCopyText = '';

  function cancelHighlightPopoverHide() {
    if (!highlightPopoverHideTimer) {
      return;
    }
    const win = ctx.getWindowRef();
    if (typeof win?.clearTimeout === 'function') {
      win.clearTimeout(highlightPopoverHideTimer);
    } else {
      clearTimeout(highlightPopoverHideTimer);
    }
    highlightPopoverHideTimer = 0;
  }

  function hideHighlightCommentPopover() {
    cancelHighlightPopoverHide();
    activeHighlightId = '';
    activeHighlightCopyText = '';
    if (highlightCommentPopover) {
      highlightCommentPopover.hidden = true;
      highlightCommentPopover.innerHTML = '';
    }
  }

  function scheduleHighlightPopoverHide(delay = 160) {
    cancelHighlightPopoverHide();
    const win = ctx.getWindowRef();
    if (typeof win?.setTimeout !== 'function') {
      hideHighlightCommentPopover();
      return;
    }
    highlightPopoverHideTimer = win.setTimeout(() => {
      highlightPopoverHideTimer = 0;
      hideHighlightCommentPopover();
    }, Math.max(0, Number(delay) || 0));
  }

  function showHighlightPopover(highlight, comment, clientX, clientY) {
    if (!highlightCommentPopover || !highlight || !shell) {
      return;
    }
    const copyText = normalizePdfHighlightText(highlight.text);
    const highlightId = String(highlight.id || '').trim();
    if (!copyText) {
      hideHighlightCommentPopover();
      return;
    }
    cancelHighlightPopoverHide();
    if (highlightId && activeHighlightId === highlightId && highlightCommentPopover.hidden === false) {
      return;
    }
    activeHighlightId = highlightId;
    activeHighlightCopyText = copyText;
    highlightCommentPopover.innerHTML = buildHighlightPopoverMarkup(highlight, comment);
    highlightCommentPopover.hidden = false;
    const shellRect = shell.getBoundingClientRect?.();
    const rawLeft = (Number(clientX) || 0) - Number(shellRect?.left || 0) + 12;
    const rawTop = (Number(clientY) || 0) - Number(shellRect?.top || 0) + 12;
    const next = ctx.clampShellPosition(rawLeft, rawTop, highlightCommentPopover);
    highlightCommentPopover.style.left = `${Math.round(next.left)}px`;
    highlightCommentPopover.style.top = `${Math.round(next.top)}px`;
  }

  function showHighlightCommentPopover(comment, clientX, clientY) {
    if (!comment) {
      return;
    }
    const highlightId = String(comment.highlightId || '').trim();
    const commentId = String(comment.id || '').trim();
    const highlight = state.highlights.find((item) => (
      (highlightId && String(item.id || '').trim() === highlightId)
      || (commentId && String(item.commentId || '').trim() === commentId)
    )) || null;
    if (highlight) {
      showHighlightPopover(highlight, comment, clientX, clientY);
    }
  }

  function paintHighlights() {
    renderHighlights({
      pageRecords: state.pageRecords,
      highlights: state.highlights
    });
    ctx.paintSearchHighlights();
  }

  function paintPins() {
    renderPins({
      pageRecords: state.pageRecords,
      comments: state.comments,
      selectedCommentId: state.selectedCommentId,
      placementMode: state.placementMode,
      isActive: ctx.hasActiveDocument(),
      onPinSelect: state.onPinSelect
    });
  }

  function getCommentForHighlight(highlight) {
    const commentId = String(highlight?.commentId || '').trim();
    if (commentId) {
      return state.comments.find((comment) => comment.id === commentId) || null;
    }
    const highlightId = String(highlight?.id || '').trim();
    if (!highlightId) {
      return null;
    }
    return state.comments.find((comment) => String(comment.highlightId || '').trim() === highlightId) || null;
  }

  function getHighlightBoxesForHitTest(highlight, record) {
    const boxes = normalizeHighlightBoxes(highlight?.boxes);
    if (boxes.length) {
      return boxes;
    }
    const pageWidth = normalizePageDimension(highlight?.pageWidth || record?.metric?.width);
    const pageHeight = normalizePageDimension(highlight?.pageHeight || record?.metric?.height);
    return pdfQuadPointsToBoxes(highlight?.quadPoints, { pageWidth, pageHeight });
  }

  function findHighlightAtClientPoint(clientX, clientY) {
    const targetElement = ctx.getDocumentRef()?.elementFromPoint?.(clientX, clientY) || null;
    const pageElement = targetElement?.closest?.('.papers-viewer-page') || null;
    if (!pageElement || !pageLayer?.contains?.(pageElement)) {
      return null;
    }
    const pageNumber = Math.max(1, Math.round(Number(pageElement.dataset.pageNumber) || 1));
    const rect = pageElement.getBoundingClientRect?.();
    const width = Number(rect?.width) || 0;
    const height = Number(rect?.height) || 0;
    if (width <= 0 || height <= 0) {
      return null;
    }
    const x = clamp((Number(clientX) - Number(rect.left || 0)) / width, 0, 1);
    const y = clamp((Number(clientY) - Number(rect.top || 0)) / height, 0, 1);
    const pageHighlights = state.highlights.filter((highlight) => highlight.pageNumber === pageNumber);
    const pageRecord = state.pageRecords.find((record) => record?.pageNumber === pageNumber) || null;
    for (let index = pageHighlights.length - 1; index >= 0; index -= 1) {
      const highlight = pageHighlights[index];
      const boxes = getHighlightBoxesForHitTest(highlight, pageRecord);
      const matched = boxes.some((box) => {
        const left = Number(box.x) || 0;
        const top = Number(box.y) || 0;
        const right = left + (Number(box.width) || 0);
        const bottom = top + (Number(box.height) || 0);
        return x >= left && x <= right && y >= top && y <= bottom;
      });
      if (matched) {
        return {
          highlight,
          comment: getCommentForHighlight(highlight)
        };
      }
    }
    return null;
  }

  function findCommentAtClientPoint(clientX, clientY) {
    return findHighlightAtClientPoint(clientX, clientY)?.comment || null;
  }

  function handleHighlightHover(event) {
    if (
      !ctx.hasActiveDocument()
      || selectionMenu?.hidden === false
      || selectionCommentPopover?.hidden === false
      || selectionSearchPopover?.hidden === false
    ) {
      hideHighlightCommentPopover();
      return;
    }
    const match = findHighlightAtClientPoint(event?.clientX, event?.clientY);
    if (!match) {
      scheduleHighlightPopoverHide();
      return;
    }
    showHighlightPopover(match.highlight, match.comment, event.clientX, event.clientY);
  }

  function handleHighlightPageLeave(event) {
    if (highlightCommentPopover?.contains?.(event?.relatedTarget)) {
      cancelHighlightPopoverHide();
      return;
    }
    scheduleHighlightPopoverHide();
  }

  function handleHighlightPopoverEnter() {
    cancelHighlightPopoverHide();
  }

  function handleHighlightPopoverLeave(event) {
    if (pageLayer?.contains?.(event?.relatedTarget)) {
      cancelHighlightPopoverHide();
      return;
    }
    scheduleHighlightPopoverHide(100);
  }

  async function handleHighlightPopoverClick(event) {
    const button = event?.target?.closest?.('[data-paper-highlight-copy]') || null;
    if (!button || !highlightCommentPopover?.contains?.(button)) {
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    cancelHighlightPopoverHide();
    const copied = await copyPdfHighlightText(activeHighlightCopyText, ctx.getWindowRef()?.navigator);
    const status = highlightCommentPopover.querySelector?.('[data-paper-highlight-copy-status]') || null;
    if (status) {
      status.textContent = copied ? 'Copied' : 'Copy unavailable';
    }
    button.classList?.toggle?.('is-copied', copied);
    button.setAttribute?.('aria-label', copied ? 'Highlighted text copied' : 'Copy highlighted text');
    button.setAttribute?.('title', copied ? 'Copied' : 'Copy highlighted text');
  }

  Object.assign(ctx, {
    cancelHighlightPopoverHide,
    hideHighlightCommentPopover,
    scheduleHighlightPopoverHide,
    showHighlightPopover,
    showHighlightCommentPopover,
    paintHighlights,
    paintPins,
    getCommentForHighlight,
    findHighlightAtClientPoint,
    findCommentAtClientPoint,
    handleHighlightHover,
    handleHighlightPageLeave,
    handleHighlightPopoverEnter,
    handleHighlightPopoverLeave,
    handleHighlightPopoverClick
  });
};
