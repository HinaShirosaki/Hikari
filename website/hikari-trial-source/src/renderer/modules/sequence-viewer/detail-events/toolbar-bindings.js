// Toolbar buttons, ORF/restriction/primer toggles, alignment controls, and the
// record selector.
import { clamp, cleanText } from '../shared.js';

function bindDetailToolbarEvents(context = {}) {
  const {
    elements,
    state,
    clearSequenceSelection,
    hideFeatureContextMenu,
    hideFeatureEditor,
    hidePrimerDesignOverlay,
    hideSequenceEditDialog,
    renderActiveRecord,
    setOrfViewEnabled,
    readOrfStopCodonsFromControls,
    setOrfStopCodons,
    readOrfFrameFilterFromControls,
    setOrfFrameFilter,
    setRestrictionVendorFilter,
    setShowPrimers,
    onRequestSave,
    onRequestAnnotate,
    onRequestRecognizeBackbone,
    onRequestAlignment,
    onRequestCloningDesign,
    onSelectAlignmentSession,
    onConfirmProteinBuilderConstruct,
    onReturnToProteinBuilder,
    onReferenceRecordChanged
  } = context;

  elements.saveBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void onRequestSave();
  });

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

  elements.primersToggle?.addEventListener('change', () => {
    setShowPrimers(Boolean(elements.primersToggle.checked));
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

  return { closeToolbarMenus };
}

export { bindDetailToolbarEvents };
