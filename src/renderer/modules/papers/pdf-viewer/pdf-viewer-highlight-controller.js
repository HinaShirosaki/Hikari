import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("papers");
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
  buildHighlightCommentPopoverMarkup,
  buildHighlightPopoverMarkup,
  copyPdfHighlightText,
  normalizePdfHighlightText
} from './pdf-viewer-search.js';
import { setPaperAttribute } from '../localization.js';

export const installPdfViewerHighlightController = (ctx) => {
  const { elements, state } = ctx;
  const { pageLayer, shell, highlightCommentPopover, selectionMenu, selectionCommentPopover, selectionSearchPopover } = elements;
  let highlightPopoverHideTimer = 0;
  let activeHighlightId = '';
  let activeHighlightCopyText = '';
  let activeHighlight = null;

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
    activeHighlight = null;
    if (highlightCommentPopover) {
      highlightCommentPopover.hidden = true;
      i18nUi.setHtml(highlightCommentPopover, '');
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

  function showHighlightPopover(highlight, clientX, clientY) {
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
    activeHighlight = highlight;
    showAnnotationPopover(buildHighlightPopoverMarkup(highlight, {
      comment: getCommentForHighlight(highlight),
      canDelete: typeof state.onDeleteHighlight === 'function'
    }), clientX, clientY);
  }

  function showAnnotationPopover(markup, clientX, clientY) {
    i18nUi.setHtml(highlightCommentPopover, markup);
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
      showHighlightPopover(highlight, clientX, clientY);
    } else if (highlightCommentPopover && shell) {
      hideHighlightCommentPopover();
      showAnnotationPopover(buildHighlightCommentPopoverMarkup(comment), clientX, clientY);
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
      onPinSelect: (comment, event) => {
        const rect = event?.currentTarget?.getBoundingClientRect?.();
        state.onPinSelect?.(comment);
        showHighlightCommentPopover(comment, rect?.right ?? event?.clientX, rect?.top ?? event?.clientY);
      }
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
    showHighlightPopover(match.highlight, event.clientX, event.clientY);
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
    const button = event?.target?.closest?.('[data-paper-highlight-copy], [data-paper-highlight-ask], [data-paper-highlight-delete]') || null;
    if (!button || !highlightCommentPopover?.contains?.(button)) {
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    cancelHighlightPopoverHide();
    if (button.matches?.('[data-paper-highlight-delete]')) {
      if (!activeHighlight || typeof state.onDeleteHighlight !== 'function') {
        return;
      }
      const highlight = activeHighlight;
      const hasComment = Boolean(getCommentForHighlight(highlight));
      const didDelete = state.onDeleteHighlight({ paperId: state.paperId, highlightId: highlight.id });
      if (didDelete !== false) {
        hideHighlightCommentPopover();
        const label = highlight.kind === 'underline' ? 'underline' : 'highlight';
        ctx.setStatus(i18nUi.text("Deleted {p0}{p1}. Use Undo to restore.", { p0: label, p1: hasComment ? ' and comment' : '' }));
      }
      return;
    }
    if (button.matches?.('[data-paper-highlight-ask]')) {
      if (!activeHighlight || typeof state.onSelectionAsk !== 'function') {
        return;
      }
      const didOpen = state.onSelectionAsk({
        paperId: state.paperId,
        paperTitle: state.paperTitle,
        pageNumber: activeHighlight.pageNumber,
        text: activeHighlightCopyText,
        boxes: activeHighlight.boxes,
        pageWidth: activeHighlight.pageWidth,
        pageHeight: activeHighlight.pageHeight
      });
      if (didOpen !== false) {
        const pageNumber = activeHighlight.pageNumber;
        hideHighlightCommentPopover();
        ctx.setStatus(i18nUi.text("Loaded highlighted text from page {p0} into chat context.", { p0: pageNumber }));
      }
      return;
    }
    const copied = await copyPdfHighlightText(activeHighlightCopyText, ctx.getWindowRef()?.navigator);
    ctx.setStatus((((((copied ? i18nUi.text("Copied highlighted text.") : i18nUi.text("Unable to copy highlighted text.")))))));
    button.classList?.toggle?.('is-copied', copied);
    setPaperAttribute(button, 'aria-label', copied ? 'highlight.copied' : 'highlight.copy');
    setPaperAttribute(button, 'title', copied ? 'highlight.copiedTitle' : 'highlight.copy');
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
