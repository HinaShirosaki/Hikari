import { clamp } from './pdf-viewer-anchors.js';
import {
  renderHighlights,
  renderPins
} from './pdf-viewer-overlays.js';
import { buildHighlightCommentPopoverMarkup } from './pdf-viewer-search.js';

export const installPdfViewerHighlightController = (ctx) => {
  const { elements, state } = ctx;
  const { pageLayer, shell, highlightCommentPopover, selectionMenu, selectionCommentPopover, selectionSearchPopover } = elements;

  function hideHighlightCommentPopover() {
    if (highlightCommentPopover) {
      highlightCommentPopover.hidden = true;
      highlightCommentPopover.innerHTML = '';
    }
  }

  function showHighlightCommentPopover(comment, clientX, clientY) {
    if (!highlightCommentPopover || !comment || !shell) {
      return;
    }
    highlightCommentPopover.innerHTML = buildHighlightCommentPopoverMarkup(comment);
    highlightCommentPopover.hidden = false;
    const shellRect = shell.getBoundingClientRect?.();
    const rawLeft = (Number(clientX) || 0) - Number(shellRect?.left || 0) + 12;
    const rawTop = (Number(clientY) || 0) - Number(shellRect?.top || 0) + 12;
    const next = ctx.clampShellPosition(rawLeft, rawTop, highlightCommentPopover);
    highlightCommentPopover.style.left = `${Math.round(next.left)}px`;
    highlightCommentPopover.style.top = `${Math.round(next.top)}px`;
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

  function findCommentAtClientPoint(clientX, clientY) {
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
    for (let index = pageHighlights.length - 1; index >= 0; index -= 1) {
      const highlight = pageHighlights[index];
      const comment = getCommentForHighlight(highlight);
      if (!comment) {
        continue;
      }
      const boxes = Array.isArray(highlight.boxes) ? highlight.boxes : [];
      const matched = boxes.some((box) => {
        const left = Number(box.x) || 0;
        const top = Number(box.y) || 0;
        const right = left + (Number(box.width) || 0);
        const bottom = top + (Number(box.height) || 0);
        return x >= left && x <= right && y >= top && y <= bottom;
      });
      if (matched) {
        return comment;
      }
    }
    return null;
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
    const comment = findCommentAtClientPoint(event?.clientX, event?.clientY);
    if (!comment) {
      hideHighlightCommentPopover();
      return;
    }
    showHighlightCommentPopover(comment, event.clientX, event.clientY);
  }

  Object.assign(ctx, {
    hideHighlightCommentPopover,
    showHighlightCommentPopover,
    paintHighlights,
    paintPins,
    getCommentForHighlight,
    findCommentAtClientPoint,
    handleHighlightHover
  });
};
