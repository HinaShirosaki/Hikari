import { escapeHtml } from '../tool-box/common.js';
import { DUAL_STRAND_SCROLL_STEP } from './constants.js';
import {
  assignFeatureLanes,
  buildFeatureLocationText,
  hashTypeToColor
} from './feature-model.js';
import { buildSelectedOrfTranslationContext } from './orf-analysis.js';
import { summarizeFastqQuality } from './parsing.js';
import { computeSequenceLayoutMetrics } from './detail-layout.js';
import {
  formatSelectedFeatureDetailHtml,
  normalizeHighlightSegments,
  renderDualStrandSequenceLinesHtml
} from './rendering.js';
import { computeGcPercent, countAmbiguousBases } from './shared.js';

export function createSequenceViewerDetailRenderingController(config = {}) {
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const elements = config?.elements || {};
  const state = config?.state || {};
  const getVisibleFeaturesForRecord = config?.getVisibleFeaturesForRecord || (() => []);
  const getSequenceSelectionSegments = config?.getSequenceSelectionSegments || (() => []);
  const getAlignmentHighlightSegments = config?.getAlignmentHighlightSegments || (() => []);
  const hideSequenceHoverTooltip = config?.hideSequenceHoverTooltip || (() => {});
  const buildSelectionDetailHtml = config?.buildSelectionDetailHtml || (() => '');

  function renderFeatureRail(record) {
    if (!elements.featureRailHost) {
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    const sequenceLength = Math.max(1, record?.sequence?.length || 1);
    if (!features.length) {
      elements.featureRailHost.innerHTML = '<p class="small-note">No features to display.</p>';
      return;
    }

    const laidOut = assignFeatureLanes(features);
    const laneCount = Math.max(1, laidOut.reduce((max, feature) => Math.max(max, feature.lane + 1), 1));
    const railHeight = Math.max(48, (laneCount * 18) + 18);

    const bars = laidOut.map((feature, index) => {
      const colorKey = feature.type === 'restriction_site' ? `${feature.type}:${feature.name}` : feature.type;
      const color = hashTypeToColor(colorKey);
      const locationText = buildFeatureLocationText(feature, sequenceLength);
      return (Array.isArray(feature.segments) ? feature.segments : [])
        .map((segment) => {
          const left = ((segment.start / sequenceLength) * 100).toFixed(3);
          const width = Math.max(0.35, ((segment.end - segment.start) / sequenceLength) * 100).toFixed(3);
          const top = (feature.lane * 18) + 8;
          const isActive = index === state.selectedFeatureIndex;
          const title = `${feature.name || '-'} (${locationText})`;
          return `
            <button
              class="sequence-viewer-feature-bar${isActive ? ' sequence-viewer-feature-bar-active' : ''}"
              type="button"
              data-feature-index="${index}"
              style="left:${left}%;width:${width}%;top:${top}px;background:${color};"
              title="${escapeHtml(title)}"
            ></button>
          `;
        })
        .join('');
    }).join('');

    elements.featureRailHost.innerHTML = `
      <div class="sequence-viewer-feature-rail" style="height:${railHeight}px;">
        ${bars}
      </div>
      <div class="sequence-viewer-feature-axis">
        <span style="left:0%;">1</span>
        <span style="left:25%;">${Math.max(1, Math.round(sequenceLength * 0.25)).toLocaleString()}</span>
        <span style="left:50%;">${Math.max(1, Math.round(sequenceLength * 0.5)).toLocaleString()}</span>
        <span style="left:75%;">${Math.max(1, Math.round(sequenceLength * 0.75)).toLocaleString()}</span>
        <span style="left:100%;">${sequenceLength.toLocaleString()}</span>
      </div>
    `;
  }

  function renderSelectedFeatureDetail(record) {
    if (!elements.featureDetail) {
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    if (!features.length || state.selectedFeatureIndex < 0) {
      elements.featureDetail.innerHTML = buildSelectionDetailHtml(record);
      return;
    }

    const selected = features[state.selectedFeatureIndex] || null;
    elements.featureDetail.innerHTML = formatSelectedFeatureDetailHtml(selected, record.sequence.length);
  }

  function renderSequence(record, options = {}) {
    if (!elements.sequenceHost) {
      return;
    }
    hideSequenceHoverTooltip();

    const preserveScroll = Boolean(options?.preserveScroll);
    const previousScrollTop = preserveScroll ? Math.max(0, Number(elements.sequenceHost.scrollTop) || 0) : 0;

    if (!record) {
      elements.sequenceHost.innerHTML = '<p class="small-note">Load sequence data to begin.</p>';
      return;
    }

    const features = getVisibleFeaturesForRecord(record);
    const selectedFeature = (features.length && state.selectedFeatureIndex >= 0)
      ? features[state.selectedFeatureIndex] || null
      : null;
    const orfTranslationContext = state.orfViewEnabled
      ? buildSelectedOrfTranslationContext(record.sequence, selectedFeature, {
        stopCodons: state.orfStopCodons
      })
      : null;

    const selectionHighlights = getSequenceSelectionSegments(record);
    const alignmentHighlights = getAlignmentHighlightSegments(record);
    const highlights = selectionHighlights.length
      ? selectionHighlights
      : (alignmentHighlights.length
        ? alignmentHighlights
        : normalizeHighlightSegments(selectedFeature?.segments || [], record.sequence.length));
    const { lineLength, charAdvancePx, lineHeightPx, lineFeatureOffsetPx } = computeSequenceLayoutMetrics(
      rootDocument,
      elements.sequenceHost
    );
    state.sequenceLayout = {
      lineLength,
      charAdvancePx,
      lineHeightPx,
      lineFeatureOffsetPx
    };

    elements.sequenceHost.innerHTML = renderDualStrandSequenceLinesHtml(record.sequence, highlights, {
      lineLength,
      charAdvancePx,
      sequenceLineHeightPx: lineHeightPx,
      lineFeatureOffsetPx,
      features,
      selectedFeatureIndex: state.selectedFeatureIndex,
      cursorBaseIndex: state.sequenceCursorBase,
      orfTranslationContext
    });

    if (preserveScroll) {
      elements.sequenceHost.scrollTop = previousScrollTop;
    } else if (highlights.length) {
      const first = highlights[0];
      const firstLine = Math.max(0, Math.floor((Number(first?.start) || 0) / lineLength));
      elements.sequenceHost.scrollTop = Math.max(0, (firstLine * DUAL_STRAND_SCROLL_STEP) - 42);
    } else {
      elements.sequenceHost.scrollTop = 0;
    }
  }

  function renderStats(record) {
    if (!record) {
      if (elements.statFormat) elements.statFormat.textContent = '-';
      if (elements.statLength) elements.statLength.textContent = '0';
      if (elements.statTopology) elements.statTopology.textContent = '-';
      if (elements.statGc) elements.statGc.textContent = '-';
      if (elements.statAmbiguous) elements.statAmbiguous.textContent = '-';
      if (elements.statQuality) elements.statQuality.textContent = '-';
      if (elements.statFeatures) elements.statFeatures.textContent = '0';
      if (elements.statRestrictionSites) elements.statRestrictionSites.textContent = '0';
      return;
    }

    const gc = computeGcPercent(record.sequence);
    const ambiguous = countAmbiguousBases(record.sequence);
    const qualitySummary = summarizeFastqQuality(record.quality);
    const allFeatures = getVisibleFeaturesForRecord(record);
    const restrictionFeatures = allFeatures.filter(
      (feature) => String(feature?.type || '').toLowerCase() === 'restriction_site'
    );

    if (elements.statFormat) {
      elements.statFormat.textContent = String(record.sourceFormat || '-').toUpperCase();
    }
    if (elements.statLength) {
      elements.statLength.textContent = record.sequence.length.toLocaleString();
    }
    if (elements.statTopology) {
      elements.statTopology.textContent = String(record.topology || 'linear');
    }
    if (elements.statGc) {
      elements.statGc.textContent = `${gc.toFixed(2)}%`;
    }
    if (elements.statAmbiguous) {
      elements.statAmbiguous.textContent = ambiguous.toLocaleString();
    }
    if (elements.statFeatures) {
      elements.statFeatures.textContent = allFeatures.length.toLocaleString();
    }
    if (elements.statRestrictionSites) {
      elements.statRestrictionSites.textContent = restrictionFeatures.length.toLocaleString();
    }
    if (elements.statQuality) {
      elements.statQuality.textContent = qualitySummary
        ? `Q${qualitySummary.min.toFixed(1)} / ${qualitySummary.mean.toFixed(1)} / ${qualitySummary.max.toFixed(1)}`
        : 'n/a';
    }
  }

  return {
    renderFeatureRail,
    renderSelectedFeatureDetail,
    renderSequence,
    renderStats
  };
}
