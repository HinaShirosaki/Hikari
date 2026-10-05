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
    renderContextActions();
    selectionMenu.hidden = false;
    ctx.positionFloatingElement(selectionMenu, state.pendingSelection.clientRect);
  }

  function renderContextActions() {
    if (!selectionMenu) return;
    selectionMenu.querySelectorAll?.('[data-plugin-context-action]')?.forEach(node => node.remove());
    const doc = selectionMenu.ownerDocument;
    for (const action of state.getContextActions?.() || []) {
      const button = doc.createElement('button');
      button.type = 'button'; button.className = 'ghost-btn papers-selection-action-btn';
      button.dataset.pluginContextAction = action.key;
      button.dataset.hoverCaption = action.label;
      button.setAttribute('aria-label', action.label);
      if (action.requiresAgent) button.setAttribute('data-requires-agent', '');
      // Host-owned icon: plugin actions supply labels and IDs, never SVG/HTML.
      button.innerHTML = '<svg class="papers-selection-action-icon papers-selection-action-icon--context" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg>';
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', async () => {
        const selection = state.pendingSelection;
        if (!selection || !state.onContextAction) return;
        const paperId = state.paperId;
        button.disabled = true;
        try {
          const result = await state.onContextAction(action.key, { paperId, text: selection.text, pageNumber: selection.pageNumber });
          if (result?.ok === false) { ctx.setStatus(result.error || 'Could not open the plugin action.'); return; }
          if (state.paperId === paperId && state.pendingSelection === selection) {
            clearSelection(); state.pendingSelection = null; ctx.refreshToolbar();
          }
        } catch (error) { ctx.setStatus(error.message); }
        finally { button.disabled = false; }
      });
      selectionMenu.append(button);
    }
  }
  selectionMenu?.ownerDocument?.addEventListener('hikari:context-actions-changed', () => {
    if (!selectionMenu.hidden) renderContextActions();
  });

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
