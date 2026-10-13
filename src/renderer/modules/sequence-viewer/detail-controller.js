import { escapeHtml } from '../../lib/html.js';
import {
  FALLBACK_CHAR_ADVANCE_PX
} from './constants.js';
import { isOrfFeature } from './orf-analysis.js';
import { bindSequenceViewerDetailEvents } from './detail-events.js';
import { createSequenceViewerAminoAcidEditingController } from './detail-amino-acid-editing.js';
import { createSequenceViewerFeatureEditingController } from './detail-feature-editing.js';
import { createSequenceHoverTooltipController } from './detail-hover.js';
import { resolveSequenceBoundaryFromEvent as resolveSequenceBoundaryFromEventShared } from './detail-layout.js';
import { createSequenceViewerDetailRenderingController } from './detail-rendering.js';
import { createSequenceViewerSequenceEditingController } from './detail-sequence-editing.js';
import { normalizeRestrictionVendorFilter } from './restriction-analysis.js';
import { normalizeOrfStopCodonSelection } from './translation-style.js';
import { createDetailControlSync } from './detail-control-sync.js';
import { createDetailFeatureIndex } from './detail-feature-index.js';

// ORF reading frames paired with their toolbar toggle element keys.
const ORF_FRAME_TOGGLES = [
  ['+1', 'orfFramePlus1Toggle'],
  ['+2', 'orfFramePlus2Toggle'],
  ['+3', 'orfFramePlus3Toggle'],
  ['-1', 'orfFrameMinus1Toggle'],
  ['-2', 'orfFrameMinus2Toggle'],
  ['-3', 'orfFrameMinus3Toggle']
];

function normalizeOrfFrameFilter(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const [frame] of ORF_FRAME_TOGGLES) {
    result[frame] = source[frame] !== false;
  }
  return result;
}

export function createSequenceViewerDetailController(config = {}) {
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const elements = config?.elements || {};
  const state = config?.state || {};

  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const updateMessages = config?.updateMessages || (() => {});
  const setStatus = config?.setStatus || (() => {});
  const hasStoragePath = config?.hasStoragePath || (() => false);
  const persistFeatureMutation = config?.persistFeatureMutation || (async () => {});
  const onRequestSave = config?.onRequestSave || (() => {});
  const onRequestAnnotate = config?.onRequestAnnotate || (() => {});
  const onRequestRecognizeBackbone = config?.onRequestRecognizeBackbone || (() => {});
  const onRequestAlignment = config?.onRequestAlignment || (() => {});
  const onRequestCloningDesign = config?.onRequestCloningDesign || (() => {});
  const onSelectAlignmentSession = config?.onSelectAlignmentSession || (() => {});
  const onConfirmProteinBuilderConstruct = config?.onConfirmProteinBuilderConstruct || (() => {});
  const onReturnToProteinBuilder = config?.onReturnToProteinBuilder || (() => {});
  const onReferenceRecordChanged = config?.onReferenceRecordChanged || (() => {});
  const onApplySequenceEdit = config?.onApplySequenceEdit || (async () => {});
  const onApplyAminoAcidEdit = config?.onApplyAminoAcidEdit || (async () => {});
  const hasCloningDesignSource = config?.hasCloningDesignSource || (() => false);
  const onRequestPrimerOrder = config?.onRequestPrimerOrder || (() => {});

  const hoverController = createSequenceHoverTooltipController(rootDocument);
  const hideSequenceHoverTooltip = () => hoverController.hide();
  const showSequenceHoverTooltip = (event, feature, sequenceLength) => {
    hoverController.show(event, feature, sequenceLength, getSelectedRecord()?.sequence || '');
  };
  let aminoAcidEditingController = null;
  let featureEditingController = null;
  let sequenceEditingController = null;
  let activeFeatureActionContext = null;

  const {
    getVisibleFeaturesForRecord,
    getFeatureByIndexForRecord,
    findFeatureIndexByIdentity,
    findUpdatedOrfIndex,
    clearSequenceSelection,
    getSequenceSelectionSegments
  } = createDetailFeatureIndex({ state });

  const {
    syncActionButtonsState,
    syncAlignmentControlsState,
    syncOrfToggleState,
    readOrfStopCodonsFromControls,
    readOrfFrameFilterFromControls,
    getAlignmentHighlightSegments,
    syncPrimersToggleState,
    syncRestrictionVendorToggleState,
    renderProteinBuilderConfirmation
  } = createDetailControlSync({
    elements,
    state,
    ORF_FRAME_TOGGLES,
    normalizeOrfFrameFilter,
    getSelectedRecord,
    hasStoragePath,
    hasCloningDesignSource
  });


  function getSequenceSelectionRange(record) {
    return getSequenceSelectionSegments(record)[0] || null;
  }

  function hideFeatureContextMenu() {
    activeFeatureActionContext = null;
    aminoAcidEditingController?.clearContext({ hideMenu: false });
    featureEditingController?.hideFeatureContextMenu();
  }

  function hideFeatureEditor() {
    featureEditingController?.hideFeatureEditor();
  }

  function hidePrimerDesignOverlay() {
    featureEditingController?.hidePrimerDesignOverlay();
  }

  function openPrimerDesignOverlay(context) {
    return featureEditingController?.openPrimerDesignOverlay(context);
  }

  function hideSequenceEditDialog() {
    sequenceEditingController?.hideSequenceEditDialog();
  }

  function buildSelectionDetailHtml(record) {
    return featureEditingController?.buildSelectionDetailHtml(record)
      || '<p class="small-note">Select a feature in the bottom track to view details.</p>';
  }

  function renderFeatureContextMenu(context, event) {
    activeFeatureActionContext = context;
    aminoAcidEditingController?.clearContext({ hideMenu: false });
    featureEditingController?.renderFeatureContextMenu(context, event);
  }

  function resolveFeatureActionContext(record, event) {
    return featureEditingController?.resolveFeatureActionContext(record, event) || null;
  }

  function resolveAminoAcidActionContext(record, event) {
    return aminoAcidEditingController?.resolveContext(record, event) || null;
  }

  function renderAminoAcidContextMenu(context, event) {
    activeFeatureActionContext = null;
    featureEditingController?.hideFeatureContextMenu();
    aminoAcidEditingController?.renderContextMenu(context, event);
  }

  async function applyAminoAcidReplacement(targetAminoAcid) {
    await aminoAcidEditingController?.applyReplacement(targetAminoAcid);
  }

  function openFeatureEditor(mode, context = {}) {
    featureEditingController?.openFeatureEditor(mode, context);
  }

  function openPrimerDesignOverlay(context = {}) {
    featureEditingController?.openPrimerDesignOverlay(context);
  }

  async function applyFeatureEditorChanges() {
    await featureEditingController?.applyFeatureEditorChanges();
  }

  async function deleteFeatureFromContext(context = {}) {
    await featureEditingController?.deleteFeatureFromContext(context);
  }

  function openSequenceEditFromKeyboardEvent(event) {
    return sequenceEditingController?.openSequenceEditFromKeyboardEvent(event) || false;
  }

  async function applySequenceEditDialog() {
    await sequenceEditingController?.applySequenceEditDialog();
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
    return resolveSequenceBoundaryFromEventShared(
      event,
      record,
      Number(state.sequenceLayout?.charAdvancePx) || FALLBACK_CHAR_ADVANCE_PX
    );
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

  function updateSequenceCursor() {
    detailRenderingController.updateCursorOnly();
  }

  function renderStats(record) {
    detailRenderingController.renderStats(record);
  }

  function renderActiveRecord(options = {}) {
    const record = getSelectedRecord();
    renderProteinBuilderConfirmation(record);
    renderStats(record);
    renderSequence(record, { preserveScroll: Boolean(options?.preserveScroll) });
    renderFeatureRail(record);
    renderSelectedFeatureDetail(record);
    syncActionButtonsState();
    syncAlignmentControlsState();
    syncOrfToggleState();
    syncRestrictionVendorToggleState();
    syncPrimersToggleState();
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

    renderActiveRecord({ preserveScroll: true });
  }

  // Changing what is visible renumbers the feature list, so the selection has to
  // be re-found by identity rather than kept by index.
  function withFeatureVisibilityChange(applyChange) {
    const record = getSelectedRecord();
    const previousFeatures = getVisibleFeaturesForRecord(record);
    const selectedFeature = (
      Number.isFinite(state.selectedFeatureIndex)
      && state.selectedFeatureIndex >= 0
      && state.selectedFeatureIndex < previousFeatures.length
    ) ? previousFeatures[state.selectedFeatureIndex] : null;

    applyChange();

    if (selectedFeature) {
      const nextFeatures = getVisibleFeaturesForRecord(record);
      state.selectedFeatureIndex = findFeatureIndexByIdentity(nextFeatures, selectedFeature);
    } else {
      state.selectedFeatureIndex = -1;
    }

    renderActiveRecord({ preserveScroll: true });
  }

  function setRestrictionVendorFilter(nextFilter) {
    withFeatureVisibilityChange(() => {
      state.restrictionVendorFilter = normalizeRestrictionVendorFilter(nextFilter);
    });
  }

  function setShowPrimers(nextShowPrimers) {
    withFeatureVisibilityChange(() => {
      state.showPrimers = Boolean(nextShowPrimers);
    });
    syncPrimersToggleState();
  }

  function setOrfStopCodons(nextStopCodons) {
    const record = getSelectedRecord();
    const previousFeatures = getVisibleFeaturesForRecord(record);
    const selectedFeature = (
      Number.isFinite(state.selectedFeatureIndex)
      && state.selectedFeatureIndex >= 0
      && state.selectedFeatureIndex < previousFeatures.length
    ) ? previousFeatures[state.selectedFeatureIndex] : null;

    state.orfStopCodons = normalizeOrfStopCodonSelection(nextStopCodons);

    if (selectedFeature) {
      const nextFeatures = getVisibleFeaturesForRecord(record);
      const exactIndex = findFeatureIndexByIdentity(nextFeatures, selectedFeature);
      state.selectedFeatureIndex = exactIndex >= 0
        ? exactIndex
        : findUpdatedOrfIndex(nextFeatures, selectedFeature);
    } else {
      state.selectedFeatureIndex = -1;
    }

    renderActiveRecord({ preserveScroll: true });
  }

  function setOrfFrameFilter(nextFilter) {
    const record = getSelectedRecord();
    const previousFeatures = getVisibleFeaturesForRecord(record);
    const selectedFeature = (
      Number.isFinite(state.selectedFeatureIndex)
      && state.selectedFeatureIndex >= 0
      && state.selectedFeatureIndex < previousFeatures.length
    ) ? previousFeatures[state.selectedFeatureIndex] : null;

    state.orfFrameFilter = normalizeOrfFrameFilter(nextFilter);

    if (selectedFeature) {
      const nextFeatures = getVisibleFeaturesForRecord(record);
      state.selectedFeatureIndex = findFeatureIndexByIdentity(nextFeatures, selectedFeature);
    } else {
      state.selectedFeatureIndex = -1;
    }

    renderActiveRecord({ preserveScroll: true });
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
    persistFeatureMutation,
    onRequestPrimerOrder
  });

  sequenceEditingController = createSequenceViewerSequenceEditingController({
    rootDocument,
    elements,
    state,
    getSelectedRecord,
    getSelectedFeature: (record) => getFeatureByIndexForRecord(record, state.selectedFeatureIndex),
    getVisibleFeatures: getVisibleFeaturesForRecord,
    getSequenceSelectionRange,
    clearSequenceSelection,
    hideFeatureContextMenu,
    hideFeatureEditor,
    renderSequence,
    renderSelectedFeatureDetail,
    setStatus,
    onApplySequenceEdit
  });

  aminoAcidEditingController = createSequenceViewerAminoAcidEditingController({
    elements,
    getSelectedRecord,
    setStatus,
    onApplyAminoAcidEdit: async (payload) => {
      const record = getSelectedRecord();
      const selectedFeature = getFeatureByIndexForRecord(record, state.selectedFeatureIndex);
      const result = await onApplyAminoAcidEdit(payload);
      if (isOrfFeature(selectedFeature)) {
        const nextFeatures = getVisibleFeaturesForRecord(getSelectedRecord());
        state.selectedFeatureIndex = findUpdatedOrfIndex(nextFeatures, selectedFeature);
        renderActiveRecord({ preserveScroll: true });
      }
      return result;
    }
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
      hidePrimerDesignOverlay,
      hideSequenceEditDialog,
      hideSequenceHoverTooltip,
      showSequenceHoverTooltip,
      renderActiveRecord,
      renderSequence,
      updateSequenceCursor,
      renderSelectedFeatureDetail,
      setOrfViewEnabled,
      readOrfStopCodonsFromControls,
      setOrfStopCodons,
      readOrfFrameFilterFromControls,
      setOrfFrameFilter,
      setRestrictionVendorFilter,
      setShowPrimers,
      resolveSequenceBoundaryFromEvent,
      resolveFeatureActionContext,
      renderFeatureContextMenu,
      resolveAminoAcidActionContext,
      renderAminoAcidContextMenu,
      applyAminoAcidReplacement,
      openFeatureEditor,
      openPrimerDesignOverlay,
      orderDesignedPrimers: () => featureEditingController?.orderDesignedPrimers?.(),
      deleteFeatureFromContext,
      applyFeatureEditorChanges,
      getActiveFeatureActionContext: () => activeFeatureActionContext,
      openSequenceEditFromKeyboardEvent,
      applySequenceEditDialog,
      hasOpenSequenceEditDialog: () => sequenceEditingController?.hasOpenSequenceEditDialog?.() || false,
      onRequestSave,
      onRequestAnnotate,
      onRequestRecognizeBackbone,
      onRequestAlignment,
      onRequestCloningDesign,
      onSelectAlignmentSession,
      onConfirmProteinBuilderConstruct,
      onReturnToProteinBuilder,
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
    hidePrimerDesignOverlay,
    hideSequenceEditDialog,
    openPrimerDesignOverlay,
    renderActiveRecord,
    renderSelectedFeatureDetail,
    renderSequence,
    setOrfViewEnabled,
    setRestrictionVendorFilter,
    setShowPrimers,
    syncActionButtonsState,
    syncAlignmentControlsState,
    syncOrfToggleState,
    syncRestrictionVendorToggleState,
    syncPrimersToggleState,
    updateRecordSelect
  };
}
