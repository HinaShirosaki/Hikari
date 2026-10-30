import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("papers");
import { clamp } from './pdf-viewer-anchors.js';
import { renderSearchHighlights } from './pdf-viewer-overlays.js';
import { escapeHtml } from './pdf-viewer-search.js';
import { messageSpan } from '../../../lib/i18n/markup.js';
import { paperMessage, paperNotice, paperUi } from '../localization.js';

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
      i18nUi.setText(selectionSearchCount, (total ? `${activeIndex + 1} / ${total}` : '0 / 0'));
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
      i18nUi.setHtml(selectionSearchResults, '');
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
    if (isError && message) {
      paperNotice(message, { type: 'error' });
    }
    if (!selectionSearchResults) {
      return;
    }
    const html = message?.i18nKey ? messageSpan(message.i18nKey, message.i18nParams) : escapeHtml(String(message || '').trim());
    i18nUi.setHtml(selectionSearchResults, html
      ? `<p class="${isError ? 'is-error' : 'small-note'}">${html}</p>`
      : '');
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
      renderSelectionSearchMessage(paperUi('search.noPdfMatches'));
      return;
    }
    const foundKey = pages.length === 1 ? 'search.foundOnePage' : 'search.foundPages';
    i18nUi.setHtml(selectionSearchResults, `<p class="small-note">${paperMessage(foundKey, { count: totalMatches, pages: pages.length })}</p>`);
  }

  function renderPaperDatabaseSearchResults(result = {}) {
    if (!selectionSearchResults) {
      return;
    }
    const matches = Array.isArray(result.matches) ? result.matches : [];
    if (!matches.length) {
      clearSelectionSearchMatches();
      renderSelectionSearchMessage(paperUi('search.noPapers'));
      return;
    }
    clearSelectionSearchMatches();
    i18nUi.setHtml(selectionSearchResults, `<p class="small-note">${paperMessage('search.foundPapers', { count: matches.length })}</p>`);
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
    renderSelectionSearchMessage(paperUi('search.choose'));
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
