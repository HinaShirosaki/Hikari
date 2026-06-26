import { cleanText, clamp } from './shared.js';
import { copyPrimerValueFromEvent } from './primer-copy.js';

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
  const setStatus = config?.setStatus || (() => {});
  const resolveSequenceBoundaryFromEvent = config?.resolveSequenceBoundaryFromEvent || (() => null);
  const resolveFeatureActionContext = config?.resolveFeatureActionContext || (() => null);
  const renderFeatureContextMenu = config?.renderFeatureContextMenu || (() => {});
  const openFeatureEditor = config?.openFeatureEditor || (() => {});
  const openPrimerDesignOverlay = config?.openPrimerDesignOverlay || (() => {});
  const deleteFeatureFromContext = config?.deleteFeatureFromContext || (async () => {});
  const applyFeatureEditorChanges = config?.applyFeatureEditorChanges || (async () => {});
  const getActiveFeatureActionContext = config?.getActiveFeatureActionContext || (() => null);
  const openSequenceEditFromKeyboardEvent = config?.openSequenceEditFromKeyboardEvent || (() => false);
  const applySequenceEditDialog = config?.applySequenceEditDialog || (async () => {});
  const hasOpenSequenceEditDialog = config?.hasOpenSequenceEditDialog || (() => false);
  const onRequestAnnotate = config?.onRequestAnnotate || (() => {});
  const onRequestRecognizeBackbone = config?.onRequestRecognizeBackbone || (() => {});
  const onRequestAlignment = config?.onRequestAlignment || (() => {});
  const onRequestCloningDesign = config?.onRequestCloningDesign || (() => {});
  const onSelectAlignmentSession = config?.onSelectAlignmentSession || (() => {});
  const onConfirmProteinBuilderConstruct = config?.onConfirmProteinBuilderConstruct || (() => {});
  const onReturnToProteinBuilder = config?.onReturnToProteinBuilder || (() => {});
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
    setOrfStopCodons(readOrfStopCodonsFromControls());
  };

  elements.orfStopTagToggle?.addEventListener('change', handleOrfStopToggleChange);
  elements.orfStopTaaToggle?.addEventListener('change', handleOrfStopToggleChange);
  elements.orfStopTgaToggle?.addEventListener('change', handleOrfStopToggleChange);

  const handleOrfFrameToggleChange = () => {
    setOrfFrameFilter(readOrfFrameFilterFromControls());
  };

  for (const key of [
    'orfFramePlus1Toggle', 'orfFramePlus2Toggle', 'orfFramePlus3Toggle',
    'orfFrameMinus1Toggle', 'orfFrameMinus2Toggle', 'orfFrameMinus3Toggle'
  ]) {
    elements[key]?.addEventListener('change', handleOrfFrameToggleChange);
  }

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

  const toolbarMenus = [
    { btn: elements.alignmentMenuBtn, menu: elements.alignmentMenu },
    { btn: elements.orfMenuBtn, menu: elements.orfMenu },
    { btn: elements.cutterMenuBtn, menu: elements.cutterMenu }
  ].filter((entry) => entry.btn && entry.menu);

  const closeToolbarMenus = (except = null) => {
    for (const { btn, menu } of toolbarMenus) {
      if (menu === except) {
        continue;
      }
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  };

  for (const { btn, menu } of toolbarMenus) {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const willOpen = menu.hidden;
      closeToolbarMenus(willOpen ? menu : null);
      menu.hidden = !willOpen;
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  }

  elements.alignmentOpenBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    closeToolbarMenus();
    void onRequestAlignment();
  });

  elements.cloningDesignBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void onRequestCloningDesign();
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

  elements.recordSelect?.addEventListener('change', () => {
    state.selectedRecordIndex = clamp(Number(elements.recordSelect.value) || 0, 0, Math.max(0, state.records.length - 1));
    state.selectedFeatureIndex = -1;
    clearSequenceSelection();
    hideFeatureContextMenu();
    hideFeatureEditor();
    hidePrimerDesignOverlay();
    hideSequenceEditDialog();
    onReferenceRecordChanged();
    renderActiveRecord();
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
    renderActiveRecord({ preserveScroll: true });
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
      updateSequenceCursor();
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
      updateSequenceCursor();
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
    renderActiveRecord({ preserveScroll: true });
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
    if (action === 'design-primer') {
      openPrimerDesignOverlay(context);
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

  elements.primerDesignCloseBtn?.addEventListener('click', () => {
    hidePrimerDesignOverlay();
  });

  elements.primerDesignDismissBtn?.addEventListener('click', () => {
    hidePrimerDesignOverlay();
  });

  elements.primerDesignOverlay?.addEventListener('click', (event) => {
    if (event?.target === elements.primerDesignOverlay) {
      hidePrimerDesignOverlay();
    }
  });

  elements.primerDesignResult?.addEventListener('click', (event) => {
    void (async () => {
      const result = await copyPrimerValueFromEvent(event);
      if (!result.handled) {
        return;
      }
      const label = result.kind === 'sequence' ? 'primer sequence' : 'primer name';
      setStatus(
        result.copied
          ? `Copied ${label}.`
          : `Clipboard access is unavailable. Copy the ${label} directly from the table.`,
        !result.copied
      );
    })();
  });

  elements.sequenceEditForm?.addEventListener('submit', (event) => {
    event.preventDefault?.();
    void applySequenceEditDialog();
  });

  elements.sequenceEditCloseBtn?.addEventListener('click', () => {
    hideSequenceEditDialog();
  });

  elements.sequenceEditCancelBtn?.addEventListener('click', () => {
    hideSequenceEditDialog();
  });

  elements.sequenceEditOverlay?.addEventListener('click', (event) => {
    if (event?.target === elements.sequenceEditOverlay) {
      hideSequenceEditDialog();
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
    if (!event?.target?.closest?.('.sequence-viewer-menu-anchor')) {
      closeToolbarMenus();
    }
  });

  globalThis.addEventListener?.('keydown', (event) => {
    if (String(event?.key || '') === 'Escape') {
      closeToolbarMenus();
      hideFeatureContextMenu();
      hideFeatureEditor();
      hidePrimerDesignOverlay();
      hideSequenceEditDialog();
      return;
    }

    if (hasOpenSequenceEditDialog()) {
      return;
    }

    if (openSequenceEditFromKeyboardEvent(event)) {
      hideFeatureContextMenu();
    }
  });

  globalThis.addEventListener?.('resize', () => {
    renderSequence(getSelectedRecord(), { preserveScroll: true });
  });
}
