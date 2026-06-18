import { getSelectionInfo } from './pdf-viewer-selection.js';

export const installPdfViewerSelectionMenuController = (ctx) => {
  const { elements, state } = ctx;
  const {
    pageLayer,
    selectionMenu,
    selectionCommentPopover,
    selectionCommentText,
    selectionSearchPopover
  } = elements;

  function hideSelectionMenu() {
    if (selectionMenu) {
      selectionMenu.hidden = true;
    }
  }

  function showSelectionMenu() {
    if (
      !selectionMenu
      || !state.pendingSelection?.clientRect
      || selectionCommentPopover?.hidden === false
      || selectionSearchPopover?.hidden === false
    ) {
      return;
    }
    selectionMenu.hidden = false;
    ctx.positionFloatingElement(selectionMenu, state.pendingSelection.clientRect);
  }

  function hideSelectionCommentPopover() {
    state.pendingCommentSelection = null;
    if (selectionCommentPopover) {
      selectionCommentPopover.hidden = true;
    }
    if (selectionCommentText) {
      selectionCommentText.value = '';
    }
  }

  function clearSelection() {
    try {
      ctx.getSelectionRef()?.removeAllRanges?.();
    } catch {}
    state.selectionPointerDown = false;
    hideSelectionMenu();
    hideSelectionCommentPopover();
    ctx.hideSelectionSearchPopover?.();
  }

  function updatePendingSelection() {
    state.selectionFrame = 0;
    if (
      selectionCommentPopover?.hidden === false
      || selectionSearchPopover?.hidden === false
    ) {
      ctx.refreshToolbar();
      return;
    }
    if (!ctx.hasActiveDocument() || !pageLayer || state.placementMode) {
      state.pendingSelection = null;
    } else {
      state.pendingSelection = getSelectionInfo({
        selection: ctx.getSelectionRef(),
        pageLayer
      });
    }
    if (state.pendingSelection) {
      hideSelectionCommentPopover();
      ctx.hideSelectionSearchPopover?.();
      showSelectionMenu();
    } else {
      hideSelectionMenu();
      hideSelectionCommentPopover();
      ctx.hideSelectionSearchPopover?.();
    }
    ctx.refreshToolbar();
  }

  function schedulePendingSelectionUpdate() {
    if (state.selectionPointerDown) {
      return;
    }
    const win = ctx.getWindowRef();
    if (state.selectionFrame) {
      return;
    }
    const callback = () => updatePendingSelection();
    if (typeof win?.requestAnimationFrame === 'function') {
      state.selectionFrame = win.requestAnimationFrame(callback);
    } else {
      state.selectionFrame = 1;
      setTimeout(callback, 0);
    }
  }

  function handleTextSelectionPointerDown(event) {
    const textLayer = event?.target?.closest?.('.papers-viewer-text-layer') || null;
    if (!textLayer || !pageLayer?.contains?.(textLayer) || state.placementMode) {
      return;
    }
    state.selectionPointerDown = true;
  }

  function handleTextSelectionPointerUp() {
    if (!state.selectionPointerDown) {
      return;
    }
    state.selectionPointerDown = false;
    schedulePendingSelectionUpdate();
  }

  Object.assign(ctx, {
    hideSelectionMenu,
    showSelectionMenu,
    hideSelectionCommentPopover,
    clearSelection,
    updatePendingSelection,
    schedulePendingSelectionUpdate,
    handleTextSelectionPointerDown,
    handleTextSelectionPointerUp
  });
};
