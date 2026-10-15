import { escapeHtml } from '../../../lib/html.js';
import { FALLBACK_CHAR_ADVANCE_PX } from '../constants.js';
import { getAminoAcidVisualStyle, getOrfTranslationRowLabel } from '../translation-style.js';

function getCodonLineFragments(positions, lineStart, lineEnd, strand) {
  const visiblePositions = [...new Set(positions)]
    .filter((position) => position >= lineStart && position < lineEnd)
    .sort((left, right) => left - right);
  const fragments = [];
  visiblePositions.forEach((position) => {
    const previous = fragments[fragments.length - 1];
    if (previous?.end === position) {
      previous.end = position + 1;
    } else {
      fragments.push({ start: position, end: position + 1 });
    }
  });
  // Use coding order for the open edges, including reverse-strand codons
  // and codons crossing the circular origin or a feature segment boundary.
  return fragments.map((fragment) => {
    const leftIndex = positions.indexOf(fragment.start);
    const rightIndex = positions.indexOf(fragment.end - 1);
    return {
      ...fragment,
      continuesLeft: strand === -1 ? leftIndex < positions.length - 1 : leftIndex > 0,
      continuesRight: strand === -1 ? rightIndex > 0 : rightIndex < positions.length - 1
    };
  });
}

function buildAminoAcidLineMarkup(lineStart, lineEnd, orfTranslationContext, charAdvancePx) {
  const lineSpan = Math.max(0, lineEnd - lineStart);
  if (!lineSpan || !orfTranslationContext || !Array.isArray(orfTranslationContext.anchors)) {
    return '';
  }

  const safeAdvance = Math.max(1, Number(charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);
  const lineWidthPx = lineSpan * safeAdvance;
  const cells = [];

  orfTranslationContext.anchors.forEach((anchor) => {
    const baseIndex = Number(anchor?.baseIndex);
    const displayText = String(anchor?.displayText || anchor?.aa || '').trim();
    if (!Number.isFinite(baseIndex) || !displayText) {
      return;
    }
    const rawPositions = Array.isArray(anchor?.codonPositions) ? anchor.codonPositions : [];
    if (rawPositions.length
      ? !rawPositions.some((position) => position >= lineStart && position < lineEnd)
      : baseIndex + 3 <= lineStart || baseIndex >= lineEnd) {
      return;
    }
    const positions = rawPositions
      .map((position) => Math.round(Number(position)))
      .filter(Number.isFinite);
    const fallbackPositions = orfTranslationContext.strand === -1
      ? [baseIndex + 2, baseIndex + 1, baseIndex]
      : [baseIndex, baseIndex + 1, baseIndex + 2];
    const codingPositions = positions.length ? positions : fallbackPositions;
    const fragments = getCodonLineFragments(codingPositions, lineStart, lineEnd, orfTranslationContext.strand);
    const style = getAminoAcidVisualStyle(anchor?.colorKey || displayText);
    const codonPositions = codingPositions.join(',');
    fragments.forEach(({ start, end, continuesLeft, continuesRight }) => {
      const split = continuesLeft || continuesRight;
      const leftPx = (start - lineStart) * safeAdvance;
      const widthPx = (end - start) * safeAdvance;
      const title = String(anchor?.title || displayText) + (split
        ? `. Split codon, bases ${codingPositions.map((position) => position + 1).join(', ')}`
        : '');
      const continuationClasses = (continuesLeft ? ' sequence-viewer-aa-chip-continues-left' : '')
        + (continuesRight ? ' sequence-viewer-aa-chip-continues-right' : '');
      const label = split && displayText.length > 1 ? String(anchor?.aa || displayText) : displayText;
      cells.push(`
      <button
        type="button"
        class="sequence-viewer-aa-chip${anchor?.isStop ? ' sequence-viewer-aa-chip-stop' : ''}${split ? ' sequence-viewer-aa-chip-split' : ''}${continuationClasses}"
        data-aa="${escapeHtml(anchor?.aa || '')}"
        data-aa-display="${escapeHtml(displayText)}"
        data-aa-color-key="${escapeHtml(anchor?.colorKey || '')}"
        data-aa-codon="${escapeHtml(anchor?.codon || '')}"
        data-aa-strand="${orfTranslationContext?.strand === -1 ? -1 : 1}"
        data-aa-codon-positions="${codonPositions}"
        style="left:${leftPx.toFixed(3)}px;width:${widthPx.toFixed(3)}px;--sequence-viewer-aa-chip-color:${style.color};--sequence-viewer-aa-chip-background:${style.background};--sequence-viewer-aa-chip-border:${style.border};"
        title="${escapeHtml(title)}"
        aria-label="${escapeHtml(`${title}. Right-click to change this amino acid.`)}"
      >${escapeHtml(label)}</button>
    `);
    });
  });

  if (!cells.length) {
    return '';
  }

  return `
    <span class="sequence-viewer-aa-track" style="width:${lineWidthPx.toFixed(3)}px;">
      ${cells.join('')}
    </span>
  `;
}

function renderOrfAminoAcidRowHtml(lineStart, lineEnd, orfTranslationContext, charAdvancePx) {
  const body = buildAminoAcidLineMarkup(lineStart, lineEnd, orfTranslationContext, charAdvancePx);
  if (!body) {
    return '';
  }

  const strandClass = orfTranslationContext?.strand === -1
    ? 'sequence-viewer-aa-row-minus'
    : 'sequence-viewer-aa-row-plus';
  const label = getOrfTranslationRowLabel(orfTranslationContext?.strand);

  return `
    <div class="sequence-viewer-strand-row sequence-viewer-aa-row ${strandClass}">
      <span class="sequence-viewer-strand-end sequence-viewer-aa-label">${escapeHtml(label)}</span>
      <span class="sequence-viewer-seq-text sequence-viewer-aa-text">
        ${body}
      </span>
      <span class="sequence-viewer-strand-end sequence-viewer-aa-label"></span>
    </div>
  `;
}

export {
  renderOrfAminoAcidRowHtml
};
