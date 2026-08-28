import { escapeHtml } from '../../lib/html.js';
import { DEFAULT_SEQUENCE_LINE_LENGTH, DEFAULT_STRAND_COLUMN_GAP_PX, DEFAULT_STRAND_MARKER_COLUMN_PX, FALLBACK_CHAR_ADVANCE_PX, FALLBACK_SEQUENCE_LINE_HEIGHT_PX, STRAND_BLOCK_GAP_PX, STRAND_PAIR_ROW_GAP_PX } from './constants.js';
import { buildFeatureLocationText } from './feature-model.js';
import { isOrfFeature } from './orf-analysis.js';
import { getCdsProteinProperties } from './protein-properties.js';
import { formatRestrictionCutSummary } from './restriction-analysis.js';
import { clamp, complementSequence, normalizeSequenceText } from './shared.js';
import { normalizeAlignmentSequenceTrack, renderAlignmentComparisonRowsHtml } from './rendering/alignment-rows.js';
import { renderOrfAminoAcidRowHtml } from './rendering/amino-acid-rows.js';
import { renderLineFeatureButtonsHtml } from './rendering/feature-tracks.js';
import { normalizeHighlightSegments } from './rendering/highlight-segments.js';
import { formatProteinPropertySummary } from './rendering/protein-summary.js';
import { renderLineRestrictionAnnotationsHtml } from './rendering/restriction-lanes.js';
import { buildHighlightedLineMarkup } from './rendering/sequence-cells.js';

// Both line tracks used to scan every feature in the record for every line,
// which is quadratic: an 8 kb plasmid re-tested 267 features 134 times over.
// Bucket the features by line once instead, so a line only ever sees what
// actually touches it. Off-line features produced no geometry anyway, so the
// markup is unchanged.
function indexFeaturesByLine(indexedFeatures, lineLength, sequenceLength) {
  const safeLineLength = Math.max(1, Math.floor(Number(lineLength) || 0));
  const lineCount = Math.max(1, Math.ceil(sequenceLength / safeLineLength));
  const buckets = Array.from({ length: lineCount }, () => []);

  indexedFeatures.forEach((entry) => {
    const segments = Array.isArray(entry?.feature?.segments) ? entry.feature.segments : [];
    // A feature renders all of its segments at once, so it is listed once per
    // line however many of its segments land there. An origin-wrapped feature
    // has segments in descending order, so the lines are collected before the
    // feature is filed rather than deduped as they are walked.
    const touchedLines = new Set();
    segments.forEach((segment) => {
      const start = Math.max(0, Math.floor(Number(segment?.start) || 0));
      const end = Math.min(sequenceLength, Math.floor(Number(segment?.end) || 0));
      if (end <= start) {
        return;
      }
      const lastLine = Math.floor((end - 1) / safeLineLength);
      for (let line = Math.floor(start / safeLineLength); line <= lastLine; line += 1) {
        touchedLines.add(line);
      }
    });
    [...touchedLines].sort((left, right) => left - right).forEach((line) => {
      buckets[line]?.push(entry);
    });
  });

  return buckets;
}

export function renderDualStrandSequenceLinesHtml(sequence, highlightedSegments = [], options = {}) {
  const text = normalizeSequenceText(sequence);
  if (!text.length) {
    return '<p class="small-note">No sequence loaded.</p>';
  }

  const lineLength = clamp(
    Math.round(Number(options?.lineLength) || DEFAULT_SEQUENCE_LINE_LENGTH),
    24,
    280
  );
  const charAdvancePx = Math.max(1, Number(options?.charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);
  const sequenceLineHeightPx = Math.max(8, Number(options?.sequenceLineHeightPx) || FALLBACK_SEQUENCE_LINE_HEIGHT_PX);
  const lineFeatureOffsetPx = Math.max(
    0,
    Number(options?.lineFeatureOffsetPx) || (DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX)
  );
  const selectedFeatureIndex = Number.isFinite(Number(options?.selectedFeatureIndex))
    ? Number(options.selectedFeatureIndex)
    : -1;
  const cursorBaseIndex = Number.isFinite(Number(options?.cursorBaseIndex))
    ? Number(options.cursorBaseIndex)
    : null;
  const indexedFeatures = Array.isArray(options?.features)
    ? options.features.map((feature, index) => ({ feature, index }))
    : [];
  const orfTranslationContext = options?.orfTranslationContext || null;
  const complementary = complementSequence(text);
  const sortedHighlights = normalizeHighlightSegments(highlightedSegments, text.length);
  const alignmentSequenceTrack = normalizeAlignmentSequenceTrack(options?.alignmentSequenceTrack, text.length);
  // In alignment mode the cursor highlights a whole nt column (reference + aligned)
  // instead of drawing a thin insertion line between bases.
  const alignmentCursorActive = Boolean(alignmentSequenceTrack?.cells?.length);

  const lines = [];
  const featuresByLine = indexFeaturesByLine(indexedFeatures, lineLength, text.length);

  for (let lineStart = 0; lineStart < text.length; lineStart += lineLength) {
    const lineEnd = Math.min(text.length, lineStart + lineLength);
    const lineFeatures = featuresByLine[Math.floor(lineStart / lineLength)] || [];
    const lineHighlights = sortedHighlights
      .map((segment) => ({
        start: Math.max(lineStart, segment.start),
        end: Math.min(lineEnd, segment.end),
        kind: segment.kind
      }))
      .filter((segment) => segment.end > segment.start)
      .sort((a, b) => a.start - b.start);

    const forwardBody = buildHighlightedLineMarkup(text, lineStart, lineEnd, lineHighlights);
    const complementaryBody = buildHighlightedLineMarkup(complementary, lineStart, lineEnd, lineHighlights);
    const alignmentComparisonRows = renderAlignmentComparisonRowsHtml(
      lineStart,
      lineEnd,
      text,
      alignmentSequenceTrack
    );
    const alignmentTraceRow = alignmentComparisonRows
      ? String(alignmentSequenceTrack?.traceLines?.[String(lineStart)] || '')
      : '';
    const aminoAcidRow = renderOrfAminoAcidRowHtml(lineStart, lineEnd, orfTranslationContext, charAdvancePx);
    const lineRestrictionAnnotations = renderLineRestrictionAnnotationsHtml(
      lineFeatures,
      lineStart,
      lineEnd,
      text.length,
      selectedFeatureIndex,
      charAdvancePx,
      sequenceLineHeightPx
    );
    const restrictionTopPaddingPx = Math.max(0, Number(lineRestrictionAnnotations?.topPaddingPx) || 0);
    const lineFeatureButtons = renderLineFeatureButtonsHtml(
      lineFeatures,
      lineStart,
      lineEnd,
      text.length,
      selectedFeatureIndex,
      charAdvancePx,
      lineFeatureOffsetPx,
      text
    );
    const cursorBlockOnLine = alignmentCursorActive
      && Number.isFinite(cursorBaseIndex)
      && cursorBaseIndex >= lineStart
      && cursorBaseIndex < lineEnd;
    const showThinCursor = !alignmentCursorActive
      && Number.isFinite(cursorBaseIndex)
      && cursorBaseIndex >= lineStart
      && cursorBaseIndex <= lineEnd;
    const cursorLeftPx = (cursorBlockOnLine || showThinCursor)
      ? lineFeatureOffsetPx + ((cursorBaseIndex - lineStart) * charAdvancePx)
      : null;
    const cursorRowCount = alignmentComparisonRows ? 5 : 2;
    const strandPairHeightPx = Math.max(
      8,
      (sequenceLineHeightPx * cursorRowCount) + (STRAND_PAIR_ROW_GAP_PX * (cursorRowCount - 1))
    );
    const strandPairStyle = restrictionTopPaddingPx > 0
      ? ` style="padding-top:${restrictionTopPaddingPx.toFixed(3)}px;"`
      : '';
    const coordStyle = restrictionTopPaddingPx > 0
      ? ` style="padding-top:${(restrictionTopPaddingPx + 2).toFixed(3)}px;"`
      : '';

    // Off-screen lines are skipped by content-visibility, so each one has to
    // declare how tall it would have been or the scrollbar is a guess. Every
    // part of that is already known here: the strand rows, the restriction
    // padding, the feature and primer tracks, and the translation row.
    const pairExtraRows = (lineFeatureButtons.reverseHeightPx > 0 ? 1 : 0) + (aminoAcidRow ? 1 : 0);
    const blockSiblings = (lineFeatureButtons.forwardHeightPx > 0 ? 1 : 0)
      + (lineFeatureButtons.featuresHeightPx > 0 ? 1 : 0);
    const intrinsicHeightPx = strandPairHeightPx
      + restrictionTopPaddingPx
      + lineFeatureButtons.forwardHeightPx
      + lineFeatureButtons.reverseHeightPx
      + lineFeatureButtons.featuresHeightPx
      + (aminoAcidRow ? sequenceLineHeightPx : 0)
      + (pairExtraRows * STRAND_PAIR_ROW_GAP_PX)
      + (blockSiblings * STRAND_BLOCK_GAP_PX);

    lines.push(`
      <div class="sequence-viewer-dual-line" data-line-start="${lineStart}" data-line-end="${lineEnd}" style="contain-intrinsic-size:auto ${intrinsicHeightPx.toFixed(2)}px;">
        <span class="sequence-viewer-seq-coord"${coordStyle}>${(lineStart + 1).toLocaleString()}</span>
        <div class="sequence-viewer-strand-block">
          ${lineFeatureButtons.forwardPrimers}
          <div class="sequence-viewer-strand-pair"${strandPairStyle}>
            ${cursorBlockOnLine
    ? `<span class="sequence-viewer-line-cursor sequence-viewer-line-cursor-block" style="left:${cursorLeftPx.toFixed(3)}px;top:${restrictionTopPaddingPx.toFixed(3)}px;height:${strandPairHeightPx.toFixed(3)}px;width:${charAdvancePx.toFixed(3)}px;" aria-hidden="true"></span>`
    : (showThinCursor
      ? `<span class="sequence-viewer-line-cursor" style="left:${cursorLeftPx.toFixed(3)}px;top:${restrictionTopPaddingPx.toFixed(3)}px;height:${strandPairHeightPx.toFixed(3)}px;" aria-hidden="true"></span>`
      : '')}
            <div class="sequence-viewer-strand-row sequence-viewer-strand-row-top">
              <span class="sequence-viewer-strand-end">5'</span>
              <span class="sequence-viewer-seq-text sequence-viewer-seq-text-top">
                <span class="sequence-viewer-seq-text-content">${forwardBody}</span>
                ${lineRestrictionAnnotations.html}
              </span>
              <span class="sequence-viewer-strand-end">3'</span>
            </div>
            ${alignmentTraceRow}
            ${alignmentComparisonRows}
            <div class="sequence-viewer-strand-row sequence-viewer-strand-row-bottom">
              <span class="sequence-viewer-strand-end">3'</span>
              <span class="sequence-viewer-seq-text"><span class="sequence-viewer-seq-text-content">${complementaryBody}</span></span>
              <span class="sequence-viewer-strand-end">5'</span>
            </div>
            ${lineFeatureButtons.reversePrimers}
            ${aminoAcidRow}
          </div>
          ${lineFeatureButtons.features}
        </div>
      </div>
    `);
  }

  return lines.join('');
}

export function formatSelectedFeatureDetailHtml(feature, sequenceLength, options = {}) {
  if (!feature) {
    return '<p class="small-note">Select a feature in the bottom track to view details.</p>';
  }

  const strand = feature.strand === -1 ? '-' : '+';
  const location = buildFeatureLocationText(feature, sequenceLength);
  const identity = Number.isFinite(feature.identity) ? `${feature.identity.toFixed(2)}%` : 'n/a';
  const coverage = Number.isFinite(feature.coverage) ? `${feature.coverage.toFixed(2)}%` : 'n/a';
  const source = String(feature.mode || feature.source || '-');
  const recognitionSite = String(feature.site || '').trim();
  const cutSummary = formatRestrictionCutSummary(feature);
  const description = String(feature.description || '').trim();
  const enzymeNames = (Array.isArray(feature.enzymeNames) ? feature.enzymeNames : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  const vendors = (Array.isArray(feature.vendors) ? feature.vendors : [])
    .map((vendor) => String(vendor || '').trim())
    .filter(Boolean);
  const isOrf = isOrfFeature(feature);
  const orfFrame = String(feature.orfFrame || '').trim();
  const orfLengthNt = Math.max(0, Number(feature.orfLengthNt) || 0);
  const orfLengthAa = Math.max(0, Number(feature.orfLengthAa) || 0);
  const startCodon = String(feature.startCodon || '').trim();
  const stopCodon = String(feature.stopCodon || '').trim();
  const proteinProperties = getCdsProteinProperties(feature, options?.sequence || '');
  const orfSummaryParts = [];
  if (orfFrame) {
    orfSummaryParts.push(`Frame ${escapeHtml(orfFrame)}`);
  }
  if (orfLengthAa > 0) {
    orfSummaryParts.push(`${orfLengthAa.toLocaleString()} aa`);
  }
  if (orfLengthNt > 0) {
    orfSummaryParts.push(`${orfLengthNt.toLocaleString()} nt`);
  }
  if (startCodon) {
    orfSummaryParts.push(`Start ${escapeHtml(startCodon)}`);
  }
  if (stopCodon) {
    orfSummaryParts.push(`Stop ${escapeHtml(stopCodon)}`);
  }

  return `
    <p><strong>${escapeHtml(feature.name || '-')}</strong></p>
    <p><strong>Type:</strong> ${escapeHtml(feature.type || '-')} · <strong>Strand:</strong> ${strand}</p>
    <p><strong>Location:</strong> ${escapeHtml(location)}</p>
    ${isOrf && orfSummaryParts.length ? `<p><strong>ORF:</strong> ${orfSummaryParts.join(' · ')}</p>` : ''}
    ${formatProteinPropertySummary(proteinProperties)}
    ${recognitionSite ? `<p><strong>Recognition Site:</strong> ${escapeHtml(recognitionSite)}</p>` : ''}
    ${cutSummary ? `<p><strong>${escapeHtml(cutSummary.label)}:</strong> ${escapeHtml(cutSummary.text)}</p>` : ''}
    ${enzymeNames.length ? `<p><strong>Enzymes:</strong> ${escapeHtml(enzymeNames.join(', '))}</p>` : ''}
    ${vendors.length ? `<p><strong>Vendors:</strong> ${escapeHtml(vendors.join(', '))}</p>` : ''}
    <p><strong>Identity:</strong> ${identity} · <strong>Coverage:</strong> ${coverage} · <strong>Source:</strong> ${escapeHtml(source)}</p>
    ${description ? `<p class="small-note">${escapeHtml(description)}</p>` : ''}
  `;
}

export { normalizeHighlightSegments } from './rendering/highlight-segments.js';
