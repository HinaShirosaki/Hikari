import { clamp } from './pdf-viewer-anchors.js';
import { getTextLayerRangeInfo } from './pdf-viewer-selection.js';
import {
  buildPdfSelectionSearchResultFromMatches,
  getPdfSelectionSearchTerms
} from './pdf-viewer-search.js';

export const installPdfViewerSearchExecutionController = (ctx) => {
  const { state } = ctx;

  function buildSearchMatchId(pageNumber, term, index) {
    return `search-${pageNumber}-${index}-${String(term || '').replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}`;
  }

  function collectPdfSearchMatches(queryText = '') {
    const terms = getPdfSelectionSearchTerms(queryText);
    if (!terms.length) {
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
      ctx.setStatus(`Showing match ${nextIndex + 1} of ${total} on page ${match.pageNumber}.`);
    }
  }

  async function runSelectionSearch(scope = 'pdf') {
    const selection = state.pendingSearchSelection || state.pendingSelection;
    const selectedText = String(selection?.text || '').trim();
    if (!selectedText) {
      ctx.renderSelectionSearchMessage('Select text before searching.', true);
      return;
    }
    if (scope === 'pdf') {
      const matches = collectPdfSearchMatches(selectedText);
      const result = buildPdfSelectionSearchResultFromMatches(matches, state.pageNumber);
      ctx.renderPdfSearchResults(result);
      ctx.setPdfSearchMatches(result.matches, result.targetMatchIndex);
      if (result.targetMatchIndex >= 0) {
        activateSearchMatch(result.targetMatchIndex, { jump: true, cycleTone: false });
        ctx.setStatus(`Found ${result.totalMatches} matched word${result.totalMatches === 1 ? '' : 's'} on ${result.pages.length} page${result.pages.length === 1 ? '' : 's'}.`);
      }
      return;
    }
    if (typeof state.onSelectionSearch !== 'function') {
      ctx.renderSelectionSearchMessage('Paper database search is unavailable in this build.', true);
      return;
    }
    ctx.renderSelectionSearchMessage('Searching paper database...');
    try {
      const result = await state.onSelectionSearch({
        scope: 'library',
        text: selectedText,
        paperId: state.paperId
      });
      if (result?.ok === false) {
        ctx.renderSelectionSearchMessage(result.error || 'Paper database search failed.', true);
        return;
      }
      ctx.renderPaperDatabaseSearchResults(result);
    } catch (error) {
      ctx.renderSelectionSearchMessage(String(error?.message || error || 'Paper database search failed.'), true);
    }
  }

  Object.assign(ctx, {
    collectPdfSearchMatches,
    scrollToSearchMatch,
    activateSearchMatch,
    runSelectionSearch
  });
};
