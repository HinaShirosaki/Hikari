import { cleanText, clamp, normalizeRecordName } from './shared.js';

export function bindSequenceViewerDetailEvents(config = {}) {
  const elements = config?.elements || {};
  const state = config?.state || {};
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const getVisibleFeaturesForRecord = config?.getVisibleFeaturesForRecord || (() => []);
  const clearSequenceSelection = config?.clearSequenceSelection || (() => {});
  const hideFeatureContextMenu = config?.hideFeatureContextMenu || (() => {});
  const hideFeatureEditor = config?.hideFeatureEditor || (() => {});
  const hideSequenceHoverTooltip = config?.hideSequenceHoverTooltip || (() => {});
  const showSequenceHoverTooltip = config?.showSequenceHoverTooltip || (() => {});
  const renderActiveRecord = config?.renderActiveRecord || (() => {});
  const renderSequence = config?.renderSequence || (() => {});
  const renderSelectedFeatureDetail = config?.renderSelectedFeatureDetail || (() => {});
  const setOrfViewEnabled = config?.setOrfViewEnabled || (() => {});
  const readOrfStopVisibilityFromControls = config?.readOrfStopVisibilityFromControls || (() => ({}));
  const setRestrictionVendorFilter = config?.setRestrictionVendorFilter || (() => {});
  const resolveSequenceBoundaryFromEvent = config?.resolveSequenceBoundaryFromEvent || (() => null);
  const resolveFeatureActionContext = config?.resolveFeatureActionContext || (() => null);
  const renderFeatureContextMenu = config?.renderFeatureContextMenu || (() => {});
  const openFeatureEditor = config?.openFeatureEditor || (() => {});
  const deleteFeatureFromContext = config?.deleteFeatureFromContext || (async () => {});
  const applyFeatureEditorChanges = config?.applyFeatureEditorChanges || (async () => {});
  const getActiveFeatureActionContext = config?.getActiveFeatureActionContext || (() => null);
  const onRequestAnnotate = config?.onRequestAnnotate || (() => {});
  const onRequestRecognizeBackbone = config?.onRequestRecognizeBackbone || (() => {});
  const onRequestClear = config?.onRequestClear || (() => {});
  const onRequestSave = config?.onRequestSave || (() => {});
  const onRequestAlignment = config?.onRequestAlignment || (() => {});
  const onSelectAlignmentSession = config?.onSelectAlignmentSession || (() => {});
  const onConfirmProteinBuilderConstruct = config?.onConfirmProteinBuilderConstruct || (() => {});
  const onReturnToProteinBuilder = config?.onReturnToProteinBuilder || (() => {});
  const onNavigateHome = config?.onNavigateHome || (() => {});
  const onRefreshLibraryEntries = config?.onRefreshLibraryEntries || (() => {});
  const onReferenceRecordChanged = config?.onReferenceRecordChanged || (() => {});

  elements.annotateBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void onRequestAnnotate();
  });

  elements.recognizeBackboneBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void onRequestRecognizeBackbone();
  });

  elements.orfToggle?.addEventListener('change', () => {
    setOrfViewEnabled(Boolean(elements.orfToggle.checked));
  });

  const handleOrfStopToggleChange = () => {
    state.orfStopVisibility = readOrfStopVisibilityFromControls();
    renderActiveRecord();
  };

  elements.orfStopTagToggle?.addEventListener('change', handleOrfStopToggleChange);
  elements.orfStopTaaToggle?.addEventListener('change', handleOrfStopToggleChange);
  elements.orfStopTgaToggle?.addEventListener('change', handleOrfStopToggleChange);

  elements.restrictionNebToggle?.addEventListener('change', () => {
    setRestrictionVendorFilter({
      ...state.restrictionVendorFilter,
      neb: Boolean(elements.restrictionNebToggle.checked)
    });
  });

  elements.restrictionThermoToggle?.addEventListener('change', () => {
    setRestrictionVendorFilter({
      ...state.restrictionVendorFilter,
      thermo: Boolean(elements.restrictionThermoToggle.checked)
    });
  });

  elements.clearBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    onRequestClear();
  });

  elements.saveBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void onRequestSave();
  });

  elements.alignmentOpenBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void onRequestAlignment();
  });

  elements.alignmentSessionSelect?.addEventListener('change', () => {
    const sessionId = cleanText(elements.alignmentSessionSelect.value, 200);
    if (!sessionId) {
      state.alignmentViewEnabled = false;
      renderActiveRecord();
      return;
    }
    void onSelectAlignmentSession(sessionId);
  });

  elements.alignmentToggle?.addEventListener('change', () => {
    if (elements.alignmentToggle.checked && !state.activeAlignmentResult) {
      const sessionId = cleanText(elements.alignmentSessionSelect?.value, 200);
      if (sessionId) {
        void onSelectAlignmentSession(sessionId);
        return;
      }
    }
    state.alignmentViewEnabled = Boolean(elements.alignmentToggle.checked);
    renderActiveRecord();
  });

  elements.proteinBuilderConfirmationConfirmBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    onConfirmProteinBuilderConstruct();
  });

  elements.proteinBuilderConfirmationBackBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    onReturnToProteinBuilder();
  });

  elements.backBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    onNavigateHome();
    void onRefreshLibraryEntries({ silent: true });
  });

  elements.recordSelect?.addEventListener('change', () => {
    state.selectedRecordIndex = clamp(Number(elements.recordSelect.value) || 0, 0, Math.max(0, state.records.length - 1));
    state.selectedFeatureIndex = -1;
    clearSequenceSelection();
    hideFeatureContextMenu();
    hideFeatureEditor();
    onReferenceRecordChanged();
    renderActiveRecord();
    const selected = getSelectedRecord();
    if (selected && elements.saveNameInput) {
      elements.saveNameInput.value = normalizeRecordName(selected.name || 'sequence', 'sequence');
    }
  });

  elements.featureRailHost?.addEventListener('click', (event) => {
    const trigger = event.target?.closest?.('[data-feature-index]') || null;
    if (!trigger) {
      return;
    }
    const index = Number(trigger.dataset.featureIndex);
    if (!Number.isFinite(index)) {
      return;
    }
    state.selectedFeatureIndex = index;
    clearSequenceSelection();
    hideFeatureContextMenu();
    renderActiveRecord();
  });

  elements.sequenceHost?.addEventListener('mousedown', (event) => {
    const button = Number(event?.button);
    if (Number.isFinite(button) && button !== 0) {
      return;
    }
    const featureTrigger = event.target?.closest?.('[data-feature-index]') || null;
    if (featureTrigger) {
      return;
    }
    const record = getSelectedRecord();
    const boundary = resolveSequenceBoundaryFromEvent(event, record);
    if (!Number.isFinite(boundary)) {
      return;
    }
    event.preventDefault?.();
    hideFeatureContextMenu();
    state.isSelectingSequence = true;
    state.sequenceSelectionAnchor = boundary;
    state.sequenceSelectionFocus = boundary;
    state.sequenceCursorBase = boundary;
    renderSequence(record, { preserveScroll: true });
    renderSelectedFeatureDetail(record);
  });

  elements.sequenceHost?.addEventListener('mousemove', (event) => {
    const record = getSelectedRecord();
    let rerenderNeeded = false;

    if (state.isSelectingSequence) {
      const boundary = resolveSequenceBoundaryFromEvent(event, record);
      if (Number.isFinite(boundary)) {
        if (state.sequenceSelectionFocus !== boundary) {
          state.sequenceSelectionFocus = boundary;
          rerenderNeeded = true;
        }
        if (state.sequenceCursorBase !== boundary) {
          state.sequenceCursorBase = boundary;
          rerenderNeeded = true;
        }
      }
      hideSequenceHoverTooltip();
      if (rerenderNeeded) {
        renderSequence(record, { preserveScroll: true });
        renderSelectedFeatureDetail(record);
      }
      return;
    }

    hideSequenceHoverTooltip();
    const boundary = resolveSequenceBoundaryFromEvent(event, record);
    if (Number.isFinite(boundary)) {
      if (state.sequenceCursorBase !== boundary) {
        state.sequenceCursorBase = boundary;
        rerenderNeeded = true;
      }
    } else if (Number.isFinite(state.sequenceCursorBase)) {
      state.sequenceCursorBase = null;
      rerenderNeeded = true;
    }

    if (rerenderNeeded) {
      renderSequence(record, { preserveScroll: true });
    }
  });

  elements.sequenceHost?.addEventListener('mouseover', (event) => {
    const record = getSelectedRecord();
    const trigger = event.target?.closest?.('[data-feature-index]');
    if (!trigger || !record?.sequence?.length) {
      hideSequenceHoverTooltip();
      return;
    }
    const index = Number(trigger.dataset.featureIndex);
    if (!Number.isFinite(index) || index < 0) {
      hideSequenceHoverTooltip();
      return;
    }
    const feature = getVisibleFeaturesForRecord(record)[index] || null;
    if (!feature) {
      hideSequenceHoverTooltip();
      return;
    }
    showSequenceHoverTooltip(event, feature, record.sequence.length);
  });

  elements.sequenceHost?.addEventListener('mouseout', (event) => {
    if (!event?.relatedTarget?.closest?.('[data-feature-index]')) {
      hideSequenceHoverTooltip();
    }
  });

  elements.sequenceHost?.addEventListener('mouseleave', () => {
    hideSequenceHoverTooltip();
    if (state.isSelectingSequence) {
      return;
    }
    if (Number.isFinite(state.sequenceCursorBase)) {
      state.sequenceCursorBase = null;
      renderSequence(getSelectedRecord(), { preserveScroll: true });
    }
  });

  elements.sequenceHost?.addEventListener('scroll', () => {
    hideSequenceHoverTooltip();
    hideFeatureContextMenu();
  });

  elements.sequenceHost?.addEventListener('click', (event) => {
    hideFeatureContextMenu();
    const trigger = event.target?.closest?.('[data-feature-index]') || null;
    if (!trigger) {
      return;
    }
    const index = Number(trigger.dataset.featureIndex);
    if (!Number.isFinite(index)) {
      return;
    }
    state.selectedFeatureIndex = index;
    clearSequenceSelection({ preserveCursor: true });
    renderActiveRecord();
  });

  elements.sequenceHost?.addEventListener('mouseup', () => {
    if (!state.isSelectingSequence) {
      return;
    }
    state.isSelectingSequence = false;
    renderSequence(getSelectedRecord(), { preserveScroll: true });
    renderSelectedFeatureDetail(getSelectedRecord());
  });

  elements.sequenceHost?.addEventListener('contextmenu', (event) => {
    const record = getSelectedRecord();
    hideSequenceHoverTooltip();
    if (state.isSelectingSequence) {
      state.isSelectingSequence = false;
    }
    const context = resolveFeatureActionContext(record, event);
    if (!context?.selectionRange && !context?.featureContext) {
      hideFeatureContextMenu();
      return;
    }
    event.preventDefault?.();
    renderSelectedFeatureDetail(record);
    renderFeatureContextMenu(context, event);
  });

  elements.featureContextMenu?.addEventListener('click', (event) => {
    const action = cleanText(
      event?.target?.closest?.('[data-sequence-feature-action]')?.dataset?.sequenceFeatureAction,
      40
    );
    if (!action) {
      return;
    }

    const context = getActiveFeatureActionContext();
    if (action === 'add') {
      openFeatureEditor('add', context);
      return;
    }
    if (action === 'edit') {
      openFeatureEditor('edit', context);
      return;
    }
    if (action === 'delete') {
      void deleteFeatureFromContext(context);
    }
  });

  elements.featureEditorForm?.addEventListener('submit', (event) => {
    event.preventDefault?.();
    void applyFeatureEditorChanges();
  });

  elements.featureEditorCloseBtn?.addEventListener('click', () => {
    hideFeatureEditor();
  });

  elements.featureEditorCancelBtn?.addEventListener('click', () => {
    hideFeatureEditor();
  });

  elements.featureEditorOverlay?.addEventListener('click', (event) => {
    if (event?.target === elements.featureEditorOverlay) {
      hideFeatureEditor();
    }
  });

  globalThis.addEventListener?.('mouseup', () => {
    if (!state.isSelectingSequence) {
      return;
    }
    state.isSelectingSequence = false;
    renderSequence(getSelectedRecord(), { preserveScroll: true });
    renderSelectedFeatureDetail(getSelectedRecord());
  });

  globalThis.addEventListener?.('click', (event) => {
    if (!event?.target?.closest?.('#sequence-viewer-feature-context-menu')) {
      hideFeatureContextMenu();
    }
  });

  globalThis.addEventListener?.('keydown', (event) => {
    if (String(event?.key || '') === 'Escape') {
      hideFeatureContextMenu();
      hideFeatureEditor();
    }
  });

  globalThis.addEventListener?.('resize', () => {
    renderSequence(getSelectedRecord(), { preserveScroll: true });
  });
}
