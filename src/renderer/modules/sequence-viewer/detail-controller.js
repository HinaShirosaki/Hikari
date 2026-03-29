import { escapeHtml } from '../tool-box/common.js';
import {
  FALLBACK_CHAR_ADVANCE_PX,
} from './constants.js';
import {
  getRenderableFeaturesForRecord,
} from './feature-model.js';
import { isOrfFeature } from './orf-analysis.js';
import * as detailAlignment from './detail-alignment.js';
import { bindSequenceViewerDetailEvents } from './detail-events.js';
import { createSequenceViewerFeatureEditingController } from './detail-feature-editing.js';
import { createSequenceHoverTooltipController } from './detail-hover.js';
import { createSequenceViewerDetailRenderingController } from './detail-rendering.js';
import { normalizeRestrictionVendorFilter } from './restriction-analysis.js';
import {
  cleanText,
  clamp,
} from './shared.js';
import { normalizeOrfStopCodonVisibility } from './translation-style.js';

export function createSequenceViewerDetailController(config = {}) {
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const elements = config?.elements || {};
  const state = config?.state || {};

  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const updateMessages = config?.updateMessages || (() => {});
  const setStatus = config?.setStatus || (() => {});
  const hasStoragePath = config?.hasStoragePath || (() => false);
  const persistFeatureMutation = config?.persistFeatureMutation || (async () => {});
  const onRequestAnnotation = config?.onRequestAnnotation || (() => {});
  const onRequestRecognizeBackbone = config?.onRequestRecognizeBackbone || (() => {});
  const onRequestClear = config?.onRequestClear || (() => {});
  const onRequestSave = config?.onRequestSave || (() => {});
  const onRequestAlignment = config?.onRequestAlignment || (() => {});
  const onSelectAlignmentSession = config?.onSelectAlignmentSession || (() => {});
  const onNavigateHome = config?.onNavigateHome || (() => {});
  const onRefreshLibraryEntries = config?.onRefreshLibraryEntries || (() => {});
  const onReferenceRecordChanged = config?.onReferenceRecordChanged || (() => {});

  const hoverController = createSequenceHoverTooltipController(rootDocument);
  const hideSequenceHoverTooltip = () => hoverController.hide();
  const showSequenceHoverTooltip = (event, feature, sequenceLength) => {
    hoverController.show(event, feature, sequenceLength);
  };
  let featureEditingController = null;
  let activeFeatureActionContext = null;

  function getVisibleFeaturesForRecord(record) {
    return getRenderableFeaturesForRecord(record, {
      includeOrf: state.orfViewEnabled,
      restrictionVendorFilter: state.restrictionVendorFilter
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

  function getSequenceSelectionRange(record) {
    return getSequenceSelectionSegments(record)[0] || null;
  }

  function hideFeatureContextMenu() {
    activeFeatureActionContext = null;
    featureEditingController?.hideFeatureContextMenu();
  }

  function hideFeatureEditor() {
    featureEditingController?.hideFeatureEditor();
  }

  function buildSelectionDetailHtml(record) {
    return featureEditingController?.buildSelectionDetailHtml(record)
      || '<p class="small-note">Select a feature in the bottom track to view details.</p>';
  }

  function renderFeatureContextMenu(context, event) {
    activeFeatureActionContext = context;
    featureEditingController?.renderFeatureContextMenu(context, event);
  }

  function resolveFeatureActionContext(record, event) {
    return featureEditingController?.resolveFeatureActionContext(record, event) || null;
  }

  function openFeatureEditor(mode, context = {}) {
    featureEditingController?.openFeatureEditor(mode, context);
  }

  async function applyFeatureEditorChanges() {
    await featureEditingController?.applyFeatureEditorChanges();
  }

  async function deleteFeatureFromContext(context = {}) {
    await featureEditingController?.deleteFeatureFromContext(context);
  }

  const detailRenderingController = createSequenceViewerDetailRenderingController({
    rootDocument,
    elements,
    state,
    getVisibleFeaturesForRecord,
    getSequenceSelectionSegments,
    getAlignmentHighlightSegments,
    hideSequenceHoverTooltip,
    buildSelectionDetailHtml
  });

  function resolveSequenceBoundaryFromEvent(event, record) {
    const sequenceLength = Math.max(0, Number(record?.sequence?.length) || 0);
    if (!sequenceLength) {
      return null;
    }

    const target = event?.target;
    const lineElement = target?.closest?.('.sequence-viewer-dual-line') || null;
    if (!lineElement) {
      return null;
    }

    const lineStart = Number(lineElement?.dataset?.lineStart);
    const lineEnd = Number(lineElement?.dataset?.lineEnd);
    if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd) || lineEnd <= lineStart) {
      return null;
    }

    const lineSpan = lineEnd - lineStart;
    const seqTextElement = lineElement.querySelector?.('.sequence-viewer-strand-row-top .sequence-viewer-seq-text');
    const rawX = Number(event?.clientX);
    const safeAdvance = Math.max(1, Number(state.sequenceLayout?.charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX);

    let relativeX = null;
    if (seqTextElement && Number.isFinite(rawX) && typeof seqTextElement.getBoundingClientRect === 'function') {
      const rect = seqTextElement.getBoundingClientRect();
      if (Number.isFinite(rect?.left) && Number.isFinite(rect?.width) && rect.width > 0) {
        relativeX = clamp(rawX - rect.left, 0, rect.width);
      }
    }

    if (!Number.isFinite(relativeX)) {
      const fallbackOffsetX = Number(event?.offsetX);
      if (Number.isFinite(fallbackOffsetX)) {
        relativeX = Math.max(0, fallbackOffsetX);
      }
    }
    if (!Number.isFinite(relativeX)) {
      return null;
    }

    const localBoundary = clamp(Math.round(relativeX / safeAdvance), 0, lineSpan);
    return clamp(lineStart + localBoundary, 0, sequenceLength);
  }

  function syncAnnotateButtonState() {
    const hasRecord = Boolean(getSelectedRecord()?.sequence?.length);
    if (elements.annotateBtn) {
      elements.annotateBtn.disabled = state.isAnnotating || !hasRecord;
    }
    if (elements.recognizeBackboneBtn) {
      elements.recognizeBackboneBtn.disabled = !hasRecord || !hasStoragePath() || Boolean(state.isRecognizingBackbone);
    }
    if (elements.saveBtn) {
      elements.saveBtn.disabled = !hasRecord || !hasStoragePath();
    }
    if (elements.alignmentOpenBtn) {
      elements.alignmentOpenBtn.disabled = !hasRecord;
    }
  }

  function syncAlignmentControlsState() {
    detailAlignment.syncAlignmentControlsState({
      elements,
      state,
      record: getSelectedRecord()
    });
  }

  function syncOrfToggleState() {
    const hasRecord = Boolean(getSelectedRecord()?.sequence?.length);
    const stopVisibility = normalizeOrfStopCodonVisibility(state.orfStopVisibility);
    if (elements.orfToggle) {
      elements.orfToggle.checked = Boolean(state.orfViewEnabled);
      elements.orfToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTagToggle) {
      elements.orfStopTagToggle.checked = Boolean(stopVisibility.TAG);
      elements.orfStopTagToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTaaToggle) {
      elements.orfStopTaaToggle.checked = Boolean(stopVisibility.TAA);
      elements.orfStopTaaToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTgaToggle) {
      elements.orfStopTgaToggle.checked = Boolean(stopVisibility.TGA);
      elements.orfStopTgaToggle.disabled = !hasRecord;
    }
  }

  function readOrfStopVisibilityFromControls() {
    return normalizeOrfStopCodonVisibility({
      TAG: Boolean(elements.orfStopTagToggle?.checked),
      TAA: Boolean(elements.orfStopTaaToggle?.checked),
      TGA: Boolean(elements.orfStopTgaToggle?.checked)
    });
  }

  function getAlignmentHighlightSegments(record) {
    return detailAlignment.getAlignmentHighlightSegments(state, record);
  }

  function syncRestrictionVendorToggleState() {
    if (elements.restrictionNebToggle) {
      elements.restrictionNebToggle.checked = Boolean(state.restrictionVendorFilter?.neb);
    }
    if (elements.restrictionThermoToggle) {
      elements.restrictionThermoToggle.checked = Boolean(state.restrictionVendorFilter?.thermo);
    }
  }

  function updateRecordSelect() {
    if (!elements.recordSelect) {
      return;
    }
    if (!state.records.length) {
      elements.recordSelect.innerHTML = '<option value="">No records loaded</option>';
      elements.recordSelect.disabled = true;
      return;
    }

    elements.recordSelect.disabled = false;
    elements.recordSelect.innerHTML = state.records
      .map((record, index) => {
        const selected = index === state.selectedRecordIndex ? ' selected' : '';
        const label = `${record.name} (${record.sequence.length.toLocaleString()} bp)`;
        return `<option value="${index}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function renderFeatureRail(record) {
    detailRenderingController.renderFeatureRail(record);
  }

  function renderSelectedFeatureDetail(record) {
    detailRenderingController.renderSelectedFeatureDetail(record);
  }

  function renderSequence(record, options = {}) {
    detailRenderingController.renderSequence(record, options);
  }

  function renderStats(record) {
    detailRenderingController.renderStats(record);
  }

  function renderActiveRecord() {
    const record = getSelectedRecord();
    renderStats(record);
    renderSequence(record);
    renderFeatureRail(record);
    renderSelectedFeatureDetail(record);
    syncAnnotateButtonState();
    syncAlignmentControlsState();
    syncOrfToggleState();
    syncRestrictionVendorToggleState();
    updateMessages();
  }

  function setOrfViewEnabled(nextEnabled) {
    const record = getSelectedRecord();
    const previousFeatures = getVisibleFeaturesForRecord(record);
    const selectedFeature = (
      Number.isFinite(state.selectedFeatureIndex)
      && state.selectedFeatureIndex >= 0
      && state.selectedFeatureIndex < previousFeatures.length
    ) ? previousFeatures[state.selectedFeatureIndex] : null;

    state.orfViewEnabled = Boolean(nextEnabled);

    if (!state.orfViewEnabled && isOrfFeature(selectedFeature)) {
      state.selectedFeatureIndex = -1;
    } else if (selectedFeature) {
      const nextFeatures = getVisibleFeaturesForRecord(record);
      state.selectedFeatureIndex = findFeatureIndexByIdentity(nextFeatures, selectedFeature);
    } else {
      state.selectedFeatureIndex = -1;
    }

    renderActiveRecord();
  }

  function setRestrictionVendorFilter(nextFilter) {
    const record = getSelectedRecord();
    const previousFeatures = getVisibleFeaturesForRecord(record);
    const selectedFeature = (
      Number.isFinite(state.selectedFeatureIndex)
      && state.selectedFeatureIndex >= 0
      && state.selectedFeatureIndex < previousFeatures.length
    ) ? previousFeatures[state.selectedFeatureIndex] : null;

    state.restrictionVendorFilter = normalizeRestrictionVendorFilter(nextFilter);

    if (selectedFeature) {
      const nextFeatures = getVisibleFeaturesForRecord(record);
      state.selectedFeatureIndex = findFeatureIndexByIdentity(nextFeatures, selectedFeature);
    } else {
      state.selectedFeatureIndex = -1;
    }

    renderActiveRecord();
  }

  featureEditingController = createSequenceViewerFeatureEditingController({
    elements,
    state,
    getSelectedRecord,
    getVisibleFeaturesForRecord,
    getFeatureByIndexForRecord,
    findFeatureIndexByIdentity,
    getSequenceSelectionRange,
    clearSequenceSelection,
    renderActiveRecord,
    setStatus,
    persistFeatureMutation
  });

  function bindEvents() {
    bindSequenceViewerDetailEvents({
      elements,
      state,
      getSelectedRecord,
      getVisibleFeaturesForRecord,
      clearSequenceSelection,
      hideFeatureContextMenu,
      hideFeatureEditor,
      hideSequenceHoverTooltip,
      showSequenceHoverTooltip,
      renderActiveRecord,
      renderSequence,
      renderSelectedFeatureDetail,
      setOrfViewEnabled,
      readOrfStopVisibilityFromControls,
      setRestrictionVendorFilter,
      resolveSequenceBoundaryFromEvent,
      resolveFeatureActionContext,
      renderFeatureContextMenu,
      openFeatureEditor,
      deleteFeatureFromContext,
      applyFeatureEditorChanges,
      getActiveFeatureActionContext: () => activeFeatureActionContext,
      onRequestAnnotation,
      onRequestRecognizeBackbone,
      onRequestClear,
      onRequestSave,
      onRequestAlignment,
      onSelectAlignmentSession,
      onNavigateHome,
      onRefreshLibraryEntries,
      onReferenceRecordChanged
    });
  }

  return {
    bindEvents,
    clearSequenceSelection,
    findFeatureIndexByIdentity,
    getVisibleFeaturesForRecord,
    hideFeatureContextMenu,
    hideFeatureEditor,
    renderActiveRecord,
    renderSelectedFeatureDetail,
    renderSequence,
    setOrfViewEnabled,
    setRestrictionVendorFilter,
    syncAnnotateButtonState,
    syncAlignmentControlsState,
    syncOrfToggleState,
    syncRestrictionVendorToggleState,
    updateRecordSelect
  };
}
