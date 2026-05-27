import { createProteinBuilderCloningNotebookPage } from '../protein-builder-cloning-notebook.js';
import {
  cleanText,
  normalizeSequenceText
} from '../shared.js';
import {
  buildCurrentProteinBuilderDesignSource,
  normalizeProteinBuilderCloningDesignSource
} from './protein-builder-design-source.js';

export function createProteinBuilderConfirmationActions(ctx) {
  const { state, options, controllers, actions } = ctx;

  function normalizeProteinBuilderConfirmation(payload) {
    const safePayload = payload && typeof payload === 'object' ? payload : null;
    if (!safePayload) {
      return null;
    }

    const normalized = {
      recordName: cleanText(safePayload.recordName, 160),
      constructName: cleanText(safePayload.constructName, 160),
      backboneName: cleanText(safePayload.backboneName, 160),
      sourceLabel: cleanText(safePayload.sourceLabel, 160),
      plasmidLength: Math.max(0, Number(safePayload.plasmidLength) || 0),
      insertLength: Math.max(0, Number(safePayload.insertLength) || 0),
      notebookEntryId: cleanText(safePayload.notebookEntryId, 160),
      notebookTitle: cleanText(safePayload.notebookTitle, 220),
      assemblyStrategy: cleanText(safePayload.assemblyStrategy, 120),
      primerCount: Math.max(0, Number(safePayload.primerCount) || 0),
      cloningDesignSource: normalizeProteinBuilderCloningDesignSource(safePayload.cloningDesignSource)
    };

    return Object.values(normalized).some((value) => Boolean(value)) ? normalized : null;
  }

  function setProteinBuilderConfirmation(payload, renderOptions = {}) {
    state.proteinBuilderConfirmation = normalizeProteinBuilderConfirmation(payload);
    if (renderOptions?.render === false) {
      return;
    }
    controllers.detail?.renderActiveRecord?.();
  }

  function createConfirmedProteinBuilderCloningNotebookPage(confirmation = {}) {
    const designSource = confirmation?.cloningDesignSource;
    if (!designSource) {
      return null;
    }

    const currentRecord = actions.getSelectedRecord();
    const sourceRecord = designSource.assembledRecord || {};
    const assembledRecord = {
      ...sourceRecord,
      ...(currentRecord || {}),
      name: cleanText(currentRecord?.name, 160)
        || cleanText(sourceRecord?.name, 160)
        || cleanText(confirmation?.recordName, 160)
        || 'Protein Builder construct',
      sequence: normalizeSequenceText(currentRecord?.sequence || sourceRecord?.sequence || '')
    };
    if (!assembledRecord.sequence) {
      return null;
    }

    const currentDesignSource = buildCurrentProteinBuilderDesignSource(designSource, assembledRecord);
    return createProteinBuilderCloningNotebookPage({
      state: options?.state,
      persist: options?.persist,
      createId: options?.createId,
      onNotebookEntriesChanged: options?.onNotebookEntriesChanged,
      entryId: confirmation?.notebookEntryId,
      constructName: cleanText(confirmation?.constructName, 160)
        || cleanText(designSource?.constructName, 160)
        || cleanText(assembledRecord?.name, 160),
      backbone: currentDesignSource.backbone,
      dnaConstruct: currentDesignSource.dnaConstruct,
      assembledRecord
    });
  }

  function confirmProteinBuilderConstruct() {
    if (!state.proteinBuilderConfirmation) {
      return;
    }
    const confirmation = state.proteinBuilderConfirmation;
    let cloningNotebookResult = null;
    let notebookWarning = '';
    try {
      cloningNotebookResult = createConfirmedProteinBuilderCloningNotebookPage(confirmation);
    } catch (error) {
      notebookWarning = error?.message || 'Failed to update the cloning notebook page.';
    }

    setProteinBuilderConfirmation(null);
    actions.setInputComposerVisible(false);
    if (cloningNotebookResult?.entry) {
      const notebookTitle = cleanText(cloningNotebookResult.entry.experimentName, 220)
        || cleanText(cloningNotebookResult.entry.protocolName, 220)
        || 'Protein Builder Cloning Assembly';
      const primerCount = Math.max(0, Number(cloningNotebookResult.entry?.proteinBuilderCloningDesign?.primerCount) || 0);
      actions.setStatus(`Construct confirmed. Notebook page "${notebookTitle}" has the cloning plan, PCR program, and ${primerCount} primer${primerCount === 1 ? '' : 's'}. Save it to add it to Sequence Library.`);
      return;
    }
    if (notebookWarning) {
      actions.setStatus(`Construct confirmed, but the cloning notebook page was not updated: ${notebookWarning}`, true);
      return;
    }
    actions.setStatus('Construct confirmed. Save it to add it to Sequence Library.');
  }

  return {
    normalizeProteinBuilderConfirmation,
    setProteinBuilderConfirmation,
    confirmProteinBuilderConstruct
  };
}
