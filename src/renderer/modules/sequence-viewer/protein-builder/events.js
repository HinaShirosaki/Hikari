import { sanitizeProteinAssemblySequence } from './assembly-model.js';
import { cleanText } from '../shared.js';

export function installProteinBuilderEvents(ctx) {
  const { elements, state } = ctx;

  async function copySequence(value, label) {
    const clipboard = elements.proteinBuilderSequence?.ownerDocument?.defaultView?.navigator?.clipboard
      || globalThis?.window?.navigator?.clipboard
      || globalThis?.navigator?.clipboard;
    if (!value || !clipboard?.writeText) {
      ctx.setBuilderStatus(`Unable to copy the ${label} sequence.`, true);
      return false;
    }
    try {
      await clipboard.writeText(value);
      ctx.setBuilderStatus(`Copied the ${label} sequence.`);
      return true;
    } catch {
      ctx.setBuilderStatus(`Unable to copy the ${label} sequence.`, true);
      return false;
    }
  }

  ctx.bindEvents = function bindEvents() {
    // Protein Builder is reached only through Vector Builder now: its toolbar for
    // the standalone stored-backbone path, its map menu for targeted inserts.
    elements.proteinBuilderBackBtn?.addEventListener('click', () => {
      ctx.onNavigateHome();
      ctx.setBuilderStatus('Returned to Sequence Library.');
    });

    // The assembled sequence is editable so an initiator M, a stop, or a point
    // mutation can go on without inventing a block for it.
    const beginProteinSequenceEdit = () => {
      elements.proteinBuilderSequenceEditor?.classList?.add('is-editing');
      elements.proteinBuilderSequence?.focus?.();
    };
    elements.proteinBuilderProteinSequenceHighlight?.addEventListener('click', beginProteinSequenceEdit);
    elements.proteinBuilderProteinSequenceHighlight?.addEventListener('keydown', (event) => {
      const key = String(event?.key || '');
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        event.preventDefault?.();
        beginProteinSequenceEdit();
      }
    });
    elements.proteinBuilderSequence?.addEventListener('focus', () => {
      elements.proteinBuilderSequenceEditor?.classList?.add('is-editing');
    });
    elements.proteinBuilderSequence?.addEventListener('blur', () => {
      elements.proteinBuilderSequenceEditor?.classList?.remove('is-editing');
    });
    elements.proteinBuilderSequence?.addEventListener('change', () => {
      const applied = ctx.setAssembledSequenceOverride(elements.proteinBuilderSequence.value);
      // Write the accepted sequence back even while the field still has focus,
      // so what is on screen is what the build will use.
      elements.proteinBuilderSequence.value = applied.sequence;
      ctx.render();
      if (applied.dropped.length) {
        ctx.setBuilderStatus(
          `Ignored ${applied.dropped.join(', ')}: the assembled sequence takes the 20 amino acids and *.`,
          true
        );
      }
    });

    elements.proteinBuilderSequenceResetBtn?.addEventListener('click', (event) => {
      event.preventDefault?.();
      ctx.setAssembledSequenceOverride('');
      ctx.render();
      ctx.setBuilderStatus('Assembled sequence reset to the block chain.');
    });

    elements.proteinBuilderCopyProteinBtn?.addEventListener('click', () => {
      void copySequence(sanitizeProteinAssemblySequence(elements.proteinBuilderSequence?.value || '', true), 'protein');
    });

    elements.proteinBuilderCopyDnaBtn?.addEventListener('click', () => {
      void copySequence(state.dnaConstruct?.sequence || '', 'DNA');
    });

    elements.proteinBuilderCodonUsageSelect?.addEventListener('change', () => {
      ctx.invalidateDnaConstruct();
      ctx.renderDnaConstruct();
      ctx.setBuilderStatus('Codon usage changed. Build the DNA sequence again.');
    });

    elements.proteinBuilderAddProteinBtn?.addEventListener('click', () => {
      ctx.openAddProteinDialog();
    });

    elements.proteinBuilderAddProteinForm?.addEventListener('input', () => {
      ctx.renderAddProteinDialog();
    });

    elements.proteinBuilderAddProteinForm?.addEventListener('submit', (event) => {
      event.preventDefault?.();
      ctx.addProteinFromDialog();
    });

    elements.proteinBuilderAddProteinForm?.addEventListener('keydown', (event) => {
      if (String(event?.key || '') === 'Escape') {
        event.preventDefault?.();
        ctx.closeAddProteinDialog();
      }
    });

    elements.proteinBuilderAddProteinCloseBtn?.addEventListener('click', () => ctx.closeAddProteinDialog());
    elements.proteinBuilderAddProteinCancelBtn?.addEventListener('click', () => ctx.closeAddProteinDialog());
    elements.proteinBuilderAddProteinOverlay?.addEventListener('click', (event) => {
      if (event?.target === elements.proteinBuilderAddProteinOverlay) {
        ctx.closeAddProteinDialog();
      }
    });

    elements.proteinBuilderForm?.addEventListener('input', (event) => {
      if (event?.target === elements.proteinBuilderNameInput) {
        state.constructNameEdited = Boolean(cleanText(elements.proteinBuilderNameInput?.value, 140).trim());
      }
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

    elements.proteinBuilderFeatureSearchInput?.addEventListener('keydown', (event) => {
      if (String(event?.key || '') !== 'Enter') {
        return;
      }
      event.preventDefault?.();
      void ctx.runFeatureSearch();
    });

    // A result is picked, not added: which vector it comes from is chosen next,
    // and Add Block is what puts it in the chain.
    elements.proteinBuilderFeatureSearchResults?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-protein-builder-feature-select-id]');
      const featureId = cleanText(trigger?.dataset?.proteinBuilderFeatureSelectId, 200);
      if (featureId) {
        ctx.selectSearchFeature(featureId);
      }
    });
    elements.proteinBuilderFeatureSearchResults?.addEventListener('keydown', (event) => {
      const key = String(event?.key || '');
      if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') {
        return;
      }
      const trigger = event?.target?.closest?.('[data-protein-builder-feature-select-id]');
      const featureId = cleanText(trigger?.dataset?.proteinBuilderFeatureSelectId, 200);
      if (featureId) {
        event.preventDefault?.();
        ctx.selectSearchFeature(featureId);
      }
    });

    elements.proteinBuilderFeatureHosts?.addEventListener('click', (event) => {
      const trigger = event?.target?.closest?.('[data-protein-builder-feature-host-id]');
      const hostId = cleanText(trigger?.dataset?.proteinBuilderFeatureHostId, 200);
      if (hostId) {
        ctx.selectSearchFeatureHost(hostId);
      }
    });

    elements.proteinBuilderFeatureAddBtn?.addEventListener('click', (event) => {
      event.preventDefault?.();
      if (!ctx.addSelectedFeatureRow()) {
        ctx.setFeatureSearchStatus(
          ctx.getSelectedSearchFeature()
            ? 'Wait for the selected source vector to finish loading before adding this block.'
            : 'Pick a stored feature before adding a block.',
          true
        );
        return;
      }
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

    // Commit inline custom-block edits on change. Rebuilding this rendered list
    // on every keystroke would replace the focused input before typing finishes.
    elements.proteinBuilderWorkflow?.addEventListener('change', (event) => {
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
