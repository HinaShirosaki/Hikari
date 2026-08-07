import { sanitizeProteinAssemblySequence } from './assembly-model.js';
import { cleanText } from '../shared.js';

export function installProteinBuilderEvents(ctx) {
  const { elements, state } = ctx;

  ctx.bindEvents = function bindEvents() {
    // Protein Builder is reached only through Vector Builder now: its toolbar for
    // the standalone stored-backbone path, its map menu for targeted inserts.
    elements.proteinBuilderBackBtn?.addEventListener('click', () => {
      ctx.onNavigateHome();
      ctx.setBuilderStatus('Returned to Sequence Library.');
    });

    elements.proteinBuilderResetBtn?.addEventListener('click', () => {
      ctx.resetRows();
      ctx.setBuilderStatus('Reset the chain to the default layout.');
      ctx.render();
    });

    elements.proteinBuilderAddCustomBtn?.addEventListener('click', () => {
      ctx.addCustomRow();
      ctx.setBuilderStatus('Added a custom block.');
    });

    elements.proteinBuilderForm?.addEventListener('input', () => {
      ctx.render();
    });

    elements.proteinBuilderBuildDnaBtn?.addEventListener('click', () => {
      ctx.buildCurrentDnaSequence();
    });

    elements.proteinBuilderAssembleBtn?.addEventListener('click', () => {
      void ctx.openAssemblyDialog();
    });

    elements.proteinBuilderInsertVectorBtn?.addEventListener('click', () => {
      void ctx.insertConstructIntoVector();
    });

    elements.proteinBuilderCancelVectorBtn?.addEventListener('click', () => {
      ctx.onCancelVectorInsert();
      ctx.setBuilderStatus('Cancelled the vector insertion target.');
    });

    elements.proteinBuilderCommonBlocks?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-protein-builder-add-library-id]');
      const type = cleanText(trigger?.dataset?.proteinBuilderAddLibraryType, 40);
      const libraryId = cleanText(trigger?.dataset?.proteinBuilderAddLibraryId, 120);
      if (!type || !libraryId) {
        return;
      }
      ctx.addLibraryRow(type, libraryId);
      ctx.setBuilderStatus(`Added ${libraryId} to the chain.`);
    });

    elements.proteinBuilderFeatureSearchBtn?.addEventListener('click', () => {
      void ctx.runFeatureSearch();
    });

    elements.proteinBuilderFeatureSearchInput?.addEventListener('keydown', (event) => {
      if (String(event?.key || '') !== 'Enter') {
        return;
      }
      event.preventDefault?.();
      void ctx.runFeatureSearch();
    });

    elements.proteinBuilderFeatureSearchResults?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-protein-builder-feature-add-id]');
      const featureId = cleanText(trigger?.dataset?.proteinBuilderFeatureAddId, 200);
      if (!featureId) {
        return;
      }
      ctx.addFeatureRowById(featureId);
      ctx.setBuilderStatus('Added feature-derived block to the chain.');
    });

    elements.proteinBuilderWorkflow?.addEventListener('click', (event) => {
      const removeTrigger = event?.target?.closest?.('[data-protein-builder-row-remove]');
      const upTrigger = event?.target?.closest?.('[data-protein-builder-row-up]');
      const downTrigger = event?.target?.closest?.('[data-protein-builder-row-down]');

      if (removeTrigger?.dataset?.proteinBuilderRowRemove) {
        ctx.removeRow(cleanText(removeTrigger.dataset.proteinBuilderRowRemove, 160));
        ctx.render();
        return;
      }
      if (upTrigger?.dataset?.proteinBuilderRowUp) {
        ctx.moveRow(cleanText(upTrigger.dataset.proteinBuilderRowUp, 160), 'up');
        ctx.render();
        return;
      }
      if (downTrigger?.dataset?.proteinBuilderRowDown) {
        ctx.moveRow(cleanText(downTrigger.dataset.proteinBuilderRowDown, 160), 'down');
        ctx.render();
      }
    });

    elements.proteinBuilderWorkflow?.addEventListener('input', (event) => {
      const customLabelTrigger = event?.target?.closest?.('[data-protein-builder-custom-label]');
      const customSequenceTrigger = event?.target?.closest?.('[data-protein-builder-custom-sequence]');

      if (customLabelTrigger?.dataset?.proteinBuilderCustomLabel) {
        const rowId = cleanText(customLabelTrigger.dataset.proteinBuilderCustomLabel, 160);
        const row = state.rows.find((item) => item.id === rowId);
        if (row) {
          row.label = cleanText(customLabelTrigger.value, 160) || 'Custom Block';
        }
        ctx.render();
        return;
      }

      if (customSequenceTrigger?.dataset?.proteinBuilderCustomSequence) {
        const rowId = cleanText(customSequenceTrigger.dataset.proteinBuilderCustomSequence, 160);
        const row = state.rows.find((item) => item.id === rowId);
        if (row) {
          row.sequence = sanitizeProteinAssemblySequence(customSequenceTrigger.value, true);
          ctx.invalidateDnaConstruct();
        }
        ctx.render();
      }
    });

    elements.proteinBuilderAssemblyList?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-protein-builder-backbone-id]');
      const backboneId = cleanText(trigger?.dataset?.proteinBuilderBackboneId, 400);
      if (!backboneId) {
        return;
      }
      state.selectedBackboneId = backboneId;
      ctx.renderAssemblyDialog();
    });

    elements.proteinBuilderAssemblyApplyBtn?.addEventListener('click', () => {
      void ctx.assembleWithStoredBackbone();
    });

    elements.proteinBuilderAssemblyCloseBtn?.addEventListener('click', () => {
      ctx.closeAssemblyDialog();
    });

    elements.proteinBuilderAssemblyCancelBtn?.addEventListener('click', () => {
      ctx.closeAssemblyDialog();
    });

    elements.proteinBuilderAssemblyOverlay?.addEventListener('click', (event) => {
      if (event?.target !== elements.proteinBuilderAssemblyOverlay) {
        return;
      }
      ctx.closeAssemblyDialog();
    });
  };
}
