import { eventTargetsElement } from './shared.js';

// Pointer work inside the sequence workspace: selection drags, hover tooltips,
// feature rail clicks, and the context menu.
function bindSequenceHostEvents(context = {}) {
  const {
    elements,
    state,
    getSelectedRecord,
    getVisibleFeaturesForRecord,
    clearSequenceSelection,
    hideFeatureContextMenu,
    hideSequenceHoverTooltip,
    showSequenceHoverTooltip,
    renderActiveRecord,
    renderSequence,
    updateSequenceCursor,
    renderSelectedFeatureDetail,
    resolveSequenceBoundaryFromEvent,
    resolveFeatureActionContext,
    renderFeatureContextMenu,
    resolveAminoAcidActionContext,
    renderAminoAcidContextMenu
  } = context;


  // A feature highlight is a transient inspection state. Keep it while the
  // user acts on that feature, but clear it when they click elsewhere in the
  // detail workspace (including empty sequence or rail space).
  elements.detailWorkspace?.addEventListener('mousedown', (event) => {
    const button = Number(event?.button);
    if ((Number.isFinite(button) && button !== 0)
      || !Number.isFinite(state.selectedFeatureIndex)
      || state.selectedFeatureIndex < 0
      || event.target?.closest?.('[data-feature-index]')) {
      return;
    }
    const featureInteractionSurfaces = [
      elements.featureContextMenu,
      elements.featureEditorOverlay,
      elements.primerDesignOverlay,
      elements.primerOrderOverlay,
      elements.sequenceEditOverlay
    ];
    if (featureInteractionSurfaces.some((element) => eventTargetsElement(event, element))) {
      return;
    }
    state.selectedFeatureIndex = -1;
    hideFeatureContextMenu();
    renderActiveRecord({ preserveScroll: true });
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
    const aminoAcidTrigger = event.target?.closest?.('[data-aa-codon-positions]') || null;
    if (featureTrigger || aminoAcidTrigger) {
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
    const aminoAcidContext = resolveAminoAcidActionContext(record, event);
    if (aminoAcidContext) {
      event.preventDefault?.();
      renderAminoAcidContextMenu(aminoAcidContext, event);
      return;
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
}

export { bindSequenceHostEvents };
