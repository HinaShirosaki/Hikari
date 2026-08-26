import { escapeHtml } from '../../lib/html.js';
import {
  FALLBACK_CHAR_ADVANCE_PX,
} from './constants.js';
import {
  getRenderableFeaturesForRecord,
} from './feature-model.js';
import { isOrfFeature } from './orf-analysis.js';
import * as detailAlignment from './detail-alignment.js';
import { bindSequenceViewerDetailEvents } from './detail-events.js';
import { createSequenceViewerAminoAcidEditingController } from './detail-amino-acid-editing.js';
import { createSequenceViewerFeatureEditingController } from './detail-feature-editing.js';
import { createSequenceHoverTooltipController } from './detail-hover.js';
import { resolveSequenceBoundaryFromEvent as resolveSequenceBoundaryFromEventShared } from './detail-layout.js';
import { createSequenceViewerDetailRenderingController } from './detail-rendering.js';
import { LIBRARY_STATUS_SAVED } from './runtime/config.js';
import { createSequenceViewerSequenceEditingController } from './detail-sequence-editing.js';
import { normalizeRestrictionVendorFilter } from './restriction-analysis.js';
import {
  cleanText,
  clamp,
} from './shared.js';
import { normalizeOrfStopCodonSelection } from './translation-style.js';

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

  function syncActionButtonsState() {
    const hasRecord = Boolean(getSelectedRecord()?.sequence?.length);
    if (elements.saveBtn) {
      // Only unsaved (temporary or not-yet-persisted) records need saving.
      const canSave = hasRecord && hasStoragePath() && state.activeEntryStatus !== LIBRARY_STATUS_SAVED;
      elements.saveBtn.hidden = !canSave;
      elements.saveBtn.disabled = !canSave;
    }
    if (elements.annotateBtn) {
      elements.annotateBtn.disabled = !hasRecord || !hasStoragePath() || Boolean(state.isAnnotating);
    }
    if (elements.recognizeBackboneBtn) {
      elements.recognizeBackboneBtn.disabled = !hasRecord || !hasStoragePath() || Boolean(state.isRecognizingBackbone);
    }
    if (elements.alignmentOpenBtn) {
      elements.alignmentOpenBtn.disabled = !hasRecord;
    }
    if (elements.alignmentMenuBtn) {
      elements.alignmentMenuBtn.disabled = !hasRecord;
    }
    if (elements.orfMenuBtn) {
      elements.orfMenuBtn.disabled = !hasRecord;
    }
    if (elements.cutterMenuBtn) {
      elements.cutterMenuBtn.disabled = !hasRecord;
    }
    if (elements.cloningDesignBtn) {
      const canOpenCloningDesign = hasRecord && Boolean(hasCloningDesignSource());
      elements.cloningDesignBtn.hidden = !canOpenCloningDesign;
      elements.cloningDesignBtn.disabled = !canOpenCloningDesign;
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
    const stopCodons = normalizeOrfStopCodonSelection(state.orfStopCodons);
    if (elements.orfToggle) {
      elements.orfToggle.checked = Boolean(state.orfViewEnabled);
      elements.orfToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTagToggle) {
      elements.orfStopTagToggle.checked = Boolean(stopCodons.TAG);
      elements.orfStopTagToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTaaToggle) {
      elements.orfStopTaaToggle.checked = Boolean(stopCodons.TAA);
      elements.orfStopTaaToggle.disabled = !hasRecord;
    }
    if (elements.orfStopTgaToggle) {
      elements.orfStopTgaToggle.checked = Boolean(stopCodons.TGA);
      elements.orfStopTgaToggle.disabled = !hasRecord;
    }
    const frameFilter = normalizeOrfFrameFilter(state.orfFrameFilter);
    for (const [frame, key] of ORF_FRAME_TOGGLES) {
      const toggle = elements[key];
      if (toggle) {
        toggle.checked = frameFilter[frame];
        toggle.disabled = !hasRecord;
      }
    }
  }

  function readOrfStopCodonsFromControls() {
    return normalizeOrfStopCodonSelection({
      TAG: Boolean(elements.orfStopTagToggle?.checked),
      TAA: Boolean(elements.orfStopTaaToggle?.checked),
      TGA: Boolean(elements.orfStopTgaToggle?.checked)
    });
  }

  function readOrfFrameFilterFromControls() {
    const result = {};
    for (const [frame, key] of ORF_FRAME_TOGGLES) {
      result[frame] = Boolean(elements[key]?.checked);
    }
    return result;
  }

  function getAlignmentHighlightSegments(record) {
    return detailAlignment.getAlignmentHighlightSegments(state, record);
  }

  // One shared flag, two toolbars: keep both boxes showing the same thing.
  function syncPrimersToggleState() {
    const checked = state.showPrimers !== false;
    if (elements.primersToggle) {
      elements.primersToggle.checked = checked;
    }
    if (elements.vectorBuilderPrimersToggle) {
      elements.vectorBuilderPrimersToggle.checked = checked;
    }
  }

  function syncRestrictionVendorToggleState() {
    if (elements.restrictionNebToggle) {
      elements.restrictionNebToggle.checked = Boolean(state.restrictionVendorFilter?.neb);
    }
    if (elements.restrictionThermoToggle) {
      elements.restrictionThermoToggle.checked = Boolean(state.restrictionVendorFilter?.thermo);
    }
  }

  function renderProteinBuilderConfirmation(record) {
    const confirmation = state.proteinBuilderConfirmation && typeof state.proteinBuilderConfirmation === 'object'
      ? state.proteinBuilderConfirmation
      : null;
    const isVisible = Boolean(confirmation && record?.sequence?.length);

    if (elements.proteinBuilderConfirmation) {
      elements.proteinBuilderConfirmation.hidden = !isVisible;
    }
    if (!elements.proteinBuilderConfirmationSummary) {
      return;
    }
    if (!isVisible) {
      elements.proteinBuilderConfirmationSummary.innerHTML = '<p class="small-note">Protein Builder review details will appear here.</p>';
      return;
    }

    const summaryParts = [
      cleanText(confirmation?.recordName, 160)
        ? `<p><strong>Reviewing:</strong> ${escapeHtml(cleanText(confirmation.recordName, 160))}</p>`
        : '',
      cleanText(confirmation?.constructName, 160)
        ? `<p><strong>Insert:</strong> ${escapeHtml(cleanText(confirmation.constructName, 160))}</p>`
        : '',
      cleanText(confirmation?.backboneName, 160)
        ? `<p><strong>Backbone:</strong> ${escapeHtml(cleanText(confirmation.backboneName, 160))}</p>`
        : '',
      Number.isFinite(Number(confirmation?.plasmidLength))
        ? `<p><strong>Total Length:</strong> ${Math.max(0, Number(confirmation.plasmidLength)).toLocaleString()} bp</p>`
        : '',
      Number.isFinite(Number(confirmation?.insertLength))
        ? `<p><strong>Insert DNA:</strong> ${Math.max(0, Number(confirmation.insertLength)).toLocaleString()} bp</p>`
        : '',
      cleanText(confirmation?.sourceLabel, 160)
        ? `<p><strong>Backbone Source:</strong> ${escapeHtml(cleanText(confirmation.sourceLabel, 160))}</p>`
        : '',
      cleanText(confirmation?.assemblyStrategy, 120)
        ? `<p><strong>Assembly Route:</strong> ${escapeHtml(cleanText(confirmation.assemblyStrategy, 120).replace(/[-_]+/g, ' '))}</p>`
        : '',
      Number.isFinite(Number(confirmation?.primerCount)) && Number(confirmation.primerCount) > 0
        ? `<p><strong>Primer Plan:</strong> ${Math.max(0, Number(confirmation.primerCount)).toLocaleString()} primer${Number(confirmation.primerCount) === 1 ? '' : 's'} designed.</p>`
        : '',
      cleanText(confirmation?.notebookTitle, 220)
        ? `<p><strong>Notebook Page:</strong> ${escapeHtml(cleanText(confirmation.notebookTitle, 220))}</p>`
        : '',
      '<p class="small-note">Review the sequence and annotations before confirming this Protein Builder construct.</p>'
    ].filter(Boolean);
    elements.proteinBuilderConfirmationSummary.innerHTML = summaryParts.join('');
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
