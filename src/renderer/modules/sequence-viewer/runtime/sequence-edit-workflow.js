import {
  clamp,
  normalizeSequenceText
} from '../shared.js';
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
    return Boolean(source?.editRequest && sourceSequence.length && recordSequence && sourceSequence === recordSequence);
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
    const nextRecord = {
      ...current,
      sequence: nextSequence,
      features: adjustFeatureSegmentsForSequenceEdit(current?.features, { start: edit.start, end: edit.end }, edit.replacement.length, nextSequence.length)
    };
    updateEditState({ current, nextRecord, nextRecords, selectedIndex, nextSequence, edit });
    renderAfterEdit();
    await actions.persistFeatureMutation(nextRecord, buildSequenceEditStatus(edit.mode, { start: edit.start, end: edit.end }, edit.replacement.length));
  }

  return {
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

  function updateEditState({ current, nextRecord, nextRecords, selectedIndex, nextSequence, edit }) {
    state.sequenceEditDesignSource = buildSequenceEditDesignSource({
      record: current,
      previousSequence: edit.sequence,
      nextSequence,
      mode: edit.mode,
      start: edit.start,
      end: edit.end,
      replacement: edit.replacement
    });
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
    state.sequenceCursorBase = clamp(edit.start + edit.replacement.length, 0, nextSequence.length);
    actions.resetAlignmentState({ preserveSessions: true });
    if (state.proteinBuilderConfirmation) {
      state.proteinBuilderConfirmation = { ...state.proteinBuilderConfirmation, plasmidLength: nextSequence.length };
    }
  }

  function renderAfterEdit() {
    controllers.detail?.clearSequenceSelection({ preserveCursor: true });
    controllers.detail?.hideFeatureContextMenu();
    controllers.detail?.hideFeatureEditor();
    controllers.detail?.hidePrimerDesignOverlay?.();
    controllers.detail?.updateRecordSelect?.();
    controllers.detail?.renderActiveRecord?.();
    controllers.cloningDesign?.render?.();
    controllers.alignment?.handleReferenceRecordChanged?.();
  }
}
