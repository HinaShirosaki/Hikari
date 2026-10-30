import { cleanText } from '../shared.js';
import {
  buildAssembledPlasmidPayload,
  buildProteinBuilderConfirmationPayload,
  buildStoredBackboneDisplayName
} from './assembly-payload.js';

export function installProteinBuilderAssemblyActions(ctx) {
  const { state } = ctx;

  ctx.openAssemblyDialog = async function openAssemblyDialog() {
    if (!ctx.hasStoragePath()) {
      ctx.setBuilderStatus('Set Storage Folder Path in Settings before assembling a plasmid.', true);
      return;
    }

    if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
      ctx.buildCurrentDnaSequence();
      if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
        return;
      }
    }

    state.assemblyDialogOpen = true;
    state.isLoadingAssemblyBackbones = true;
    ctx.renderAssemblyDialog();

    try {
      state.storedBackbones = await ctx.loadStoredBackboneCandidates();
      state.selectedBackboneId = cleanText(state.storedBackbones[0]?.id, 400);
      ctx.renderAssemblyDialog();
      if (!state.storedBackbones.length) {
        ctx.setBuilderStatus('No stored backbones found. Use Recognize Backbone/Insert on a vector and Apply Selection first.');
      }
    } catch (error) {
      state.storedBackbones = [];
      state.selectedBackboneId = '';
      ctx.setBuilderStatus(error?.message || 'Failed to load stored backbones.', true);
    } finally {
      state.isLoadingAssemblyBackbones = false;
      ctx.renderAssemblyDialog();
      ctx.syncFeatureSearchControls();
    }
  };

  ctx.assembleWithStoredBackbone = async function assembleWithStoredBackbone() {
    const selectedBackbone = ctx.getSelectedStoredBackbone();
    if (!selectedBackbone) {
      ctx.setBuilderStatus('Choose a stored backbone before assembling the plasmid.', true);
      return;
    }
    if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
      ctx.buildCurrentDnaSequence();
      if (!state.dnaConstruct?.ok || !state.dnaConstruct?.sequence) {
        return;
      }
    }

    try {
      state.isPreparingAssembly = true;
      ctx.renderAssemblyDialog();
      ctx.syncFeatureSearchControls();
      ctx.setBuilderStatus(`Loading ${buildStoredBackboneDisplayName(selectedBackbone)}...`);
      const hydratedBackbone = await ctx.hydrateStoredBackbone(selectedBackbone);
      const constructName = ctx.resolveConstructName();
      const payload = buildAssembledPlasmidPayload(hydratedBackbone, state.dnaConstruct, { constructName });
      if (!payload?.sequence) {
        ctx.setBuilderStatus('Unable to assemble the plasmid from the selected backbone.', true);
        return;
      }

      const reviewConfirmation = buildProteinBuilderConfirmationPayload({
        assembledRecord: payload,
        constructName,
        backbone: hydratedBackbone,
        dnaConstruct: state.dnaConstruct,
        notebookEntry: null
      });
      ctx.closeAssemblyDialog();
      ctx.loadExternalRecord(payload, { proteinBuilderConfirmation: reviewConfirmation });
    } catch (error) {
      ctx.setBuilderStatus(error?.message || 'Unable to assemble the plasmid from the selected backbone.', true);
      ctx.setStatus(error?.message || 'Unable to assemble the plasmid from the selected backbone.', true);
    } finally {
      state.isPreparingAssembly = false;
      ctx.renderAssemblyDialog();
      ctx.syncFeatureSearchControls();
    }
  };
}
