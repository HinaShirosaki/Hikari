import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("papers");
import { getTextLayerRangeInfo } from './pdf-viewer-selection.js';
import {
  buildPdfSelectionSearchResultFromMatches,
  getPdfSelectionSearchTerms
} from './pdf-viewer-search.js';
import { renderPageTextLayerRecord } from './pdf-viewer-rendering.js';
import { paperFailure, paperUi } from '../localization.js';

export const installPdfViewerSearchExecutionController = (ctx) => {
  const { state } = ctx;

  function buildSearchMatchId(pageNumber, term, index) {
    return `search-${pageNumber}-${index}-${String(term || '').replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}`;
  }

  async function ensurePdfSearchTextLayers() {
    if (!state.pdfDocument || !state.pageRecords.length) {
      return false;
    }
    const activeRenderToken = ++state.renderToken;
    const isStale = () => activeRenderToken !== state.renderToken;
    const scale = ctx.getDocumentScale();
    for (const record of state.pageRecords) {
      if (isStale()) {
        return false;
      }
      if (record.renderedTextScale === scale && record.textLayer?.childElementCount > 0) {
        continue;
      }
      ctx.setStatus(i18nUi.text("Preparing PDF search... page {p0} of {p1}", { p0: record.pageNumber, p1: state.pageCount }));
      await renderPageTextLayerRecord({
        pdfDocument: state.pdfDocument,
        record,
        scale,
        isStale
      });
    }
    return !isStale();
  }

  async function collectPdfSearchMatches(queryText = '') {
    const terms = getPdfSelectionSearchTerms(queryText);
    if (!terms.length) {
      return [];
    }
    const ready = await ensurePdfSearchTextLayers();
    if (!ready) {
      return [];
    }
    const matches = [];
    state.pageRecords.forEach((record) => {
      const textLayer = record?.textLayer || null;
      const doc = textLayer?.ownerDocument || null;
      if (!textLayer || !doc?.createTreeWalker || !doc?.createRange) {
        return;
      }
      const walker = doc.createTreeWalker(textLayer, 4);
      let node = walker.nextNode();
      while (node) {
        const sourceText = String(node.nodeValue || '');
        const sourceLower = sourceText.toLowerCase();
        terms.forEach((term) => {
          let index = sourceLower.indexOf(term);
          while (index >= 0) {
            const range = doc.createRange();
            try {
              range.setStart(node, index);
              range.setEnd(node, index + term.length);
              const info = getTextLayerRangeInfo({ textLayer, range });
              if (info?.boxes?.length) {
                matches.push({
                  id: buildSearchMatchId(record.pageNumber, term, matches.length + 1),
                  pageNumber: record.pageNumber,
                  term,
                  text: sourceText.slice(index, index + term.length),
                  boxes: info.boxes,
                  clientRect: info.clientRect
                });
              }
            } finally {
              range.detach?.();
            }
            index = sourceLower.indexOf(term, index + Math.max(term.length, 1));
          }
        });
        node = walker.nextNode();
      }
    });
    return buildPdfSelectionSearchResultFromMatches(matches, state.pageNumber).matches;
  }

  function scrollToSearchMatch(match, { behavior = 'smooth' } = {}) {
    const firstBox = Array.isArray(match?.boxes) ? match.boxes[0] : null;
    ctx.goToPage(match?.pageNumber, {
      behavior,
      yRatio: Number(firstBox?.y) || 0
    });
  }

  function activateSearchMatch(index, { jump = true, cycleTone = true } = {}) {
    const total = state.searchMatches.length;
    if (!total) {
      ctx.updateSelectionSearchNav();
      ctx.paintSearchHighlights();
      return;
    }
    const nextIndex = ((Math.round(Number(index) || 0) % total) + total) % total;
    state.activeSearchMatchIndex = nextIndex;
    if (cycleTone) {
      state.searchToneIndex = (state.searchToneIndex + 1) % 4;
    }
    ctx.updateSelectionSearchNav();
    ctx.paintSearchHighlights();
    const match = ctx.getActiveSearchMatch();
    if (jump && match) {
      scrollToSearchMatch(match);
      ctx.setStatus(i18nUi.text("Showing match {p0} of {p1} on page {p2}.", { p0: nextIndex + 1, p1: total, p2: match.pageNumber }));
    }
  }

  async function runSelectionSearch(scope = 'pdf') {
    const selection = state.pendingSearchSelection || state.pendingSelection;
    const selectedText = String(selection?.text || '').trim();
    if (!selectedText) {
      ctx.renderSelectionSearchMessage(paperUi('search.needsSelection'), true);
      return;
    }
    if (scope === 'pdf') {
      try {
        const matches = await collectPdfSearchMatches(selectedText);
        const result = buildPdfSelectionSearchResultFromMatches(matches, state.pageNumber);
        ctx.renderPdfSearchResults(result);
        ctx.setPdfSearchMatches(result.matches, result.targetMatchIndex);
        if (result.targetMatchIndex >= 0) {
          activateSearchMatch(result.targetMatchIndex, { jump: true, cycleTone: false });
          ctx.setStatus(i18nUi.text((result.totalMatches === 1 ? (result.pages.length === 1 ? "Found {p0} matched word on {p2} page." : "Found {p0} matched word on {p2} pages.") : (result.pages.length === 1 ? "Found {p0} matched words on {p2} page." : "Found {p0} matched words on {p2} pages.")), { p0: result.totalMatches, p2: result.pages.length }));
        }
      } catch (error) {
        ctx.renderSelectionSearchMessage(paperFailure(error, 'search.pdfFailed'), true);
      } finally {
        ctx.pruneRenderedPageRecords?.();
        ctx.scheduleVisiblePageRender?.();
      }
      return;
    }
    if (typeof state.onSelectionSearch !== 'function') {
      ctx.renderSelectionSearchMessage(paperUi('search.libraryUnavailable'), true);
      return;
    }
    ctx.renderSelectionSearchMessage(paperUi('search.searching'));
    try {
      const result = await state.onSelectionSearch({
        scope: 'library',
        text: selectedText,
        paperId: state.paperId
      });
      if (result?.ok === false) {
        ctx.renderSelectionSearchMessage(result.error || paperUi('search.libraryFailed'), true);
        return;
      }
      ctx.renderPaperDatabaseSearchResults(result);
    } catch (error) {
      ctx.renderSelectionSearchMessage(paperFailure(error, 'search.libraryFailed'), true);
    }
  }

  Object.assign(ctx, {
    collectPdfSearchMatches,
    ensurePdfSearchTextLayers,
    scrollToSearchMatch,
    activateSearchMatch,
    runSelectionSearch
  });
};
