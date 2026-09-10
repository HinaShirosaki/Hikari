import {
  cleanText,
  normalizeSequenceText
} from '../shared.js';
import {
  buildCurrentProteinBuilderDesignSource,
  normalizeProteinBuilderCloningDesignSource
} from './protein-builder-design-source.js';

export function createProteinBuilderConfirmationActions(ctx) {
  const { state, controllers, actions } = ctx;

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

  function openProteinBuilderCloningDesign(confirmation) {
    const record = actions.getSelectedRecord();
    const design = buildCurrentProteinBuilderDesignSource(confirmation.cloningDesignSource, record);
    const insert = normalizeSequenceText(design.dnaConstruct.sequence);
    const backbone = design.backbone;
    const insertionStart = Number(record.features?.find((feature) => feature.id === 'protein_builder_insert')?.segments?.[0]?.start ?? backbone.insertionOffset);
    const start = Math.max(0, Math.min(backbone.backboneSequence.length, Number.isFinite(insertionStart) ? insertionStart : backbone.backboneSequence.length));
    const restriction = ['restriction', 'restriction-ligation'].includes(cleanText(backbone.variantMode || backbone.variant_mode, 80).toLowerCase());
    state.sequenceEditDesignSource = {
      recordName: record.name,
      parentEntryId: cleanText(backbone.entryId || backbone.hostVectorId, 200),
      originalSequence: backbone.templateSequence || backbone.backboneSequence,
      editedSequence: record.sequence,
      originalRange: { start, end: start },
      editedRange: { start, end: start + insert.length },
      editRequest: { type: 'insertion', start: start + 1, end: start, editedSequence: insert, originalSequence: '' },
      defaultStrategy: restriction ? 'restriction-ligation' : 'gibson',
      supportedStrategies: restriction ? ['restriction-ligation'] : ['gibson', 'in-fusion'],
      proteinBuilderDesign: { ...design, constructName: confirmation.constructName },
      notebookEntryId: confirmation.notebookEntryId
    };
    state.cloningDesign = {};
    setProteinBuilderConfirmation(null, { render: false });
    controllers.cloningDesign.open();
  }

  // Older review payloads also enter the shared cloning page rather than
  // retaining a second primer-generation and confirmation path.
  function confirmProteinBuilderConstruct() {
    if (state.proteinBuilderConfirmation?.cloningDesignSource) {
      openProteinBuilderCloningDesign(state.proteinBuilderConfirmation);
    }
  }

  return {
    normalizeProteinBuilderConfirmation,
    openProteinBuilderCloningDesign,
    setProteinBuilderConfirmation,
    confirmProteinBuilderConstruct
  };
}
