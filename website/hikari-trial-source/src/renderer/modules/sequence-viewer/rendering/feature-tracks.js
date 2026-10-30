import { escapeHtml } from '../../../lib/html.js';
import { DEFAULT_STRAND_COLUMN_GAP_PX, DEFAULT_STRAND_MARKER_COLUMN_PX, FALLBACK_CHAR_ADVANCE_PX, LINE_FEATURE_BAR_GAP_PX, LINE_FEATURE_BAR_HEIGHT_PX, LINE_FEATURE_BAR_HORIZONTAL_PADDING_PX } from '../constants.js';
import { buildFeatureLocationText, hashTypeToColor } from '../feature-model.js';
import { isPrimerBindingFeature } from '../feature-types.js';
import { OLIGO_PRIMER_BAR_HEIGHT_PX, OLIGO_PRIMER_STYLE, buildOligoPrimerHtml, withOligoPrimerGeometry } from '../primer-oligo.js';
import { computeRestrictionAnnotationGeometry } from '../restriction-analysis.js';

function renderLineFeatureButtonsHtml(
  indexedFeatures,
  lineStart,
  lineEnd,
  sequenceLength,
  selectedFeatureIndex,
  charAdvancePx,
  lineFeatureOffsetPx = (DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX),
  templateSequence = ''
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
      const isPrimer = isPrimerBindingFeature(feature?.type);
      const direction = feature?.strand === -1 ? -1 : 1;
      return segments
        .map((segment) => {
          const geometry = computeRestrictionAnnotationGeometry(segment, lineStart, lineEnd, safeAdvance);
          if (!geometry) {
            return null;
          }
          const fragment = {
            feature,
            index,
            title,
            color,
            isPrimer,
            direction,
            hasFivePrime: isPrimer && (direction === -1
              ? geometry.overlapEnd === Number(segment?.end)
              : geometry.overlapStart === Number(segment?.start)),
            hasThreePrime: isPrimer && (direction === -1
              ? geometry.overlapStart === Number(segment?.start)
              : geometry.overlapEnd === Number(segment?.end)),
            leftPx: geometry.leftPx,
            widthPx: geometry.widthPx,
            rightPx: geometry.leftPx + geometry.widthPx
          };
          return isPrimer
            ? withOligoPrimerGeometry(fragment, {
              segment, lineStart, lineEnd, templateSequence, charAdvancePx: safeAdvance
            })
            : fragment;
        })
        .filter(Boolean);
    })
    .sort((left, right) => {
      if (left.leftPx !== right.leftPx) {
        return left.leftPx - right.leftPx;
      }
      return right.widthPx - left.widthPx;
    });

  const primerBarHeightPx = OLIGO_PRIMER_STYLE
    ? OLIGO_PRIMER_BAR_HEIGHT_PX
    : LINE_FEATURE_BAR_HEIGHT_PX;

  // Primers ride their own tracks on the side of the duplex they anneal to:
  // forward above the top strand, reverse below the bottom strand. Features
  // keep the shared track underneath, so a primer never steals a feature lane.
  const forwardPrimers = buildLineFeatureTrackHtml(fragments.filter((f) => f.isPrimer && f.direction === 1), {
    lineWidthPx, safeOffset, safeAdvance, selectedFeatureIndex, invertLanes: true, barHeightPx: primerBarHeightPx
  });
  const reversePrimers = buildLineFeatureTrackHtml(fragments.filter((f) => f.isPrimer && f.direction === -1), {
    lineWidthPx, safeOffset, safeAdvance, selectedFeatureIndex, barHeightPx: primerBarHeightPx
  });
  const features = buildLineFeatureTrackHtml(fragments.filter((f) => !f.isPrimer), {
    lineWidthPx, safeOffset, safeAdvance, selectedFeatureIndex
  });

  return {
    forwardPrimers: forwardPrimers.html,
    reversePrimers: reversePrimers.html,
    features: features.html,
    // The forward track and the feature track are siblings of the strand pair;
    // the reverse track is a row inside it. They are gapped differently, so the
    // caller needs them apart to work out how tall the line will be.
    forwardHeightPx: forwardPrimers.heightPx,
    reverseHeightPx: reversePrimers.heightPx,
    featuresHeightPx: features.heightPx
  };
}

function buildLineFeatureTrackHtml(fragments, options) {
  if (!fragments.length) {
    return { html: '', heightPx: 0 };
  }
  const { lineWidthPx, safeOffset, safeAdvance, selectedFeatureIndex, invertLanes } = options;
  const barHeightPx = Number(options.barHeightPx) || LINE_FEATURE_BAR_HEIGHT_PX;

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
  const trackHeightPx = (laneCount * barHeightPx) + ((laneCount - 1) * LINE_FEATURE_BAR_GAP_PX);
  const bars = fragments
    .map((fragment) => {
      // Lane 0 always sits closest to the strand, so tracks above it stack upwards.
      const laneSlot = invertLanes ? (laneCount - 1 - fragment.lane) : fragment.lane;
      const topPx = laneSlot * (barHeightPx + LINE_FEATURE_BAR_GAP_PX);
      const isActive = fragment.index === selectedFeatureIndex;
      const label = String(fragment.feature?.name || `feature_${fragment.index + 1}`);
      const labelWidthPx = (label.length * safeAdvance) + (LINE_FEATURE_BAR_HORIZONTAL_PADDING_PX * 2);
      // A wrapped primer is named once, on the fragment carrying its 5' end.
      const showLabel = fragment.widthPx >= (labelWidthPx + (fragment.isPrimer ? 38 : 0))
        && (!fragment.isPrimer || fragment.hasFivePrime);
      if (fragment.oligo) {
        return buildOligoPrimerHtml(fragment, { topPx, isActive, label, lineWidthPx });
      }
      if (fragment.isPrimer) {
        const directionClass = fragment.direction === -1
          ? 'sequence-viewer-line-feature-primer-reverse'
          : 'sequence-viewer-line-feature-primer-forward';
        const endClasses = [
          fragment.hasFivePrime ? 'sequence-viewer-line-feature-primer-has-five' : '',
          fragment.hasThreePrime ? 'sequence-viewer-line-feature-primer-has-three' : ''
        ].filter(Boolean).join(' ');
        return `
          <button
            type="button"
            class="sequence-viewer-line-feature sequence-viewer-line-feature-primer ${directionClass}${endClasses ? ` ${endClasses}` : ''}${isActive ? ' sequence-viewer-line-feature-active' : ''}"
            data-feature-index="${fragment.index}"
            style="left:${fragment.leftPx.toFixed(3)}px;width:${fragment.widthPx.toFixed(3)}px;top:${topPx.toFixed(3)}px;--sequence-viewer-primer-color:${fragment.color};color:${fragment.color};"
            title="${escapeHtml(fragment.title)}"
            aria-label="${escapeHtml(fragment.title)}"
          >
            <span class="sequence-viewer-primer-oligo-line" aria-hidden="true"></span>
            ${fragment.hasFivePrime ? '<span class="sequence-viewer-primer-end sequence-viewer-primer-end-five" aria-hidden="true">5′</span>' : ''}
            ${fragment.hasThreePrime ? `
              <span class="sequence-viewer-primer-end sequence-viewer-primer-end-three" aria-hidden="true">3′</span>
              <span class="sequence-viewer-primer-arrow" aria-hidden="true"></span>
            ` : ''}
            ${showLabel ? `<span class="sequence-viewer-line-feature-label sequence-viewer-primer-label">${escapeHtml(label)}</span>` : ''}
          </button>
        `;
      }
      return `
        <button
          type="button"
          class="sequence-viewer-line-feature sequence-viewer-line-feature-bar${isActive ? ' sequence-viewer-line-feature-active' : ''}${showLabel ? '' : ' sequence-viewer-line-feature-compact'}"
          data-feature-index="${fragment.index}"
          style="left:${fragment.leftPx.toFixed(3)}px;width:${fragment.widthPx.toFixed(3)}px;top:${topPx.toFixed(3)}px;--sequence-viewer-feature-color:${fragment.color};"
          title="${escapeHtml(fragment.title)}"
        >${showLabel ? `<span class="sequence-viewer-line-feature-label">${escapeHtml(label)}</span>` : ''}</button>
      `;
    })
    .join('');

  return {
    html: `<div class="sequence-viewer-line-features" style="width:${lineWidthPx.toFixed(3)}px;height:${trackHeightPx.toFixed(3)}px;margin-left:${safeOffset.toFixed(3)}px;">${bars}</div>`,
    heightPx: trackHeightPx
  };
}

export {
  renderLineFeatureButtonsHtml
};
