import { createPresentation } from "../../../lib/i18n/presentation.js";
const i18nUi = createPresentation("papers");
import { copyPdfHighlightText } from './pdf-viewer-search.js';
import { paperUi } from '../localization.js';

export const installPdfViewerSelectionActionsController = (ctx) => {
  const { elements, state } = ctx;
  const {
    stage,
    selectionMenu,
    selectionCommentBtn,
    selectionCommentPopover,
    selectionCommentSaveBtn,
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
    ctx.setStatus(i18nUi.text("Loaded selected text from page {p0} into chat context.", { p0: selection.pageNumber }));
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
    ctx.setStatus(i18nUi.text("{p0} selection on page {p1}.", { p0: kind === 'underline' ? 'Underlined' : 'Highlighted', p1: selection.pageNumber }));
    return true;
  }

  async function copySelectedText() {
    const selection = state.pendingSelection;
    if (!selection) {
      return false;
    }
    const copied = await copyPdfHighlightText(selection.text, ctx.getWindowRef()?.navigator);
    ctx.setStatus((((((copied ? i18nUi.text("Copied selected text.") : i18nUi.text("Unable to copy selected text.")))))));
    return copied;
  }

  function openSelectionCommentPopover() {
    const selection = state.pendingSelection;
    if (!selection?.clientRect || !selectionCommentPopover || !state.onSelectionComment) {
      return;
    }
    state.pendingCommentSelection = selection;
    ctx.hideSelectionMenu();
    ctx.hideSelectionSearchPopover();
    ctx.hideHighlightCommentPopover();
    selectionCommentPopover.hidden = false;
    ctx.positionFloatingElement(selectionCommentPopover, selection.clientRect, { preferBelow: true, allowFlip: true });
    selectionCommentText?.focus({ preventScroll: true });
  }

  function clampSelectionCommentPopover() {
    if (!selectionCommentPopover || selectionCommentPopover.hidden) {
      return;
    }
    const { style } = selectionCommentPopover;
    const { left, top } = ctx.clampShellPosition(parseFloat(style.left), parseFloat(style.top), selectionCommentPopover);
    style.left = `${Math.round(left)}px`;
    style.top = `${Math.round(top)}px`;
  }

  function updateSelectionCommentInput() {
    if (selectionCommentSaveBtn) {
      selectionCommentSaveBtn.disabled = !selectionCommentText?.value.trim();
    }
  }

  function cancelSelectionComment() {
    ctx.hideSelectionCommentPopover();
    ctx.updatePendingSelection();
    const focusTarget = selectionMenu && !selectionMenu.hidden ? selectionCommentBtn : stage;
    focusTarget?.focus({ preventScroll: true });
  }

  function saveSelectionComment() {
    const text = selectionCommentText?.value.trim();
    const selection = state.pendingCommentSelection;
    if (!text || !selection || !state.onSelectionComment) {
      return;
    }
    // The history service coalesces saves made from the same focused editor.
    stage?.focus({ preventScroll: true });
    const didCreateComment = state.onSelectionComment({
      pageNumber: selection.pageNumber,
      text: selection.text,
      boxes: selection.boxes,
      pageWidth: selection.pageWidth,
      pageHeight: selection.pageHeight,
      commentText: text
    });
    if (didCreateComment === false) {
      selectionCommentText.focus({ preventScroll: true });
      ctx.setStatus(paperUi('comment.saveFailed'), true);
      return;
    }
    ctx.clearSelection();
    state.pendingSelection = null;
    ctx.refreshToolbar();
    ctx.setStatus(i18nUi.text("Saved comment on page {p0}.", { p0: selection.pageNumber }));
  }

  Object.assign(ctx, {
    askAgentAboutSelection,
    copySelectedText,
    createSelectionAnnotation,
    openSelectionCommentPopover,
    clampSelectionCommentPopover,
    updateSelectionCommentInput,
    cancelSelectionComment,
    saveSelectionComment
  });
};
