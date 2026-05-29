import { clamp } from './pdf-viewer-anchors.js';
import { renderSearchHighlights } from './pdf-viewer-overlays.js';
import { escapeHtml } from './pdf-viewer-search.js';

export const installPdfViewerSearchUiController = (ctx) => {
  const { elements, state } = ctx;
  const {
    selectionMenu,
    selectionSearchPopover,
    selectionSearchPdfBtn,
    selectionSearchNav,
    selectionSearchPrevBtn,
    selectionSearchNextBtn,
    selectionSearchCount,
    selectionSearchResults
  } = elements;

  function getActiveSearchMatch() {
    return state.searchMatches[state.activeSearchMatchIndex] || null;
  }

  function updateSelectionSearchNav() {
    const total = state.searchMatches.length;
    const activeIndex = total ? clamp(state.activeSearchMatchIndex, 0, total - 1) : -1;
    if (selectionSearchNav) {
      selectionSearchNav.hidden = total <= 0;
    }
    if (selectionSearchPrevBtn) {
      selectionSearchPrevBtn.disabled = total <= 1;
    }
    if (selectionSearchNextBtn) {
      selectionSearchNextBtn.disabled = total <= 1;
    }
    if (selectionSearchCount) {
      selectionSearchCount.textContent = total ? `${activeIndex + 1} / ${total}` : '0 / 0';
    }
  }

  function paintSearchHighlights() {
    renderSearchHighlights({
      pageRecords: state.pageRecords,
      matches: state.searchMatches,
      activeMatchId: getActiveSearchMatch()?.id || '',
      activeTone: state.searchToneIndex
    });
  }

  function clearSelectionSearchMatches() {
    state.searchMatches = [];
    state.activeSearchMatchIndex = -1;
    state.searchToneIndex = 0;
    paintSearchHighlights();
    updateSelectionSearchNav();
  }

  function hideSelectionSearchPopover({ clearMatches = true } = {}) {
    state.pendingSearchSelection = null;
    if (selectionSearchPopover) {
      selectionSearchPopover.hidden = true;
    }
    if (selectionSearchResults) {
      selectionSearchResults.innerHTML = '';
    }
    if (clearMatches) {
      clearSelectionSearchMatches();
    }
  }

  function isSelectionSearchPopoverEvent(event) {
    const target = event?.target || null;
    return Boolean(
      target
      && (
        selectionSearchPopover?.contains?.(target)
        || selectionMenu?.contains?.(target)
      )
    );
  }

  function handleDocumentPointerDown(event) {
    if (
      selectionSearchPopover?.hidden === false
      && !isSelectionSearchPopoverEvent(event)
    ) {
      hideSelectionSearchPopover();
    }
  }

  function renderSelectionSearchMessage(message = '', isError = false) {
    if (!selectionSearchResults) {
      return;
    }
    const text = String(message || '').trim();
    selectionSearchResults.innerHTML = text
      ? `<p class="${isError ? 'is-error' : 'small-note'}">${escapeHtml(text)}</p>`
      : '';
  }

  function setPdfSearchMatches(matches = [], targetMatchIndex = 0) {
    state.searchMatches = Array.isArray(matches) ? matches : [];
    state.activeSearchMatchIndex = state.searchMatches.length
      ? clamp(Math.round(Number(targetMatchIndex) || 0), 0, state.searchMatches.length - 1)
      : -1;
    state.searchToneIndex = 0;
    updateSelectionSearchNav();
    paintSearchHighlights();
  }

  function renderPdfSearchResults(result = {}) {
    if (!selectionSearchResults) {
      return;
    }
    const pages = Array.isArray(result.pages) ? result.pages : [];
    const totalMatches = Math.max(0, Math.round(Number(result.totalMatches) || 0));
    if (!pages.length || totalMatches <= 0) {
      renderSelectionSearchMessage('No matching text was found in this PDF.');
      return;
    }
    const matchLabel = `${totalMatches} matched word${totalMatches === 1 ? '' : 's'}`;
    const pageLabel = `${pages.length} page${pages.length === 1 ? '' : 's'}`;
    selectionSearchResults.innerHTML = `<p class="small-note">Found ${escapeHtml(matchLabel)} on ${escapeHtml(pageLabel)}.</p>`;
  }

  function renderPaperDatabaseSearchResults(result = {}) {
    if (!selectionSearchResults) {
      return;
    }
    const matches = Array.isArray(result.matches) ? result.matches : [];
    if (!matches.length) {
      clearSelectionSearchMatches();
      renderSelectionSearchMessage('No matching papers were found in the paper database.');
      return;
    }
    clearSelectionSearchMatches();
    selectionSearchResults.innerHTML = `<p class="small-note">Found ${escapeHtml(String(matches.length))} matching paper${matches.length === 1 ? '' : 's'}.</p>`;
  }

  function openSelectionSearchPopover() {
    if (!state.pendingSelection || !selectionSearchPopover) {
      return;
    }
    state.pendingSearchSelection = { ...state.pendingSelection };
    ctx.hideSelectionMenu();
    ctx.hideSelectionCommentPopover();
    selectionSearchPopover.hidden = false;
    clearSelectionSearchMatches();
    renderSelectionSearchMessage('Choose where to search.');
    ctx.positionFloatingElement(selectionSearchPopover, state.pendingSearchSelection.clientRect, { preferBelow: true });
    selectionSearchPdfBtn?.focus?.();
  }

  Object.assign(ctx, {
    getActiveSearchMatch,
    updateSelectionSearchNav,
    paintSearchHighlights,
    clearSelectionSearchMatches,
    hideSelectionSearchPopover,
    handleDocumentPointerDown,
    renderSelectionSearchMessage,
    setPdfSearchMatches,
    renderPdfSearchResults,
    renderPaperDatabaseSearchResults,
    openSelectionSearchPopover
  });
};
