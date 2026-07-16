import { getPaperDisplayTitle } from '../pdf-metadata.js';

export function capturePreviousOpenState(state) {
  return {
    paperId: state.paperId,
    paperTitle: state.paperTitle,
    paperMeta: state.paperMeta,
    pageNumber: state.pageNumber,
    pageCount: state.pageCount,
    pageMetrics: state.pageMetrics,
    maxBasePageWidth: state.maxBasePageWidth,
    zoom: state.zoom,
    fitWidth: state.fitWidth,
    comments: state.comments,
    highlights: state.highlights,
    bookmarks: state.bookmarks,
    selectedCommentId: state.selectedCommentId,
    pendingSelection: state.pendingSelection,
    pendingSearchSelection: state.pendingSearchSelection,
    pendingNavigationPageNumber: state.pendingNavigationPageNumber,
    placementMode: state.placementMode,
    pdfDocument: state.pdfDocument
  };
}

export function applyPaperOpenShellState(ctx, { paper, summary = '', resolveBytes, onOpenExternal } = {}) {
  const { state } = ctx;
  state.resolveBytes = resolveBytes;
  state.openExternal = typeof onOpenExternal === 'function' ? onOpenExternal : null;
  state.paperId = String(paper.id || '');
  state.paperTitle = getPaperDisplayTitle(paper);
  state.paperMeta = summary || String(paper.fileName || '').trim() || 'PDF preview';
  state.comments = [];
  state.highlights = [];
  state.bookmarks = [];
  state.selectedCommentId = '';
  state.pendingSelection = null;
  state.pendingCommentSelection = null;
  state.pendingSearchSelection = null;
  state.pendingNavigationPageNumber = 0;
  state.placementMode = false;
  ctx.hideSelectionMenu();
  ctx.hideSelectionCommentPopover();
  ctx.hideSelectionSearchPopover();
  ctx.hideHighlightCommentPopover();
  ctx.emitBookmarksResolved();
}

export function restorePreviousOpenState(ctx, previousState) {
  const { state } = ctx;
  state.paperId = previousState.paperId;
  state.paperTitle = previousState.paperTitle;
  state.paperMeta = previousState.paperMeta;
  state.pageNumber = previousState.pageNumber;
  state.pageCount = previousState.pageCount;
  state.pageMetrics = previousState.pageMetrics;
  state.maxBasePageWidth = previousState.maxBasePageWidth;
  state.zoom = previousState.zoom;
  state.fitWidth = previousState.fitWidth;
  state.comments = previousState.comments;
  state.highlights = previousState.highlights;
  state.bookmarks = previousState.bookmarks;
  state.selectedCommentId = previousState.selectedCommentId;
  state.pendingSelection = previousState.pendingSelection;
  state.pendingSearchSelection = previousState.pendingSearchSelection;
  state.pendingNavigationPageNumber = previousState.pendingNavigationPageNumber || 0;
  state.placementMode = previousState.placementMode;
  ctx.emitBookmarksResolved();
  ctx.setTitle(state.paperTitle);
  ctx.setMeta(state.paperMeta);
  ctx.paintHighlights();
  ctx.paintPins();
}
