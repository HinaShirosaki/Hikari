import { ZOOM_STEP } from './pdf-viewer-constants.js';

export const installPdfViewerEventsController = (ctx) => {
  const { elements, state } = ctx;
  const {
    stage,
    pageLayer,
    prevBtn,
    nextBtn,
    pageInput,
    zoomOutBtn,
    zoomInBtn,
    zoomResetBtn,
    fitWidthBtn,
    openExternalBtn,
    closeBtn,
    selectionHighlightBtn,
    selectionUnderlineBtn,
    selectionCommentBtn,
    selectionSearchBtn,
    selectionAskBtn,
    selectionSearchPdfBtn,
    selectionSearchLibraryBtn,
    selectionSearchPrevBtn,
    selectionSearchNextBtn,
    selectionCommentSaveBtn,
    selectionCommentCancelBtn,
    selectionCommentText
  } = elements;

  function bindEvents() {
    prevBtn?.addEventListener('click', () => {
      ctx.goToPage(state.pageNumber - 1, { behavior: 'smooth' });
    });
    nextBtn?.addEventListener('click', () => {
      ctx.goToPage(state.pageNumber + 1, { behavior: 'smooth' });
    });
    pageInput?.addEventListener('change', () => {
      ctx.goToPage(pageInput.value, { behavior: 'auto' });
    });
    zoomOutBtn?.addEventListener('click', () => {
      void ctx.adjustZoom(-ZOOM_STEP);
    });
    zoomInBtn?.addEventListener('click', () => {
      void ctx.adjustZoom(ZOOM_STEP);
    });
    zoomResetBtn?.addEventListener('click', () => {
      void ctx.resetZoom();
    });
    fitWidthBtn?.addEventListener('click', () => {
      void ctx.fitToWidth();
    });
    selectionHighlightBtn?.addEventListener('click', () => {
      ctx.createSelectionAnnotation('highlight');
    });
    selectionUnderlineBtn?.addEventListener('click', () => {
      ctx.createSelectionAnnotation('underline');
    });
    selectionCommentBtn?.addEventListener('click', () => {
      ctx.openSelectionCommentPopover();
    });
    selectionSearchBtn?.addEventListener('click', () => {
      ctx.openSelectionSearchPopover();
    });
    selectionAskBtn?.addEventListener('click', () => {
      ctx.askAgentAboutSelection();
    });
    selectionSearchPdfBtn?.addEventListener('click', () => {
      void ctx.runSelectionSearch('pdf');
    });
    selectionSearchLibraryBtn?.addEventListener('click', () => {
      void ctx.runSelectionSearch('library');
    });
    selectionSearchPrevBtn?.addEventListener('click', () => {
      ctx.activateSearchMatch(state.activeSearchMatchIndex - 1);
    });
    selectionSearchNextBtn?.addEventListener('click', () => {
      ctx.activateSearchMatch(state.activeSearchMatchIndex + 1);
    });
    selectionCommentSaveBtn?.addEventListener('click', () => {
      ctx.saveSelectionComment();
    });
    selectionCommentCancelBtn?.addEventListener('click', () => {
      ctx.hideSelectionCommentPopover();
      ctx.showSelectionMenu();
    });
    selectionCommentText?.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        ctx.saveSelectionComment();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        ctx.hideSelectionCommentPopover();
        ctx.showSelectionMenu();
      }
    });
    openExternalBtn?.addEventListener('click', () => {
      if (!state.paperId || typeof state.openExternal !== 'function') {
        return;
      }
      void state.openExternal(state.paperId);
    });
    closeBtn?.addEventListener('click', () => {
      void ctx.resetViewer();
    });
    stage?.addEventListener('scroll', ctx.handleStageScroll, { passive: true });
    pageLayer?.addEventListener('click', ctx.handleOverlayClick);
    pageLayer?.addEventListener('pointerdown', ctx.handleTextSelectionPointerDown);
    pageLayer?.addEventListener('pointermove', ctx.handleHighlightHover, { passive: true });
    pageLayer?.addEventListener('pointerleave', ctx.hideHighlightCommentPopover);

    const win = ctx.getWindowRef();
    const doc = ctx.getDocumentRef();
    if (typeof win?.addEventListener === 'function') {
      win.addEventListener('resize', ctx.handleResize);
      win.addEventListener('pointerup', ctx.handleTextSelectionPointerUp);
      win.addEventListener('blur', ctx.handleTextSelectionPointerUp);
    }
    if (typeof doc?.addEventListener === 'function') {
      doc.addEventListener('pointerdown', ctx.handleDocumentPointerDown);
      doc.addEventListener('selectionchange', ctx.schedulePendingSelectionUpdate);
      doc.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          ctx.hideSelectionMenu();
          ctx.hideSelectionCommentPopover();
          ctx.hideSelectionSearchPopover();
          ctx.hideHighlightCommentPopover();
        }
      });
    }

    if (stage && typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        ctx.handleResize();
      });
      observer.observe(stage);
    }
  }

  Object.assign(ctx, {
    bindEvents
  });
};
