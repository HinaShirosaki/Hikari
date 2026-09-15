import {
  cleanText,
  clamp,
  normalizeSequenceText
} from '../shared.js';
import { buildAminoAcidSubstitution } from '../amino-acid-substitution.js';
import { buildEditedSequenceName } from '../sequence-naming.js';
import { PROTEIN_DIRECT_CLONING_MAX_AA } from '../protein-builder/constants.js';
import {
  adjustFeatureSegmentsForSequenceEdit,
  buildSequenceEditDesignSource,
  buildSequenceEditStatus
} from './sequence-edit-helpers.js';

export function createSequenceEditActions(ctx) {
  const { state, actions, controllers } = ctx;

  function hasCurrentCloningDesignSource() {
    const source = state.sequenceEditDesignSource;
    const record = actions.getSelectedRecord();
    const sourceSequence = normalizeSequenceText(source?.editedSequence || '');
    const recordSequence = normalizeSequenceText(record?.sequence || '');
    const isLongProteinInput = Math.max(0, Number(source?.proteinInputAaLength) || 0)
      > PROTEIN_DIRECT_CLONING_MAX_AA;
    return Boolean(
      !isLongProteinInput
      && source?.editRequest
      && sourceSequence.length
      && recordSequence
      && sourceSequence === recordSequence
    );
  }

  async function applySequenceEdit(payload = {}) {
    const record = actions.getSelectedRecord();
    if (!record?.sequence?.length) {
      throw new Error('Load a record before editing sequence bases.');
    }
    const edit = normalizeSequenceEditPayload(payload, record.sequence);
    const nextSequence = `${edit.sequence.slice(0, edit.start)}${edit.replacement}${edit.sequence.slice(edit.end)}`;
    if (!nextSequence.length) {
      throw new Error('The sequence cannot be empty.');
    }

    const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    const nextRecords = [...state.records];
    const current = nextRecords[selectedIndex];
    // A feature the caller is swapping out wholesale is dropped, not truncated.
    const keptFeatures = (Array.isArray(current?.features) ? current.features : [])
      .filter((feature) => feature !== payload?.replacedFeature);
    const nextRecord = {
      ...current,
      sequence: nextSequence,
      features: adjustFeatureSegmentsForSequenceEdit(keptFeatures, { start: edit.start, end: edit.end }, edit.replacement.length, nextSequence.length)
    };
    updateEditState({
      current,
      nextRecord,
      nextRecords,
      selectedIndex,
      nextSequence,
      edit,
      // Vector Builder passes the stored vector the replacement was taken from;
      // the cloning design then templates that PCR off it.
      donorEntryId: payload?.donorEntryId,
      donorName: payload?.donorName
    });
    renderAfterEdit({ preserveScroll: true });
    await actions.persistFeatureMutation(nextRecord, buildSequenceEditStatus(edit.mode, { start: edit.start, end: edit.end }, edit.replacement.length));
  }

  async function applyAminoAcidEdit(payload = {}) {
    const record = actions.getSelectedRecord();
    if (!record?.sequence?.length) {
      throw new Error('Load a record before changing an amino acid.');
    }
    const substitution = buildAminoAcidSubstitution(record.sequence, payload);
    const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    const nextRecords = [...state.records];
    const current = nextRecords[selectedIndex];
    if (!current) {
      throw new Error('The selected sequence record is no longer available.');
    }
    const sortedPositions = [...substitution.codonPositions].sort((left, right) => left - right);
    const nextRecord = {
      ...current,
      sequence: substitution.nextSequence,
      features: Array.isArray(current?.features) ? [...current.features] : []
    };
    updateEditState({
      current,
      nextRecord,
      nextRecords,
      selectedIndex,
      nextSequence: substitution.nextSequence,
      edit: {
        sequence: normalizeSequenceText(record.sequence),
        start: sortedPositions[0],
        end: sortedPositions[sortedPositions.length - 1] + 1,
        replacement: substitution.targetCodon
      },
      cursorBase: sortedPositions[sortedPositions.length - 1] + 1
    });
    renderAfterEdit({ preserveScroll: true });
    await actions.persistFeatureMutation(nextRecord, buildAminoAcidEditStatus(substitution));
    return substitution;
  }

  return {
    applyAminoAcidEdit,
    applySequenceEdit,
    hasCurrentCloningDesignSource
  };

  function normalizeSequenceEditPayload(payload, rawSequence) {
    const sequence = normalizeSequenceText(rawSequence);
    const sequenceLength = sequence.length;
    const mode = payload?.mode === 'delete' ? 'delete' : (payload?.mode === 'replace' ? 'replace' : 'insert');
    const start = clamp(Math.round(Number(payload?.range?.start) || 0), 0, sequenceLength);
    const end = mode === 'insert' ? start : clamp(Math.round(Number(payload?.range?.end) || start), start, sequenceLength);
    const replacement = mode === 'delete' ? '' : normalizeSequenceText(payload?.sequence || '').replace(/\*/g, '');
    if (mode !== 'insert' && end <= start) {
      throw new Error('Select one or more bases before editing.');
    }
    if (mode !== 'delete' && !replacement.length) {
      throw new Error('Enter at least one base before confirming.');
    }
    return { sequence, mode, start, end, replacement };
  }

  function updateEditState({
    current,
    nextRecord,
    nextRecords,
    selectedIndex,
    nextSequence,
    edit,
    cursorBase,
    donorEntryId = '',
    donorName = ''
  }) {
    // Keep the earliest original as the design baseline: if the prior design
    // source ended on exactly this edit's starting sequence, the edits chain, so
    // carry its original forward instead of resetting to the pre-edit sequence.
    const existing = state.sequenceEditDesignSource;
    const isChainedEdit = existing
      && normalizeSequenceText(existing.editedSequence || '') === normalizeSequenceText(edit.sequence);
    const baseline = isChainedEdit ? existing.originalSequence : edit.sequence;
    const baseName = isChainedEdit
      ? (existing.baseName || existing.parentRecordName || existing.recordName)
      : current?.name;
    const parentEntryId = isChainedEdit ? existing.parentEntryId : state.activeEntryId;
    const designSource = buildSequenceEditDesignSource({
      record: current,
      originalSequence: baseline,
      nextSequence,
      baseName,
      parentEntryId
    });
    const generatedName = buildEditedSequenceName({
      record: current,
      baseName,
      originalSequence: baseline,
      editedSequence: nextSequence,
      editRequest: designSource.editRequest
    });
    nextRecord.name = generatedName;
    state.sequenceEditDesignSource = {
      ...designSource,
      recordName: generatedName,
      generatedName,
      donorEntryId: cleanText(donorEntryId, 200),
      donorName: cleanText(donorName, 160)
    };
    // Editing a library entry (saved or unsaved) creates a local derived
    // sequence. The Save action will allocate a new entry instead of
    // overwriting the parent, which stays intact as the cloning PCR template.
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    state.cloningDesign = {};
    if (typeof nextRecord.quality === 'string' && nextRecord.quality.length) {
      nextRecord.quality = '';
      const warning = 'Sequence edits clear per-base quality scores because they no longer match the edited sequence.';
      if (!state.warnings.includes(warning)) {
        state.warnings = [...state.warnings, warning];
      }
    }
    nextRecords[selectedIndex] = nextRecord;
    state.records = nextRecords;
    state.selectedFeatureIndex = -1;
    // Feature indices shift with the bases; a stale Vector Builder selection
    // would land on the next feature and make a repeated Delete remove it.
    if (state.vectorBuilder) {
      state.vectorBuilder.selectedFeatureIndex = -1;
    }
    state.sequenceCursorBase = clamp(
      Number.isFinite(Number(cursorBase)) ? Number(cursorBase) : edit.start + edit.replacement.length,
      0,
      nextSequence.length
    );
    actions.resetAlignmentState({ preserveSessions: true });
    if (state.proteinBuilderConfirmation) {
      state.proteinBuilderConfirmation = { ...state.proteinBuilderConfirmation, plasmidLength: nextSequence.length };
    }
  }

  function renderAfterEdit(options = {}) {
    controllers.detail?.clearSequenceSelection({ preserveCursor: true });
    controllers.detail?.hideFeatureContextMenu();
    controllers.detail?.hideFeatureEditor();
    controllers.detail?.hidePrimerDesignOverlay?.();
    controllers.detail?.updateRecordSelect?.();
    controllers.detail?.renderActiveRecord?.({ preserveScroll: Boolean(options?.preserveScroll) });
    controllers.cloningDesign?.render?.();
    controllers.vectorBuilder?.render?.();
    controllers.alignment?.handleReferenceRecordChanged?.();
  }
}

function buildAminoAcidEditStatus(substitution = {}) {
  const positions = [...(Array.isArray(substitution?.codonPositions) ? substitution.codonPositions : [])]
    .map((position) => Math.max(0, Math.round(Number(position) || 0)))
    .sort((left, right) => left - right);
  const positionLabel = positions.length === 3
    && positions[1] === positions[0] + 1
    && positions[2] === positions[1] + 1
    ? `${positions[0] + 1}-${positions[2] + 1}`
    : positions.map((position) => position + 1).join(', ');
  return `Changed amino acid ${substitution?.aminoAcid || 'X'} (${substitution?.codon || '---'}) to ${substitution?.targetAminoAcid || 'X'} (${substitution?.targetCodon || '---'}) at bases ${positionLabel}.`;
}
