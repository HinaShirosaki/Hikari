import "../localization.js";
import { escapeHtml } from '../../../lib/html.js';
import { FALLBACK_CHAR_ADVANCE_PX, FALLBACK_SEQUENCE_LINE_HEIGHT_PX, RESTRICTION_LABEL_GAP_PX, STRAND_PAIR_ROW_GAP_PX } from '../constants.js';
import { buildFeatureLocationText } from '../feature-model.js';
import { buildRestrictionCutPolylinePoints, computeRestrictionAnnotationGeometry, resolveRestrictionCutBaseIndices, resolveRestrictionCutLocalPx } from '../restriction-analysis.js';
import { RESTRICTION_LABEL_COLLISION_GAP_PX, RESTRICTION_LABEL_HORIZONTAL_PADDING_PX, RESTRICTION_STACK_LANE_STEP_PX } from './constants.js';

function estimateRestrictionLabelWidthPx(label, charAdvancePx) {
  const safeLabel = String(label || '');
  const labelAdvancePx = Math.max(7.5, charAdvancePx * 0.72);
  return Math.max(28, (safeLabel.length * labelAdvancePx) + RESTRICTION_LABEL_HORIZONTAL_PADDING_PX);
}

function assignRestrictionAnnotationLanes(fragments, lineWidthPx, maxShiftPx) {
  const sorted = [...fragments].sort((left, right) => {
    return left.labelCenterPx - right.labelCenterPx || left.index - right.index;
  });
  const lanes = [];

  sorted.forEach((fragment) => {
    const width = fragment.labelWidthPx;
    const preferredLeft = Math.max(0, Math.min(lineWidthPx - width, fragment.labelCenterPx - (width / 2)));
    let placement = null;
    // Pack the label bounds, not the recognition spans. Nearby labels may fan
    // out a little before adding another row; their guides retain the site link.
    for (let lane = 0; lane < lanes.length && !placement; lane += 1) {
      const intervals = lanes[lane];
      let gapStart = 0;
      let best = null;
      for (let slot = 0; slot <= intervals.length; slot += 1) {
        const gapEnd = slot < intervals.length
          ? intervals[slot].left - RESTRICTION_LABEL_COLLISION_GAP_PX
          : lineWidthPx;
        if (gapEnd - gapStart >= width) {
          const left = Math.max(gapStart, Math.min(gapEnd - width, preferredLeft));
          const shift = Math.abs(left - preferredLeft);
          if (shift <= maxShiftPx && (!best || shift < best.shift)) {
            best = { lane, slot, left, shift };
          }
        }
        if (slot < intervals.length) {
          gapStart = intervals[slot].right + RESTRICTION_LABEL_COLLISION_GAP_PX;
        }
      }
      placement = best;
    }
    if (!placement) {
      placement = { lane: lanes.length, slot: 0, left: preferredLeft };
      lanes.push([]);
    }
    lanes[placement.lane].splice(placement.slot, 0, { left: placement.left, right: placement.left + width });
    fragment.lane = placement.lane;
    fragment.labelLeftPx = placement.left;
  });

  return {
    fragments: sorted,
    laneCount: Math.max(1, lanes.length)
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
          const labelWidthPx = Math.min(lineWidthPx, estimateRestrictionLabelWidthPx(label, safeAdvance));
          const labelCenterPx = geometry.leftPx + (geometry.widthPx / 2);

          return {
            index,
            isActive,
            label,
            title,
            leftPx: geometry.leftPx,
            widthPx: geometry.widthPx,
            labelWidthPx,
            labelCenterPx,
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

  const { fragments: stackedFragments, laneCount } = assignRestrictionAnnotationLanes(fragments, lineWidthPx, safeAdvance * 9);
  const topPaddingPx = RESTRICTION_LABEL_GAP_PX + 5 + ((laneCount - 1) * RESTRICTION_STACK_LANE_STEP_PX);
  const guides = stackedFragments.map((fragment) => {
    const center = fragment.labelLeftPx + (fragment.labelWidthPx / 2);
    if (!fragment.lane && Math.abs(center - fragment.labelCenterPx) < 1) {
      return '';
    }
    const labelBottom = topPaddingPx - 3 - (fragment.lane * RESTRICTION_STACK_LANE_STEP_PX);
    return `<line class="sequence-viewer-restriction-guide${fragment.isActive ? ' sequence-viewer-restriction-guide-active' : ''}" x1="${center.toFixed(3)}" y1="${labelBottom.toFixed(3)}" x2="${fragment.labelCenterPx.toFixed(3)}" y2="${topPaddingPx.toFixed(3)}"></line>`;
  }).join('');
  const guideSvg = guides
    ? `<svg class="sequence-viewer-restriction-guides" style="top:-${topPaddingPx}px;width:${lineWidthPx.toFixed(3)}px;height:${topPaddingPx}px;" viewBox="0 0 ${lineWidthPx.toFixed(3)} ${topPaddingPx}" aria-hidden="true">${guides}</svg>`
    : '';
  const annotations = stackedFragments
    .map((fragment) => {
      const labelStackOffsetPx = fragment.lane * RESTRICTION_STACK_LANE_STEP_PX;
      return `
            <button
              type="button"
              class="sequence-viewer-restriction-annot${fragment.isActive ? ' sequence-viewer-restriction-annot-active' : ''}"
              data-feature-index="${fragment.index}"
              style="left:${fragment.leftPx.toFixed(3)}px;width:${fragment.widthPx.toFixed(3)}px;--sequence-viewer-restriction-lane-order:${fragment.lane + 1};--sequence-viewer-restriction-label-gap:${RESTRICTION_LABEL_GAP_PX}px;--sequence-viewer-restriction-label-stack-offset:${labelStackOffsetPx.toFixed(3)}px;"
              title="${escapeHtml(fragment.title)}"
            >
              <span class="sequence-viewer-restriction-label" style="left:${(fragment.labelLeftPx - fragment.leftPx).toFixed(3)}px;width:${fragment.labelWidthPx.toFixed(3)}px;">${escapeHtml(fragment.label)}</span>
              <span class="sequence-viewer-restriction-box"></span>
              ${fragment.cutPoints ? `<svg class="sequence-viewer-restriction-cut-svg" viewBox="0 0 ${fragment.svgWidth.toFixed(2)} ${fragment.svgHeight.toFixed(2)}" preserveAspectRatio="none" aria-hidden="true">
                <polyline points="${fragment.cutPoints}"></polyline>
              </svg>` : ''}
            </button>
          `;
    })
    .join('');

  return {
    html: `<div class="sequence-viewer-line-restriction-track" style="width:${lineWidthPx.toFixed(3)}px;height:${pairBoxHeightPx.toFixed(3)}px;--sequence-viewer-restriction-lanes:${laneCount};">${guideSvg}${annotations}</div>`,
    topPaddingPx
  };
}

export {
  renderLineRestrictionAnnotationsHtml
};
