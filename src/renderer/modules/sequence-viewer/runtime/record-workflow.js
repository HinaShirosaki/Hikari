import { parseInputRecords, normalizeExternalPayload } from '../parsing.js';
import {
  DEFAULT_MAX_RECORDS
} from '../constants.js';
import {
  LIBRARY_STATUS_TEMPORARY
} from './config.js';

export function createRecordWorkflowActions(ctx) {
  const { state, elements, actions, controllers, dialogs } = ctx;

  function setRecords(result, statusPrefix = 'Loaded') {
    state.records = Array.isArray(result.records) ? result.records : [];
    state.warnings = Array.isArray(result.warnings) ? result.warnings : [];
    state.errors = Array.isArray(result.errors) ? result.errors : [];
    state.isAnnotating = false;
    state.isRecognizingBackbone = false;
    state.proteinBuilderConfirmation = null;
    state.sequenceEditDesignSource = null;
    state.cloningDesign = {};
    dialogs.closeBackboneRecognitionDialog();
    state.selectedRecordIndex = 0;
    state.selectedFeatureIndex = -1;
    if (elements.saveNameInput) {
      elements.saveNameInput.value = state.records[0]?.name || '';
    }
    actions.resetAlignmentState();
    resetDetailSurfaces();
    controllers.detail?.updateRecordSelect();
    controllers.detail?.renderActiveRecord();
    controllers.proteinBuilder?.render();
    controllers.home?.syncHomeControlsState();
    actions.setStatus(state.records.length ? `${statusPrefix}: ${state.records.length} record(s).` : (state.errors[0] || 'No records loaded.'), !state.records.length);
  }

  async function loadCurrentInput() {
    if (state.proteinBuilderConfirmation) {
      actions.setInputComposerVisible(false);
      actions.setStatus('Use the sequence edit dialog to edit this Protein Builder construct.');
      return;
    }
    const raw = state.mode === 'file' ? state.fileText : (elements.inputTextarea?.value || '');
    if (!String(raw || '').trim()) {
      setRecords({ records: [], warnings: [], errors: ['Provide sequence input first.'] }, 'Idle');
      return;
    }
    const parsed = parseInputRecords(raw, { maxRecords: DEFAULT_MAX_RECORDS });
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    setRecords(parsed, 'Loaded');
    actions.setInputComposerVisible(!(Array.isArray(parsed.records) && parsed.records.length > 0));
    await maybePersistImportedGenbankRecord(parsed);
  }

  async function maybePersistImportedGenbankRecord(parsed) {
    const format = String(parsed?.format || '').toLowerCase();
    if (format !== 'genbank' || state.activeEntryId) {
      return null;
    }
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    if (records.length !== 1 || !records[0]?.sequence?.length) {
      return null;
    }
    const bridge = actions.getBridge();
    if (!actions.getStoragePath() || !bridge?.sequenceLibraryUpsert) {
      return null;
    }
    try {
      const entry = await actions.persistRecordToLibrary(records[0], { status: LIBRARY_STATUS_TEMPORARY, name: records[0].name || 'sequence' });
      await controllers.home?.refreshLibraryEntries({ selectedId: entry.id, filter: entry.status || LIBRARY_STATUS_TEMPORARY, silent: true });
      return entry;
    } catch (error) {
      console.warn('Failed to persist imported GenBank record to the library:', error);
      return null;
    }
  }

  function clearAll() {
    if (elements.inputTextarea) {
      elements.inputTextarea.value = '';
    }
    if (elements.fileInput) {
      elements.fileInput.value = '';
    }
    if (elements.fileNameLabel) {
      elements.fileNameLabel.textContent = 'No file selected';
    }
    state.fileName = '';
    state.fileText = '';
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    state.isAnnotating = false;
    state.isRecognizingBackbone = false;
    dialogs.closeBackboneRecognitionDialog();
    actions.setMode('paste');
    actions.setInputComposerVisible(true);
    resetDetailSurfaces();
    setRecords({ records: [], warnings: [], errors: [] }, 'Cleared');
    actions.setStatus('Idle');
  }

  function loadFromExternal(payload, loadOptions = {}) {
    const record = normalizeExternalPayload(payload);
    const hasSequence = Boolean(record.sequence.length);
    const confirmation = actions.normalizeProteinBuilderConfirmation(loadOptions?.proteinBuilderConfirmation);
    actions.setMode('paste');
    if (elements.inputTextarea) {
      elements.inputTextarea.value = confirmation ? '' : record.sequence;
    }
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    setRecords({
      records: hasSequence ? [record] : [],
      warnings: hasSequence ? [] : ['External payload had no sequence.'],
      errors: hasSequence ? [] : ['Failed to load external payload.']
    }, 'Imported');
    actions.setProteinBuilderConfirmation(confirmation, { render: false });
    actions.setInputComposerVisible(!hasSequence);
    if (hasSequence) {
      controllers.home?.navigateToDetail();
      controllers.detail?.renderActiveRecord?.();
      actions.setStatus(confirmation ? 'Review the assembled plasmid and confirm the construct.' : `Imported ${record.name} from ${record.sourceFormat || 'external'}.`);
    }
  }

  function resetDetailSurfaces() {
    controllers.detail?.clearSequenceSelection();
    controllers.detail?.hideFeatureContextMenu();
    controllers.detail?.hideFeatureEditor();
    controllers.detail?.hidePrimerDesignOverlay?.();
    controllers.detail?.hideSequenceEditDialog?.();
  }

  return {
    clearAll,
    loadCurrentInput,
    loadFromExternal,
    maybePersistImportedGenbankRecord,
    setRecords
  };
}
