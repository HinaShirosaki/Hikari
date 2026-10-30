import { clamp } from '../../shared.js';
import { getRenderableFeaturesForRecord } from '../../feature-model.js';

// Which features the vector map shows, and the base range the current ring or
// sequence-pane selection covers.
function createVectorSelection({
  state,
  vb,
  elements,
  getFeatureRange,
  isPrimerRelatedType
} = {}) {
  function getVisibleFeatures(record) {
    return getRenderableFeaturesForRecord(record, {
      includeOrf: false,
      includeRestriction: Boolean(vb().showCutters),
      restrictionVendorFilter: state.restrictionVendorFilter,
      includePrimers: state.showPrimers !== false
    });
  }

  function getFeatureByIndex(record, index) {
    if (!record || !Number.isFinite(index) || index < 0) {
      return null;
    }
    return getVisibleFeatures(record)[index] || null;
  }

  function clearSelection(options = {}) {
    const current = vb();
    current.selectionAnchor = null;
    current.selectionFocus = null;
    current.isSelecting = false;
    if (!options?.preserveCursor) {
      current.cursorBase = null;
    }
  }

  function getSelectionRange(record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const current = vb();
    const anchor = Number(current.selectionAnchor);
    const focus = Number(current.selectionFocus);
    if (!sequenceLength || !Number.isFinite(anchor) || !Number.isFinite(focus)) {
      return null;
    }
    const start = clamp(Math.min(anchor, focus), 0, sequenceLength);
    const end = clamp(Math.max(anchor, focus), 0, sequenceLength);
    return end > start ? { start, end } : null;
  }

  function hideContextMenu() {
    if (elements.vectorBuilderContextMenu) {
      elements.vectorBuilderContextMenu.hidden = true;
    }
  }

  // Replace Feature works on the record's *recorded* features -- the annotations
  // actually stored in the GenBank -- not on the derived overlays (restriction
  // sites), which have nothing to rewrite, nor on primer binding sites.
  function getRecordedFeaturesInRange(record, range) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    const start = Math.max(0, Number(range?.start) || 0);
    const end = Math.max(start, Number(range?.end) || start);
    return (Array.isArray(record?.features) ? record.features : [])
      .map((feature, index) => ({ feature, index, range: getFeatureRange(feature, sequenceLength) }))
      .filter((entry) => entry.range
        && entry.range.start < end
        && start < entry.range.end
        && !isPrimerRelatedType(entry.feature?.type));
  }

  return {
    hideContextMenu,
    getRecordedFeaturesInRange,
    getVisibleFeatures,
    getFeatureByIndex,
    clearSelection,
    getSelectionRange
  };
}

export { createVectorSelection };
