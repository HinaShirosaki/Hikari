import { releasePageRecords } from './pdf-viewer-page-records.js';
import { DEFAULT_ZOOM } from './pdf-viewer-constants.js';

export const installPdfViewerToolbarController = (ctx) => {
  const { elements, state } = ctx;
  const {
    shell,
    emptyState,
    workspace,
    stage,
    pageLayer,
    toolbar,
    prevBtn,
    nextBtn,
    pageInput,
    pageCount,
    zoomOutBtn,
    zoomInBtn,
    zoomResetBtn,
    fitWidthBtn,
    zoomLabel,
    openExternalBtn,
    closeBtn
  } = elements;

  function refreshToolbar() {
    const active = ctx.hasActiveDocument();
    if (toolbar) toolbar.hidden = !active;
    if (emptyState) emptyState.hidden = active;
    if (workspace) workspace.hidden = !active;
    if (stage) stage.hidden = !active;
    if (shell) shell.classList.toggle('is-empty', !active);
    if (prevBtn) prevBtn.disabled = !active || state.pageNumber <= 1;
    if (nextBtn) nextBtn.disabled = !active || state.pageNumber >= state.pageCount;
    if (pageInput) {
      pageInput.disabled = !active;
      pageInput.value = active ? String(state.pageNumber) : '1';
      pageInput.min = '1';
      pageInput.max = String(Math.max(state.pageCount, 1));
    }
    if (pageCount) {
      pageCount.textContent = active ? `/ ${state.pageCount}` : '/ 0';
    }
    [zoomOutBtn, zoomInBtn, zoomResetBtn, fitWidthBtn, openExternalBtn, closeBtn]
      .forEach((button) => {
        if (button) button.disabled = !active;
      });
    if (zoomLabel) {
      const percent = Math.round((state.fitWidth && !active ? DEFAULT_ZOOM : state.zoom) * 100);
      zoomLabel.textContent = active
        ? `${Math.round(state.zoom * 100)}%${state.fitWidth ? ' fit' : ''}`
        : `${percent}%`;
    }
  }

  function renderEmptyViewer(message = '') {
    ctx.cancelScrollSync();
    releasePageRecords({ pageLayer, pageRecords: state.pageRecords });
    state.pageRecords = [];
    state.paperId = '';
    state.paperTitle = '';
    state.paperMeta = '';
    state.pageNumber = 1;
    state.pageCount = 0;
    state.pageMetrics = [];
    state.maxBasePageWidth = 0;
    state.zoom = DEFAULT_ZOOM;
    state.fitWidth = true;
    state.comments = [];
    state.highlights = [];
    state.bookmarks = [];
    state.selectedCommentId = '';
    state.pendingSelection = null;
    state.pendingCommentSelection = null;
    state.pendingSearchSelection = null;
    state.placementMode = false;
    ctx.hideSelectionMenu();
    ctx.hideSelectionCommentPopover();
    ctx.hideSelectionSearchPopover();
    ctx.hideHighlightCommentPopover();
    ctx.setStageScrollTop(0);
    ctx.setTitle('No paper selected');
    ctx.setMeta('');
    ctx.setStatus(message || '', false);
    refreshToolbar();
  }

  Object.assign(ctx, {
    refreshToolbar,
    renderEmptyViewer
  });
};
