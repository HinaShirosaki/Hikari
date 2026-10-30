import { escapeHtml } from '../../../lib/html.js';

function getSequenceRunClass(kind) {
  const normalizedKind = String(kind || '').toLowerCase();
  if (normalizedKind === 'alignment') {
    return 'sequence-viewer-seq-run sequence-viewer-seq-highlight sequence-viewer-seq-highlight-alignment';
  }
  if (normalizedKind) {
    return 'sequence-viewer-seq-run sequence-viewer-seq-highlight';
  }
  return 'sequence-viewer-seq-run';
}

function buildSequenceBaseCells(sourceText, start, end) {
  const cells = [];
  for (let baseIndex = start; baseIndex < end; baseIndex += 1) {
    cells.push(`<span class="sequence-viewer-seq-base">${escapeHtml(sourceText[baseIndex] || '')}</span>`);
  }
  return cells.join('');
}

function buildHighlightedLineMarkup(sourceText, lineStart, lineEnd, lineHighlights) {
  if (!lineHighlights.length) {
    return `<span class="sequence-viewer-seq-run">${buildSequenceBaseCells(sourceText, lineStart, lineEnd)}</span>`;
  }

  let cursor = lineStart;
  const runs = [];
  lineHighlights.forEach((segment) => {
    if (segment.start > cursor) {
      runs.push(`<span class="sequence-viewer-seq-run">${buildSequenceBaseCells(sourceText, cursor, segment.start)}</span>`);
    }
    const kind = String(segment?.kind || '').toLowerCase() === 'alignment' ? 'alignment' : 'highlight';
    runs.push(`<span class="${getSequenceRunClass(kind)}">${buildSequenceBaseCells(sourceText, segment.start, segment.end)}</span>`);
    cursor = segment.end;
  });

  if (cursor < lineEnd) {
    runs.push(`<span class="sequence-viewer-seq-run">${buildSequenceBaseCells(sourceText, cursor, lineEnd)}</span>`);
  }

  return runs.join('');
}

export {
  buildHighlightedLineMarkup
};
