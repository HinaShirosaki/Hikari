import { copyPdfHighlightText } from './pdf-viewer-search.js';

export const installPdfViewerSelectionActionsController = (ctx) => {
  const { elements, state } = ctx;
  const {
    selectionCommentPopover,
    selectionCommentText
  } = elements;

  function askAgentAboutSelection() {
    if (!state.pendingSelection || typeof state.onSelectionAsk !== 'function') {
      return false;
    }
    const selection = { ...state.pendingSelection };
    const didOpen = state.onSelectionAsk({
      paperId: state.paperId,
      paperTitle: state.paperTitle,
      pageNumber: selection.pageNumber,
      text: selection.text,
      boxes: selection.boxes,
      pageWidth: selection.pageWidth,
      pageHeight: selection.pageHeight
    });
    if (didOpen === false) {
      return false;
    }
    ctx.clearSelection();
    state.pendingSelection = null;
    ctx.refreshToolbar();
    ctx.setStatus(`Loaded selected text from page ${selection.pageNumber} into chat context.`);
    return true;
  }

  function createSelectionAnnotation(kind = 'highlight') {
    if (!state.pendingSelection || typeof state.onHighlightSelection !== 'function') {
      return false;
    }
    const selection = {
      pageNumber: state.pendingSelection.pageNumber,
      text: state.pendingSelection.text,
      boxes: state.pendingSelection.boxes,
      pageWidth: state.pendingSelection.pageWidth,
      pageHeight: state.pendingSelection.pageHeight,
      kind
    };
    const didCreateHighlight = state.onHighlightSelection(selection);
    if (didCreateHighlight === false) {
      return false;
    }
    ctx.clearSelection();
    state.pendingSelection = null;
    ctx.refreshToolbar();
    ctx.setStatus(`${kind === 'underline' ? 'Underlined' : 'Highlighted'} selection on page ${selection.pageNumber}.`);
    return true;
  }

  async function copySelectedText() {
    const selection = state.pendingSelection;
    if (!selection) {
      return false;
    }
    const copied = await copyPdfHighlightText(selection.text, ctx.getWindowRef()?.navigator);
    ctx.setStatus(copied ? 'Copied selected text.' : 'Unable to copy selected text.');
    return copied;
  }

  function openSelectionCommentPopover() {
    if (!state.pendingSelection || !selectionCommentPopover) {
      return;
    }
    state.pendingCommentSelection = { ...state.pendingSelection };
    ctx.hideSelectionMenu();
    ctx.hideSelectionSearchPopover();
    selectionCommentPopover.hidden = false;
    if (selectionCommentText) {
      selectionCommentText.value = '';
    }
    ctx.positionFloatingElement(selectionCommentPopover, state.pendingSelection.clientRect, { preferBelow: true });
    selectionCommentText?.focus?.();
  }

  function saveSelectionComment() {
    const text = String(selectionCommentText?.value || '').trim();
    const selection = state.pendingCommentSelection || state.pendingSelection;
    if (!text || !selection || typeof state.onSelectionComment !== 'function') {
      return;
    }
    const didCreateComment = state.onSelectionComment({
      pageNumber: selection.pageNumber,
      text: selection.text,
      boxes: selection.boxes,
      pageWidth: selection.pageWidth,
      pageHeight: selection.pageHeight,
      commentText: text
    });
    if (didCreateComment === false) {
      return;
    }
    ctx.hideSelectionCommentPopover();
    ctx.clearSelection();
    state.pendingSelection = null;
    ctx.refreshToolbar();
    ctx.setStatus(`Saved comment on page ${selection.pageNumber}.`);
  }

  Object.assign(ctx, {
    askAgentAboutSelection,
    copySelectedText,
    createSelectionAnnotation,
    openSelectionCommentPopover,
    saveSelectionComment
  });
};
