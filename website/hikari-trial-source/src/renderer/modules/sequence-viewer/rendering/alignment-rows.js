import { escapeHtml } from '../../../lib/html.js';

function normalizeAlignmentSequenceTrack(track, sequenceLength) {
  const safeLength = Math.max(0, Math.floor(Number(sequenceLength) || 0));
  const sourceCells = Array.isArray(track?.cells) ? track.cells : [];
  if (!safeLength || !sourceCells.length) {
    return null;
  }

  let hasCells = false;
  const cells = Array.from({ length: safeLength }, (_item, index) => {
    const sourceCell = sourceCells[index];
    const rawBase = String(sourceCell?.base || '').trim().toUpperCase();
    if (!rawBase) {
      return null;
    }

    hasCells = true;
    const kind = String(sourceCell?.kind || '').toLowerCase();
    return {
      base: rawBase === '-' ? '-' : rawBase.slice(0, 1),
      kind: kind === 'mismatch' || kind === 'deletion' ? kind : 'match'
    };
  });

  const traceLines = track?.traceLines && typeof track.traceLines === 'object'
    ? track.traceLines
    : {};
  return hasCells ? { cells, traceLines } : null;
}

function renderAlignmentQueryRowHtml(lineStart, lineEnd, alignmentSequenceTrack) {
  if (!alignmentSequenceTrack?.cells?.length) {
    return '';
  }

  let hasAlignedBases = false;
  const body = [];
  for (let baseIndex = lineStart; baseIndex < lineEnd; baseIndex += 1) {
    const cell = alignmentSequenceTrack.cells[baseIndex] || null;
    if (!cell) {
      body.push('<span class="sequence-viewer-seq-base sequence-viewer-alignment-query-base sequence-viewer-alignment-query-base-empty">&nbsp;</span>');
      continue;
    }

    hasAlignedBases = true;
    const kindClass = cell.kind === 'mismatch' || cell.kind === 'deletion'
      ? ` sequence-viewer-alignment-query-base-${cell.kind}`
      : '';
    const gapClass = cell.base === '-' ? ' sequence-viewer-alignment-query-base-gap' : '';
    body.push(
      `<span class="sequence-viewer-seq-base sequence-viewer-alignment-query-base${kindClass}${gapClass}">${escapeHtml(cell.base)}</span>`
    );
  }

  if (!hasAlignedBases) {
    return '';
  }

  return `
    <div class="sequence-viewer-strand-row sequence-viewer-alignment-query-row">
      <span class="sequence-viewer-strand-end sequence-viewer-alignment-row-label" title="Aligned sequencing read">READ</span>
      <span class="sequence-viewer-seq-text sequence-viewer-alignment-query-text">
        <span class="sequence-viewer-seq-text-content">${body.join('')}</span>
      </span>
      <span class="sequence-viewer-strand-end sequence-viewer-alignment-query-end"></span>
    </div>
  `;
}

function renderAlignmentReferenceRowHtml(lineStart, lineEnd, referenceSequence, alignmentSequenceTrack) {
  if (!alignmentSequenceTrack?.cells?.length) {
    return '';
  }

  let hasAlignedBases = false;
  const body = [];
  for (let baseIndex = lineStart; baseIndex < lineEnd; baseIndex += 1) {
    const cell = alignmentSequenceTrack.cells[baseIndex] || null;
    if (!cell) {
      body.push('<span class="sequence-viewer-seq-base sequence-viewer-alignment-reference-base sequence-viewer-alignment-reference-base-empty">&nbsp;</span>');
      continue;
    }

    hasAlignedBases = true;
    const differenceClass = cell.kind === 'mismatch' || cell.kind === 'deletion'
      ? ` sequence-viewer-alignment-reference-base-${cell.kind}`
      : '';
    body.push(
      `<span class="sequence-viewer-seq-base sequence-viewer-alignment-reference-base${differenceClass}">${escapeHtml(referenceSequence[baseIndex] || '')}</span>`
    );
  }

  if (!hasAlignedBases) {
    return '';
  }

  return `
    <div class="sequence-viewer-strand-row sequence-viewer-alignment-reference-row">
      <span class="sequence-viewer-strand-end sequence-viewer-alignment-row-label" title="Reference sequence">REF</span>
      <span class="sequence-viewer-seq-text sequence-viewer-alignment-reference-text">
        <span class="sequence-viewer-seq-text-content">${body.join('')}</span>
      </span>
      <span class="sequence-viewer-strand-end sequence-viewer-alignment-query-end"></span>
    </div>
  `;
}

function renderAlignmentGuideRowHtml(lineStart, lineEnd, alignmentSequenceTrack) {
  if (!alignmentSequenceTrack?.cells?.length) {
    return '';
  }

  let hasAlignedBases = false;
  const body = [];
  for (let baseIndex = lineStart; baseIndex < lineEnd; baseIndex += 1) {
    const cell = alignmentSequenceTrack.cells[baseIndex] || null;
    if (!cell) {
      body.push('<span class="sequence-viewer-seq-base sequence-viewer-alignment-guide-base sequence-viewer-alignment-guide-base-empty">&nbsp;</span>');
      continue;
    }

    hasAlignedBases = true;
    const kind = cell.kind === 'mismatch' || cell.kind === 'deletion' ? cell.kind : 'match';
    const marker = kind === 'match' ? '|' : (kind === 'mismatch' ? '×' : '−');
    body.push(
      `<span class="sequence-viewer-seq-base sequence-viewer-alignment-guide-base sequence-viewer-alignment-guide-base-${kind}">${marker}</span>`
    );
  }

  if (!hasAlignedBases) {
    return '';
  }

  return `
    <div class="sequence-viewer-strand-row sequence-viewer-alignment-guide-row" aria-label="Alignment guide: vertical bar means a match, multiplication sign means a mismatch, and minus means a deletion">
      <span class="sequence-viewer-strand-end sequence-viewer-alignment-row-label" title="Alignment guide">&nbsp;</span>
      <span class="sequence-viewer-seq-text sequence-viewer-alignment-guide-text">
        <span class="sequence-viewer-seq-text-content">${body.join('')}</span>
      </span>
      <span class="sequence-viewer-strand-end sequence-viewer-alignment-query-end"></span>
    </div>
  `;
}

function renderAlignmentComparisonRowsHtml(lineStart, lineEnd, referenceSequence, alignmentSequenceTrack) {
  const referenceRow = renderAlignmentReferenceRowHtml(
    lineStart,
    lineEnd,
    referenceSequence,
    alignmentSequenceTrack
  );
  const queryRow = renderAlignmentQueryRowHtml(lineStart, lineEnd, alignmentSequenceTrack);
  if (!referenceRow || !queryRow) {
    return '';
  }

  return `
    <div class="sequence-viewer-alignment-comparison">
      ${referenceRow}
      ${renderAlignmentGuideRowHtml(lineStart, lineEnd, alignmentSequenceTrack)}
      ${queryRow}
    </div>
  `;
}

export {
  normalizeAlignmentSequenceTrack,
  renderAlignmentComparisonRowsHtml
};
