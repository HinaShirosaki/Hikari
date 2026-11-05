import { citationNeedles, findCitationText } from './pdf-viewer-citation-match.js';
import { getTextLayerRangeInfo } from './pdf-viewer-selection.js';
import { paperUi } from '../localization.js';

function passageRange(textLayer, needle) {
  const doc = textLayer.ownerDocument;
  const walker = doc.createTreeWalker(textLayer, 4);
  const nodes = [];
  let node;
  let text = '';
  while ((node = walker.nextNode())) {
    nodes.push({ node, start: text.length, end: text.length + node.length });
    text += node.nodeValue;
  }
  const match = findCitationText(text, [needle]);
  if (!match) return null;
  const first = nodes.find(item => item.end > match.start);
  const last = nodes.find(item => item.end >= match.end);
  if (!first || !last) return null;
  const range = doc.createRange();
  range.setStart(first.node, match.start - first.start);
  range.setEnd(last.node, match.end - last.start);
  return range;
}

export function installPdfViewerCitationController(ctx) {
  const { state } = ctx;
  let request = 0;
  ctx.revealCitation = async (excerpt = '') => {
    const activeRequest = ++request;
    const document = state.pdfDocument;
    const loadToken = state.loadToken;
    const stale = () => document !== state.pdfDocument || loadToken !== state.loadToken || request !== activeRequest;
    const needles = citationNeedles(excerpt);
    if (!document) return false;
    state.citationMatch = null;
    ctx.clearSelectionSearchMatches();
    if (!needles.length) { ctx.setStatus(paperUi('citation.notLocated')); return false; }
    ctx.setStatus(paperUi('citation.locating'));
    let found;
    let fallback;
    // Prefer a complete passage even if an earlier page repeats part of it.
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      if (stale()) return false;
      const content = await page.getTextContent();
      if (stale()) return false;
      const text = content.items.map(item => item.str || '').join(' ');
      const match = findCitationText(text, needles);
      if (match?.needle === needles[0]) { found = { pageNumber, ...match }; break; }
      if (match && !fallback) fallback = { pageNumber, ...match };
    }
    found ||= fallback;
    if (!found || stale()) {
      if (!stale()) ctx.setStatus(paperUi('citation.notLocated'));
      return false;
    }
    const record = state.pageRecords.find(item => item.pageNumber === found.pageNumber);
    if (!record) return false;
    ctx.goToPage(found.pageNumber, { behavior: 'auto' });
    await ctx.renderDocumentPages({ resetScroll: false, preserveScroll: false });
    if (stale()) return false;
    const range = passageRange(record.textLayer, found.needle);
    const info = range && getTextLayerRangeInfo({ textLayer: record.textLayer, range });
    range?.detach?.();
    if (!info?.boxes?.length) {
      ctx.setStatus(paperUi('citation.notLocated'));
      return false;
    }
    const match = { id: 'paper-citation', pageNumber: found.pageNumber, boxes: info.boxes };
    state.citationMatch = match;
    ctx.paintSearchHighlights();
    ctx.scrollToSearchMatch(match, { behavior: 'auto' });
    return true;
  };
}
