import { getRenderableFeaturesForRecord } from './feature-model.js';
import { isOrfFeature } from './orf-analysis.js';
import { clamp, cleanText } from './shared.js';

// Maps between a record's visible feature list and the indices the UI holds on
// to, so a re-annotation or ORF re-scan keeps pointing at the same feature.
function createDetailFeatureIndex({ state } = {}) {
  function getVisibleFeaturesForRecord(record) {
    // The alignment overlay is for comparing sequences; cutters just clutter it.
    const alignmentActive = Boolean(state.alignmentViewEnabled && state.activeAlignmentResult);
    return getRenderableFeaturesForRecord(record, {
      includeOrf: state.orfViewEnabled,
      orfStopCodons: state.orfStopCodons,
      orfFrameFilter: state.orfFrameFilter,
      restrictionVendorFilter: state.restrictionVendorFilter,
      includeRestriction: !alignmentActive,
      includePrimers: state.showPrimers !== false
    });
  }

  function getFeatureByIndexForRecord(record, index) {
    if (!record || !Number.isFinite(index) || index < 0) {
      return null;
    }
    const features = getVisibleFeaturesForRecord(record);
    return features[index] || null;
  }

  function findFeatureIndexByIdentity(features, feature) {
    if (!Array.isArray(features) || !features.length || !feature) {
      return -1;
    }

    const featureId = cleanText(feature.id, 240);
    if (featureId) {
      const byId = features.findIndex((item) => cleanText(item?.id, 240) === featureId);
      if (byId >= 0) {
        return byId;
      }
    }

    const source = cleanText(feature.source, 120);
    const name = cleanText(feature.name, 240);
    const type = cleanText(feature.type, 120);
    const strand = feature?.strand === -1 ? -1 : 1;
    const segmentKey = (Array.isArray(feature?.segments) ? feature.segments : [])
      .map((segment) => `${Math.round(Number(segment?.start) || 0)}-${Math.round(Number(segment?.end) || 0)}`)
      .join(',');

    return features.findIndex((item) => {
      if (!item) {
        return false;
      }
      const itemSegmentKey = (Array.isArray(item?.segments) ? item.segments : [])
        .map((segment) => `${Math.round(Number(segment?.start) || 0)}-${Math.round(Number(segment?.end) || 0)}`)
        .join(',');
      return cleanText(item.source, 120) === source
        && cleanText(item.name, 240) === name
        && cleanText(item.type, 120) === type
        && (item?.strand === -1 ? -1 : 1) === strand
        && itemSegmentKey === segmentKey;
    });
  }

  function findUpdatedOrfIndex(features, feature) {
    if (!Array.isArray(features) || !features.length || !isOrfFeature(feature)) {
      return -1;
    }
    const strand = feature?.strand === -1 ? -1 : 1;
    const frame = cleanText(feature?.orfFrame, 12);
    const firstStart = Array.isArray(feature?.segments)
      ? Math.round(Number(feature.segments[0]?.start) || 0)
      : 0;
    return features.findIndex((item) => {
      const itemStart = Array.isArray(item?.segments)
        ? Math.round(Number(item.segments[0]?.start) || 0)
        : 0;
      return isOrfFeature(item)
        && (item?.strand === -1 ? -1 : 1) === strand
        && cleanText(item?.orfFrame, 12) === frame
        && itemStart === firstStart;
    });
  }

  function clearSequenceSelection(options = {}) {
    const preserveCursor = Boolean(options?.preserveCursor);
    state.sequenceSelectionAnchor = null;
    state.sequenceSelectionFocus = null;
    state.isSelectingSequence = false;
    if (!preserveCursor) {
      state.sequenceCursorBase = null;
    }
  }

  function getSequenceSelectionSegments(record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    if (!sequenceLength) {
      return [];
    }

    const anchor = Number(state.sequenceSelectionAnchor);
    const focus = Number(state.sequenceSelectionFocus);
    if (!Number.isFinite(anchor) || !Number.isFinite(focus)) {
      return [];
    }

    const start = clamp(Math.min(anchor, focus), 0, sequenceLength);
    const end = clamp(Math.max(anchor, focus), 0, sequenceLength);
    if (end <= start) {
      return [];
    }
    return [{ start, end }];
  }

  return {
    getVisibleFeaturesForRecord,
    getFeatureByIndexForRecord,
    findFeatureIndexByIdentity,
    findUpdatedOrfIndex,
    clearSequenceSelection,
    getSequenceSelectionSegments
  };
}

export { createDetailFeatureIndex };
