import { buildSequenceEditDesignSource } from './sequence-edit-helpers.js';
export function installSequenceMcpActions(ctx) {
  const { rootDocument, actions, controllers, state } = ctx;
  async function openAction(action = {}) {
    const bridge = actions.getBridge();
    if (!bridge?.sequenceLibraryAgentArtifact) throw new Error('Sequence artifact API is unavailable.');
    const response = await bridge.sequenceLibraryAgentArtifact({ storagePath: actions.getStoragePath(), entryId: action.entry_id, constructId: action.construct_id });
    if (!response?.ok) throw new Error(response?.error || 'Unable to load sequence result.');
    if (action.entry_id) {
      await controllers.home.openLibraryEntryInDetail(action.entry_id);
      if (state.activeEntryId !== action.entry_id) throw new Error('The target plasmid could not be opened.');
    }
    const design = response.design;
    if (action.action === 'open_protein_builder') {
      const construct = response.construct || design?.construct;
      if (!construct?.payload) throw new Error('Stored Protein Builder chain is unavailable.');
      controllers.proteinBuilder.loadMcpConstruct(construct.payload);
      actions.showProteinBuilderWorkspace();
      controllers.proteinBuilder.render();
    }
    if (action.action === 'open_primer_design') {
      if (!design?.primer_design) throw new Error('Generate primers with sequence_mutagenesis_primers first.');
      if (!response.designCurrent) throw new Error('This plasmid changed after primer design. Generate a new design.');
      const record = actions.getSelectedRecord();
      state.sequenceEditDesignSource = buildSequenceEditDesignSource({ record, originalSequence: design.source_record.sequence, nextSequence: record.sequence, parentEntryId: design.parent_entry_id });
      controllers.cloningDesign.openStoredPlan(design.primer_design);
    }
    return true;
  }
  rootDocument?.addEventListener?.('click', event => {
    const button = event.target?.closest?.('[data-sequence-mcp-action]');
    if (!button) return;
    event.preventDefault();
    button.disabled = true;
    void openAction({ action: button.dataset.sequenceMcpAction, entry_id: button.dataset.sequenceEntryId, construct_id: button.dataset.sequenceConstructId })
      .catch(error => { actions.setStatus(error.message, true); button.textContent = error.message; })
      .finally(() => { button.disabled = false; });
  });
  rootDocument?.addEventListener?.('sequence-library-agent-changed', () => {
    void controllers.home?.refreshLibraryEntries?.({ silent: true });
  });
  return { openAction };
}
