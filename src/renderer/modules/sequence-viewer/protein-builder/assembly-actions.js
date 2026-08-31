import { createProteinBuilderCloningNotebookPage } from '../protein-builder-cloning-notebook.js';
import { withPrimerBindFeatures } from '../primer-annotation.js';
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

      let cloningNotebookResult = null;
      let notebookWarning = '';
      try {
        cloningNotebookResult = createProteinBuilderCloningNotebookPage({
          state: ctx.appState,
          persist: ctx.persist,
          createId: ctx.createId,
          onNotebookEntriesChanged: ctx.onNotebookEntriesChanged,
          constructName,
          backbone: hydratedBackbone,
          dnaConstruct: state.dnaConstruct,
          assembledRecord: payload
        });
      } catch (error) {
        notebookWarning = error?.message || 'Failed to create the cloning notebook page.';
      }

      // Annotate before the review payload is built, so the construct opens with
      // its primers already on the map and carries them into the saved record.
      payload.features = withPrimerBindFeatures(
        payload,
        cloningNotebookResult?.plan?.primerOligoPlan?.primers
      ).features;

      const reviewConfirmation = buildProteinBuilderConfirmationPayload({
        assembledRecord: payload,
        constructName,
        backbone: hydratedBackbone,
        dnaConstruct: state.dnaConstruct,
        notebookEntry: cloningNotebookResult?.entry || null
      });
      const backboneDisplayName = buildStoredBackboneDisplayName(hydratedBackbone);
      ctx.closeAssemblyDialog();
      ctx.loadExternalRecord(payload, { proteinBuilderConfirmation: reviewConfirmation });
      if (cloningNotebookResult?.entry) {
        const primerCount = Math.max(0, Number(cloningNotebookResult?.entry?.proteinBuilderCloningDesign?.primerCount) || 0);
        const notebookTitle = cleanText(cloningNotebookResult.entry.experimentName, 220)
          || cloningNotebookResult.entry.protocolName;
        ctx.setBuilderStatus(`Created notebook page "${notebookTitle}" with PCR program and ${primerCount} primer${primerCount === 1 ? '' : 's'}.`);
        ctx.setStatus(`Review the assembled plasmid from stored backbone ${backboneDisplayName} and confirm the construct. Notebook page "${notebookTitle}" has the PCR program and primer table.`);
        return;
      }
      if (notebookWarning) {
        ctx.setBuilderStatus(`Construct review opened, but notebook page was not saved: ${notebookWarning}`, true);
        ctx.setStatus(`Review the assembled plasmid from stored backbone ${backboneDisplayName} and confirm the construct. Notebook page was not saved: ${notebookWarning}`, true);
        return;
      }
      ctx.setBuilderStatus(`Opened construct review for ${backboneDisplayName}.`);
      ctx.setStatus(`Review the assembled plasmid from stored backbone ${backboneDisplayName} and confirm the construct.`);
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
