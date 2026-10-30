import { escapeHtml } from '../../../lib/html.js';
import { FALLBACK_CHAR_ADVANCE_PX, FALLBACK_SEQUENCE_LINE_HEIGHT_PX, RESTRICTION_LABEL_GAP_PX, STRAND_PAIR_ROW_GAP_PX } from '../constants.js';
import { buildFeatureLocationText } from '../feature-model.js';
import { buildRestrictionCutPolylinePoints, computeRestrictionAnnotationGeometry, resolveRestrictionCutBaseIndices, resolveRestrictionCutLocalPx } from '../restriction-analysis.js';
import { RESTRICTION_LABEL_COLLISION_GAP_PX, RESTRICTION_LABEL_HORIZONTAL_PADDING_PX, RESTRICTION_STACK_LANE_STEP_PX } from './constants.js';

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
      const labelStackOffsetPx = fragment.lane * RESTRICTION_STACK_LANE_STEP_PX;
      return `
            <button
              type="button"
              class="sequence-viewer-restriction-annot${fragment.isActive ? ' sequence-viewer-restriction-annot-active' : ''}"
              data-feature-index="${fragment.index}"
              style="left:${fragment.leftPx.toFixed(3)}px;width:${fragment.widthPx.toFixed(3)}px;z-index:${fragment.lane + 1};--sequence-viewer-restriction-label-gap:${RESTRICTION_LABEL_GAP_PX}px;--sequence-viewer-restriction-label-stack-offset:${labelStackOffsetPx.toFixed(3)}px;"
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

export {
  renderLineRestrictionAnnotationsHtml
};
