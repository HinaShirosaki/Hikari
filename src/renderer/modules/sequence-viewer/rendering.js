import { escapeHtml } from '../tool-box/common.js';
import {
  DEFAULT_SEQUENCE_LINE_LENGTH,
  DEFAULT_STRAND_COLUMN_GAP_PX,
  DEFAULT_STRAND_MARKER_COLUMN_PX,
  FALLBACK_CHAR_ADVANCE_PX,
  FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
  LINE_FEATURE_BAR_GAP_PX,
  LINE_FEATURE_BAR_HEIGHT_PX,
  LINE_FEATURE_BAR_HORIZONTAL_PADDING_PX,
  RESTRICTION_LABEL_GAP_PX,
  STRAND_PAIR_ROW_GAP_PX
} from './constants.js';
import {
  buildFeatureLocationText,
  getContrastTextColor,
  hashTypeToColor
} from './feature-model.js';
import { isOrfFeature } from './orf-analysis.js';
import {
  buildRestrictionCutPolylinePoints,
  computeRestrictionAnnotationGeometry,
  formatRestrictionCutSummary,
  resolveRestrictionCutBaseIndices,
  resolveRestrictionCutLocalPx
} from './restriction-analysis.js';
import {
  getAminoAcidVisualStyle,
  getOrfTranslationRowLabel
} from './translation-style.js';
import {
  clamp,
  complementSequence,
  normalizeSequenceText
} from './shared.js';

const RESTRICTION_STACK_LANE_STEP_PX = 16;
const RESTRICTION_LABEL_COLLISION_GAP_PX = 6;
const RESTRICTION_LABEL_HORIZONTAL_PADDING_PX = 8;

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

export function normalizeHighlightSegments(segments, sequenceLength = null) {
  const maxLength = Number.isFinite(Number(sequenceLength))
    ? Math.max(0, Number(sequenceLength))
    : Number.POSITIVE_INFINITY;
  const normalized = (Array.isArray(segments) ? segments : [])
    .map((segment) => ({
      start: clamp(Math.round(Number(segment?.start) || 0), 0, maxLength),
      end: clamp(Math.round(Number(segment?.end) || 0), 0, maxLength),
      kind: String(segment?.kind || '').toLowerCase() === 'alignment' ? 'alignment' : ''
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      if (left.kind !== right.kind) {
        return left.kind.localeCompare(right.kind);
      }
      return left.end - right.end;
    });

  if (!normalized.length) {
    return [];
  }

  const merged = [normalized[0]];
  for (let i = 1; i < normalized.length; i += 1) {
    const previous = merged[merged.length - 1];
    const current = normalized[i];
    if (current.kind === previous.kind && current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function estimateRestrictionLabelWidthPx(label, charAdvancePx) {
  const safeLabel = String(label || '');
  const labelAdvancePx = Math.max(5, charAdvancePx * 0.68);
  return Math.max(28, (safeLabel.length * labelAdvancePx) + RESTRICTION_LABEL_HORIZONTAL_PADDING_PX);
}

function assignRestrictionAnnotationLanes(fragments) {
  const sorted = [...fragments].sort((left, right) => {
    if (left.collisionLeftPx !== right.collisionLeftPx) {
      return left.collisionLeftPx - right.collisionLeftPx;
    }
    if (left.leftPx !== right.leftPx) {
      return left.leftPx - right.leftPx;
    }
    return right.widthPx - left.widthPx;
  });
  const laneRightEdges = [];

  sorted.forEach((fragment) => {
    let laneIndex = laneRightEdges.findIndex(
      (rightEdge) => fragment.collisionLeftPx >= (rightEdge + RESTRICTION_LABEL_COLLISION_GAP_PX)
    );
    if (laneIndex < 0) {
      laneIndex = laneRightEdges.length;
      laneRightEdges.push(fragment.collisionRightPx);
    } else {
      laneRightEdges[laneIndex] = fragment.collisionRightPx;
    }
    fragment.lane = laneIndex;
  });

  return {
    fragments: sorted,
    laneCount: Math.max(1, laneRightEdges.length)
  };
}

function renderLineRestrictionAnnotationsHtml(
  indexedFeatures,
  lineStart,
  lineEnd,
  sequenceLength,
  selectedFeatureIndex,
  charAdvancePx,
  sequenceLineHeightPx
) {
  const safeAdvance = Math.max(1, Number(charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);
  const safeLineHeight = Math.max(8, Number(sequenceLineHeightPx) || FALLBACK_SEQUENCE_LINE_HEIGHT_PX);
  const pairBoxHeightPx = Math.max(safeLineHeight + 8, (safeLineHeight * 2) + STRAND_PAIR_ROW_GAP_PX);
  const lineWidthPx = Math.max(1, (Math.max(lineStart, lineEnd) - lineStart) * safeAdvance);
  const fragments = indexedFeatures
    .filter(({ feature }) => String(feature?.type || '').toLowerCase() === 'restriction_site')
    .flatMap(({ feature, index }) => {
      const segments = Array.isArray(feature?.segments) ? feature.segments : [];
      const cutBaseIndices = resolveRestrictionCutBaseIndices(feature);
      return segments
        .map((segment) => {
          const segmentStart = Number(segment?.start) || 0;
          const segmentEnd = Number(segment?.end) || 0;
          const geometry = computeRestrictionAnnotationGeometry(
            segment,
            lineStart,
            lineEnd,
            safeAdvance,
            Number(cutBaseIndices?.top)
          );
          if (!geometry) {
            return null;
          }

          const topCutLocalPx = resolveRestrictionCutLocalPx(
            Number(cutBaseIndices?.top),
            geometry,
            lineStart,
            safeAdvance,
            segmentStart,
            segmentEnd
          );
          const bottomCutLocalPx = resolveRestrictionCutLocalPx(
            Number(cutBaseIndices?.bottom),
            geometry,
            lineStart,
            safeAdvance,
            segmentStart,
            segmentEnd
          );
          const strandGapPx = Math.max(2, pairBoxHeightPx - (safeLineHeight * 2));
          const cutPoints = (Number.isFinite(topCutLocalPx) || Number.isFinite(bottomCutLocalPx))
            ? buildRestrictionCutPolylinePoints(
              geometry.widthPx,
              topCutLocalPx,
              bottomCutLocalPx,
              pairBoxHeightPx,
              safeLineHeight,
              strandGapPx,
              RESTRICTION_LABEL_GAP_PX
            )
            : '';
          const svgWidth = Math.max(1, geometry.widthPx);
          const svgHeight = RESTRICTION_LABEL_GAP_PX + pairBoxHeightPx;
          const location = buildFeatureLocationText(feature, sequenceLength);
          const isActive = index === selectedFeatureIndex;
          const label = String(feature.name || `site_${index + 1}`);
          const title = `${label || '-'} (${location})`;
          const labelWidthPx = estimateRestrictionLabelWidthPx(label, safeAdvance);
          const labelCenterPx = geometry.leftPx + (geometry.widthPx / 2);
          const collisionLeftPx = Math.min(geometry.leftPx, labelCenterPx - (labelWidthPx / 2));
          const collisionRightPx = Math.max(geometry.leftPx + geometry.widthPx, labelCenterPx + (labelWidthPx / 2));

          return {
            index,
            isActive,
            label,
            title,
            leftPx: geometry.leftPx,
            widthPx: geometry.widthPx,
            collisionLeftPx,
            collisionRightPx,
            cutPoints,
            svgWidth,
            svgHeight
          };
        })
        .filter(Boolean);
    });

  if (!fragments.length) {
    return { html: '', topPaddingPx: 0 };
  }

  const { fragments: stackedFragments, laneCount } = assignRestrictionAnnotationLanes(fragments);
  const topPaddingPx = RESTRICTION_LABEL_GAP_PX + 5 + ((laneCount - 1) * RESTRICTION_STACK_LANE_STEP_PX);
  const annotations = stackedFragments
    .map((fragment) => {
      const laneTopPx = -fragment.lane * RESTRICTION_STACK_LANE_STEP_PX;
      return `
            <button
              type="button"
              class="sequence-viewer-restriction-annot${fragment.isActive ? ' sequence-viewer-restriction-annot-active' : ''}"
              data-feature-index="${fragment.index}"
              style="left:${fragment.leftPx.toFixed(3)}px;width:${fragment.widthPx.toFixed(3)}px;top:${laneTopPx.toFixed(3)}px;z-index:${fragment.lane + 1};--sequence-viewer-restriction-label-gap:${RESTRICTION_LABEL_GAP_PX}px;"
              title="${escapeHtml(fragment.title)}"
            >
              <span class="sequence-viewer-restriction-label">${escapeHtml(fragment.label)}</span>
              <span class="sequence-viewer-restriction-box"></span>
              ${fragment.cutPoints
    ? `<svg class="sequence-viewer-restriction-cut-svg" viewBox="0 0 ${fragment.svgWidth.toFixed(2)} ${fragment.svgHeight.toFixed(2)}" preserveAspectRatio="none" aria-hidden="true">
                <polyline points="${fragment.cutPoints}"></polyline>
              </svg>`
    : ''}
            </button>
          `;
    })
    .join('');

  return {
    html: `<div class="sequence-viewer-line-restriction-track" style="width:${lineWidthPx.toFixed(3)}px;height:${pairBoxHeightPx.toFixed(3)}px;--sequence-viewer-restriction-lanes:${laneCount};">${annotations}</div>`,
    topPaddingPx
  };
}

function renderLineFeatureButtonsHtml(
  indexedFeatures,
  lineStart,
  lineEnd,
  sequenceLength,
  selectedFeatureIndex,
  charAdvancePx,
  lineFeatureOffsetPx = (DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX)
) {
  const safeAdvance = Math.max(1, Number(charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);
  const safeOffset = Math.max(0, Number(lineFeatureOffsetPx) || 0);
  const lineWidthPx = Math.max(1, (Math.max(lineStart, lineEnd) - lineStart) * safeAdvance);

  const fragments = indexedFeatures
    .filter(({ feature }) => String(feature?.type || '').toLowerCase() !== 'restriction_site')
    .flatMap(({ feature, index }) => {
      const segments = Array.isArray(feature?.segments) ? feature.segments : [];
      const location = buildFeatureLocationText(feature, sequenceLength);
      const title = `${feature.name || '-'} (${location})`;
      const color = hashTypeToColor(String(feature?.type || 'misc_feature'));
      const textColor = getContrastTextColor(color);
      return segments
        .map((segment) => {
          const geometry = computeRestrictionAnnotationGeometry(segment, lineStart, lineEnd, safeAdvance);
          if (!geometry) {
            return null;
          }
          return {
            feature,
            index,
            title,
            color,
            textColor,
            leftPx: geometry.leftPx,
            widthPx: geometry.widthPx,
            rightPx: geometry.leftPx + geometry.widthPx
          };
        })
        .filter(Boolean);
    })
    .sort((left, right) => {
      if (left.leftPx !== right.leftPx) {
        return left.leftPx - right.leftPx;
      }
      return right.widthPx - left.widthPx;
    });

  if (!fragments.length) {
    return '';
  }

  const laneRightEdges = [];
  fragments.forEach((fragment) => {
    let laneIndex = laneRightEdges.findIndex((rightEdge) => fragment.leftPx >= rightEdge);
    if (laneIndex < 0) {
      laneIndex = laneRightEdges.length;
      laneRightEdges.push(fragment.rightPx);
    } else {
      laneRightEdges[laneIndex] = fragment.rightPx;
    }
    fragment.lane = laneIndex;
  });

  const laneCount = Math.max(1, laneRightEdges.length);
  const trackHeightPx = (laneCount * LINE_FEATURE_BAR_HEIGHT_PX) + ((laneCount - 1) * LINE_FEATURE_BAR_GAP_PX);
  const bars = fragments
    .map((fragment) => {
      const topPx = fragment.lane * (LINE_FEATURE_BAR_HEIGHT_PX + LINE_FEATURE_BAR_GAP_PX);
      const isActive = fragment.index === selectedFeatureIndex;
      const label = String(fragment.feature?.name || `feature_${fragment.index + 1}`);
      const labelWidthPx = (label.length * safeAdvance) + (LINE_FEATURE_BAR_HORIZONTAL_PADDING_PX * 2);
      const showLabel = fragment.widthPx >= labelWidthPx;
      return `
        <button
          type="button"
          class="sequence-viewer-line-feature sequence-viewer-line-feature-bar${isActive ? ' sequence-viewer-line-feature-active' : ''}${showLabel ? '' : ' sequence-viewer-line-feature-compact'}"
          data-feature-index="${fragment.index}"
          style="left:${fragment.leftPx.toFixed(3)}px;width:${fragment.widthPx.toFixed(3)}px;top:${topPx.toFixed(3)}px;background:${fragment.color};color:${fragment.textColor};"
          title="${escapeHtml(fragment.title)}"
        >${showLabel ? `<span class="sequence-viewer-line-feature-label">${escapeHtml(label)}</span>` : ''}</button>
      `;
    })
    .join('');

  return `<div class="sequence-viewer-line-features" style="width:${lineWidthPx.toFixed(3)}px;height:${trackHeightPx.toFixed(3)}px;margin-left:${safeOffset.toFixed(3)}px;">${bars}</div>`;
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
    cells.push(`
      <span
        class="sequence-viewer-aa-chip${anchor?.isStop ? ' sequence-viewer-aa-chip-stop' : ''}"
        data-aa="${escapeHtml(anchor?.aa || '')}"
        data-aa-display="${escapeHtml(displayText)}"
        data-aa-color-key="${escapeHtml(anchor?.colorKey || '')}"
        style="left:${leftPx.toFixed(3)}px;width:${widthPx.toFixed(3)}px;--sequence-viewer-aa-chip-color:${style.color};--sequence-viewer-aa-chip-background:${style.background};--sequence-viewer-aa-chip-border:${style.border};"
        title="${escapeHtml(title)}"
      >${escapeHtml(displayText)}</span>
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
  const strandPairHeightPx = Math.max(8, (sequenceLineHeightPx * 2) + STRAND_PAIR_ROW_GAP_PX);

  const lines = [];

  for (let lineStart = 0; lineStart < text.length; lineStart += lineLength) {
    const lineEnd = Math.min(text.length, lineStart + lineLength);
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
    const aminoAcidRow = renderOrfAminoAcidRowHtml(lineStart, lineEnd, orfTranslationContext, charAdvancePx);
    const lineRestrictionAnnotations = renderLineRestrictionAnnotationsHtml(
      indexedFeatures,
      lineStart,
      lineEnd,
      text.length,
      selectedFeatureIndex,
      charAdvancePx,
      sequenceLineHeightPx
    );
    const restrictionTopPaddingPx = Math.max(0, Number(lineRestrictionAnnotations?.topPaddingPx) || 0);
    const lineFeatureButtons = renderLineFeatureButtonsHtml(
      indexedFeatures,
      lineStart,
      lineEnd,
      text.length,
      selectedFeatureIndex,
      charAdvancePx,
      lineFeatureOffsetPx
    );
    const hasCursorOnLine = Number.isFinite(cursorBaseIndex) && cursorBaseIndex >= lineStart && cursorBaseIndex <= lineEnd;
    const cursorLeftPx = hasCursorOnLine
      ? lineFeatureOffsetPx + ((cursorBaseIndex - lineStart) * charAdvancePx)
      : null;
    const strandPairStyle = restrictionTopPaddingPx > 0
      ? ` style="padding-top:${restrictionTopPaddingPx.toFixed(3)}px;"`
      : '';
    const coordStyle = restrictionTopPaddingPx > 0
      ? ` style="padding-top:${(restrictionTopPaddingPx + 2).toFixed(3)}px;"`
      : '';

    lines.push(`
      <div class="sequence-viewer-dual-line" data-line-start="${lineStart}" data-line-end="${lineEnd}">
        <span class="sequence-viewer-seq-coord"${coordStyle}>${(lineStart + 1).toLocaleString()}</span>
        <div class="sequence-viewer-strand-block">
          <div class="sequence-viewer-strand-pair"${strandPairStyle}>
            ${hasCursorOnLine
    ? `<span class="sequence-viewer-line-cursor" style="left:${cursorLeftPx.toFixed(3)}px;top:${restrictionTopPaddingPx.toFixed(3)}px;height:${strandPairHeightPx.toFixed(3)}px;" aria-hidden="true"></span>`
    : ''}
            <div class="sequence-viewer-strand-row sequence-viewer-strand-row-top">
              <span class="sequence-viewer-strand-end">5'</span>
              <span class="sequence-viewer-seq-text sequence-viewer-seq-text-top">
                <span class="sequence-viewer-seq-text-content">${forwardBody}</span>
                ${lineRestrictionAnnotations.html}
              </span>
              <span class="sequence-viewer-strand-end">3'</span>
            </div>
            <div class="sequence-viewer-strand-row sequence-viewer-strand-row-bottom">
              <span class="sequence-viewer-strand-end">3'</span>
              <span class="sequence-viewer-seq-text"><span class="sequence-viewer-seq-text-content">${complementaryBody}</span></span>
              <span class="sequence-viewer-strand-end">5'</span>
            </div>
            ${aminoAcidRow}
          </div>
          ${lineFeatureButtons}
        </div>
      </div>
    `);
  }

  return lines.join('');
}

export function formatSelectedFeatureDetailHtml(feature, sequenceLength) {
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
    ${recognitionSite ? `<p><strong>Recognition Site:</strong> ${escapeHtml(recognitionSite)}</p>` : ''}
    ${cutSummary ? `<p><strong>${escapeHtml(cutSummary.label)}:</strong> ${escapeHtml(cutSummary.text)}</p>` : ''}
    ${enzymeNames.length ? `<p><strong>Enzymes:</strong> ${escapeHtml(enzymeNames.join(', '))}</p>` : ''}
    ${vendors.length ? `<p><strong>Vendors:</strong> ${escapeHtml(vendors.join(', '))}</p>` : ''}
    <p><strong>Identity:</strong> ${identity} · <strong>Coverage:</strong> ${coverage} · <strong>Source:</strong> ${escapeHtml(source)}</p>
    ${description ? `<p class="small-note">${escapeHtml(description)}</p>` : ''}
  `;
}
