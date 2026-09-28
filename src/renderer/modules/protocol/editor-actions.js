// Editor-form actions: inserting placeholder tokens, submitting a draft, and
// seeding a new draft from a method extracted out of a paper.
function createProtocolEditorActions({
  ui,
  state,
  persist,
  createId,
  localState,
  draftHelpers,
  editorHelpers,
  markDraftSaved,
  setSelectedProtocol,
  cloneSelectionInsights,
  onProtocolsChanged,
  openEditorWithDraft,
  showViewPanel,
  renderProtocolView,
  resetEditorDraft,
  getListController
} = {}) {
  function addInteractivePlaceholderToken(placeholderName = '') {
    const placeholder = String(placeholderName || ui.placeholderNameInput?.value || '').trim();
    if (!placeholder || !ui.protocolStepsInput) {
      return;
    }
    editorHelpers.insertTokenAtCursor(ui.protocolStepsInput, `[${placeholder}]`);
    if (ui.placeholderNameInput) {
      ui.placeholderNameInput.value = '';
    }
  }

  function onProtocolSubmit(event) {
    event.preventDefault();

    const editorDraft = editorHelpers.buildDraftFromEditorInputs();
    if (!editorDraft.name || !editorDraft.steps.length) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const createdAt = draftHelpers.normalizeIsoTimestamp(localState.currentProtocolDraft.createdAt, nowIso);
    const existingProtocol = state.protocols.find((item) => item.id === localState.currentProtocolDraft.id) || null;
    const protocol = {
      id: localState.currentProtocolDraft.id || createId(),
      name: editorDraft.name,
      purpose: editorDraft.purpose,
      materials: editorDraft.materials,
      steps: editorDraft.steps,
      troubleshooting: editorDraft.troubleshooting,
      createdAt,
      updatedAt: nowIso,
      selectionInsights: cloneSelectionInsights(existingProtocol?.selectionInsights)
    };

    const index = state.protocols.findIndex((item) => item.id === protocol.id);
    if (index >= 0) {
      state.protocols[index] = protocol;
    } else {
      state.protocols.push(protocol);
    }

    persist();
    setSelectedProtocol(protocol.id);
    renderProtocolView(protocol);
    getListController().renderList();
    onProtocolsChanged?.();
    resetEditorDraft();
    showViewPanel();
    markDraftSaved();
    return protocol;
  }

  function addDraftFromExtractedMethod(method, source) {
    const protocolShapeCandidate = Array.isArray(method) ? method.find((item) => item && typeof item === 'object') : method;
    const methodTitle = String(protocolShapeCandidate?.title || protocolShapeCandidate?.name || 'Extracted Method').trim();
    const sourceTitle = String(source?.title || 'Paper').trim();
    const steps = Array.isArray(protocolShapeCandidate?.steps) ? protocolShapeCandidate.steps : [];
    const citations = Array.isArray(protocolShapeCandidate?.citations) ? protocolShapeCandidate.citations.filter(Boolean) : [];
    const purpose = String(protocolShapeCandidate?.purpose || '').trim();
    const materials = draftHelpers.normalizeMaterials(protocolShapeCandidate?.materials);
    const troubleshooting = draftHelpers.normalizeTroubleshooting(protocolShapeCandidate?.troubleshooting);
    const convertedSteps = draftHelpers.normalizeMethodStepEntries(steps);

    if (citations.length) {
      convertedSteps.unshift({ text: `Source citation(s): ${citations.join('; ')}`, placeholders: [] });
    }
    if (!convertedSteps.length) {
      return false;
    }

    openEditorWithDraft({
      id: null,
      name: `${sourceTitle} - ${methodTitle}`.trim(),
      purpose,
      materials,
      steps: convertedSteps,
      troubleshooting
    }, 'Create Protocol', { isCreateMode: true, requiresSave: true });
    return true;
  }

  return {
    addInteractivePlaceholderToken,
    onProtocolSubmit,
    addDraftFromExtractedMethod
  };
}

export { createProtocolEditorActions };
