// Feature context menu, the feature editor, the primer-design overlay, the
// sequence-edit dialog, and the document-level dismiss/keyboard handlers.
import { cleanText } from '../shared.js';
import { copyPrimerValueFromEvent } from '../primer-copy.js';

function bindDetailDialogEvents(context = {}, { closeToolbarMenus = () => {} } = {}) {
  const {
    elements,
    state,
    getSelectedRecord,
    hideFeatureContextMenu,
    hideFeatureEditor,
    hidePrimerDesignOverlay,
    hideSequenceEditDialog,
    renderSequence,
    renderSelectedFeatureDetail,
    setStatus,
    applyAminoAcidReplacement,
    openFeatureEditor,
    openPrimerDesignOverlay,
    orderDesignedPrimers,
    deleteFeatureFromContext,
    applyFeatureEditorChanges,
    getActiveFeatureActionContext,
    openSequenceEditFromKeyboardEvent,
    applySequenceEditDialog,
    hasOpenSequenceEditDialog
  } = context;


  elements.featureContextMenu?.addEventListener('click', (event) => {
    const targetAminoAcid = cleanText(
      event?.target?.closest?.('[data-sequence-aa-replacement]')?.dataset?.sequenceAaReplacement,
      4
    ).toUpperCase();
    if (targetAminoAcid) {
      void applyAminoAcidReplacement(targetAminoAcid);
      return;
    }
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

  elements.primerDesignOrderBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    orderDesignedPrimers();
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

    // Other workspaces (Vector Builder, Protein Builder) own their keys while
    // they are showing; opening this dialog inside the hidden detail workspace
    // would leave an invisible dialog swallowing every later keystroke.
    const mode = state.localWorkspaceMode;
    if (hasOpenSequenceEditDialog() || (mode && mode !== 'detail' && mode !== 'alignment')) {
      return;
    }

    if (openSequenceEditFromKeyboardEvent(event)) {
      hideFeatureContextMenu();
    }
  });

}

export { bindDetailDialogEvents };
