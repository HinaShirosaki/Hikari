import { bindDetailToolbarEvents } from './detail-events/toolbar-bindings.js';
import { bindSequenceHostEvents } from './detail-events/sequence-host-bindings.js';
import { bindDetailDialogEvents } from './detail-events/dialog-bindings.js';


export function bindSequenceViewerDetailEvents(config = {}) {
  const elements = config?.elements || {};
  const state = config?.state || {};
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const getVisibleFeaturesForRecord = config?.getVisibleFeaturesForRecord || (() => []);
  const clearSequenceSelection = config?.clearSequenceSelection || (() => {});
  const hideFeatureContextMenu = config?.hideFeatureContextMenu || (() => {});
  const hideFeatureEditor = config?.hideFeatureEditor || (() => {});
  const hidePrimerDesignOverlay = config?.hidePrimerDesignOverlay || (() => {});
  const hideSequenceEditDialog = config?.hideSequenceEditDialog || (() => {});
  const hideSequenceHoverTooltip = config?.hideSequenceHoverTooltip || (() => {});
  const showSequenceHoverTooltip = config?.showSequenceHoverTooltip || (() => {});
  const renderActiveRecord = config?.renderActiveRecord || (() => {});
  const renderSequence = config?.renderSequence || (() => {});
  const updateSequenceCursor = config?.updateSequenceCursor || (() => {});
  const renderSelectedFeatureDetail = config?.renderSelectedFeatureDetail || (() => {});
  const setOrfViewEnabled = config?.setOrfViewEnabled || (() => {});
  const readOrfStopCodonsFromControls = config?.readOrfStopCodonsFromControls || (() => ({}));
  const setOrfStopCodons = config?.setOrfStopCodons || (() => {});
  const readOrfFrameFilterFromControls = config?.readOrfFrameFilterFromControls || (() => ({}));
  const setOrfFrameFilter = config?.setOrfFrameFilter || (() => {});
  const setRestrictionVendorFilter = config?.setRestrictionVendorFilter || (() => {});
  const setShowPrimers = config?.setShowPrimers || (() => {});
  const setStatus = config?.setStatus || (() => {});
  const resolveSequenceBoundaryFromEvent = config?.resolveSequenceBoundaryFromEvent || (() => null);
  const resolveFeatureActionContext = config?.resolveFeatureActionContext || (() => null);
  const renderFeatureContextMenu = config?.renderFeatureContextMenu || (() => {});
  const resolveAminoAcidActionContext = config?.resolveAminoAcidActionContext || (() => null);
  const renderAminoAcidContextMenu = config?.renderAminoAcidContextMenu || (() => {});
  const applyAminoAcidReplacement = config?.applyAminoAcidReplacement || (async () => {});
  const openFeatureEditor = config?.openFeatureEditor || (() => {});
  const openPrimerDesignOverlay = config?.openPrimerDesignOverlay || (() => {});
  const orderDesignedPrimers = config?.orderDesignedPrimers || (() => {});
  const deleteFeatureFromContext = config?.deleteFeatureFromContext || (async () => {});
  const applyFeatureEditorChanges = config?.applyFeatureEditorChanges || (async () => {});
  const getActiveFeatureActionContext = config?.getActiveFeatureActionContext || (() => null);
  const openSequenceEditFromKeyboardEvent = config?.openSequenceEditFromKeyboardEvent || (() => false);
  const applySequenceEditDialog = config?.applySequenceEditDialog || (async () => {});
  const hasOpenSequenceEditDialog = config?.hasOpenSequenceEditDialog || (() => false);
  const onRequestSave = config?.onRequestSave || (() => {});
  const onRequestAnnotate = config?.onRequestAnnotate || (() => {});
  const onRequestRecognizeBackbone = config?.onRequestRecognizeBackbone || (() => {});
  const onRequestAlignment = config?.onRequestAlignment || (() => {});
  const onRequestCloningDesign = config?.onRequestCloningDesign || (() => {});
  const onSelectAlignmentSession = config?.onSelectAlignmentSession || (() => {});
  const onConfirmProteinBuilderConstruct = config?.onConfirmProteinBuilderConstruct || (() => {});
  const onReturnToProteinBuilder = config?.onReturnToProteinBuilder || (() => {});
  const onReferenceRecordChanged = config?.onReferenceRecordChanged || (() => {});


  const bindingContext = {
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
    setStatus,
    resolveSequenceBoundaryFromEvent,
    resolveFeatureActionContext,
    renderFeatureContextMenu,
    resolveAminoAcidActionContext,
    renderAminoAcidContextMenu,
    applyAminoAcidReplacement,
    openFeatureEditor,
    openPrimerDesignOverlay,
    orderDesignedPrimers,
    deleteFeatureFromContext,
    applyFeatureEditorChanges,
    getActiveFeatureActionContext,
    openSequenceEditFromKeyboardEvent,
    applySequenceEditDialog,
    hasOpenSequenceEditDialog,
    onRequestSave,
    onRequestAnnotate,
    onRequestRecognizeBackbone,
    onRequestAlignment,
    onRequestCloningDesign,
    onSelectAlignmentSession,
    onConfirmProteinBuilderConstruct,
    onReturnToProteinBuilder,
    onReferenceRecordChanged
  };

  const { closeToolbarMenus } = bindDetailToolbarEvents(bindingContext);
  bindSequenceHostEvents(bindingContext);
  bindDetailDialogEvents(bindingContext, { closeToolbarMenus });

  // The host resizes whenever the window or a rail does, so watching it covers
  // both; a separate window resize listener would only re-flow a second time.
  if (elements.sequenceHost
    && typeof globalThis.ResizeObserver === 'function'
    && typeof globalThis.requestAnimationFrame === 'function') {
    let lastWidth = elements.sequenceHost.clientWidth || 0;
    let reflowPending = false;
    const reflowSequence = () => {
      reflowPending = false;
      const width = elements.sequenceHost.clientWidth || 0;
      // A hidden host measures 0 and would re-flow at the fallback line length.
      if (!width || width === lastWidth) {
        return;
      }
      renderSequence(getSelectedRecord(), { preserveScroll: true });
      // Store the post-render width so a scrollbar appearing/disappearing during
      // the re-flow settles instead of bouncing the observer.
      lastWidth = elements.sequenceHost.clientWidth || width;
    };
    const observer = new globalThis.ResizeObserver(() => {
      // A rail drag fires this every frame, and re-rendering inside the callback
      // is what trips Chromium's undelivered-notifications warning.
      if (reflowPending) {
        return;
      }
      reflowPending = true;
      globalThis.requestAnimationFrame(reflowSequence);
    });
    observer.observe(elements.sequenceHost);
  }
}
