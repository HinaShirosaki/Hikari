import { escapeHtml } from '../../../lib/html.js';
import { FALLBACK_CHAR_ADVANCE_PX } from '../constants.js';
import { getAminoAcidVisualStyle, getOrfTranslationRowLabel } from '../translation-style.js';

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
    if (baseIndex < lineStart || baseIndex >= lineEnd) {
      return;
    }
    const style = getAminoAcidVisualStyle(anchor?.colorKey || displayText);
    const leftPx = (baseIndex - lineStart) * safeAdvance;
    const remainingBases = Math.max(1, lineEnd - baseIndex);
    const widthPx = Math.max(
      safeAdvance * 1.8,
      Math.min(remainingBases * safeAdvance, safeAdvance * 3)
    );
    const title = String(anchor?.title || displayText);
    const codonPositions = (Array.isArray(anchor?.codonPositions) ? anchor.codonPositions : [])
      .map((position) => Math.round(Number(position)))
      .filter(Number.isFinite)
      .join(',');
    cells.push(`
      <button
        type="button"
        class="sequence-viewer-aa-chip${anchor?.isStop ? ' sequence-viewer-aa-chip-stop' : ''}"
        data-aa="${escapeHtml(anchor?.aa || '')}"
        data-aa-display="${escapeHtml(displayText)}"
        data-aa-color-key="${escapeHtml(anchor?.colorKey || '')}"
        data-aa-codon="${escapeHtml(anchor?.codon || '')}"
        data-aa-strand="${orfTranslationContext?.strand === -1 ? -1 : 1}"
        data-aa-codon-positions="${codonPositions}"
        style="left:${leftPx.toFixed(3)}px;width:${widthPx.toFixed(3)}px;--sequence-viewer-aa-chip-color:${style.color};--sequence-viewer-aa-chip-background:${style.background};--sequence-viewer-aa-chip-border:${style.border};"
        title="${escapeHtml(title)}"
        aria-label="${escapeHtml(`${title}. Right-click to change this amino acid.`)}"
      >${escapeHtml(displayText)}</button>
    `);
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

// Both line tracks used to scan every feature in the record for every line,
// which is quadratic: an 8 kb plasmid re-tested 267 features 134 times over.
// Bucket the features by line once instead, so a line only ever sees what
// actually touches it. Off-line features produced no geometry anyway, so the

export {
  renderOrfAminoAcidRowHtml
};
