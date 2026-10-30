import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("dna");
import { parseInputRecords, normalizeExternalPayload } from '../parsing.js';
import {
  DEFAULT_MAX_RECORDS
} from '../constants.js';
import {
  LIBRARY_STATUS_TEMPORARY
} from './config.js';
import { showTransientNotice } from '../../../lib/notify.js';
import { dnaNotice, dnaUi, setDnaText } from '../localization.js';

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
    actions.resetAlignmentState();
    resetDetailSurfaces();
    controllers.detail?.updateRecordSelect();
    controllers.detail?.renderActiveRecord();
    controllers.proteinBuilder?.render();
    controllers.home?.syncHomeControlsState();
    const statusKey = { Loaded: 'status.loaded', Imported: 'status.imported', Cleared: 'status.cleared', Idle: 'status.idle' }[statusPrefix];
    actions.setStatus((((((state.records.length ? (statusKey ? dnaUi(statusKey, { count: state.records.length }) : i18nUi.text("{p0}: {p1} record(s).", { p0: statusPrefix, p1: state.records.length })) : (state.errors[0] || dnaUi('status.noRecords'))))))), !state.records.length);
    // A partial parse reports success in the status line, so the parser errors
    // would otherwise only exist in the message box.
    if (state.records.length && state.errors.length) {
      showTransientNotice(state.errors[0], { type: 'error' });
    }
  }

  async function loadCurrentInput() {
    if (state.proteinBuilderConfirmation) {
      actions.setInputComposerVisible(false);
      actions.setStatus(dnaUi('status.proteinBuilderEdit'));
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
      const detail = String(error?.message || error || '');
      dnaNotice(detail ? dnaUi('notice.importNotSaved', { error: detail }) : dnaUi('notice.importNotSavedUnknown'), { type: 'error' });
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
      setDnaText(elements.fileNameLabel, 'file.none');
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
    actions.setStatus('');
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
      if (confirmation?.cloningDesignSource) {
        actions.openProteinBuilderCloningDesign(confirmation);
      } else {
        controllers.home?.navigateToDetail();
        controllers.detail?.renderActiveRecord?.();
        actions.setStatus(i18nUi.text("Imported {p0} from {p1}.", { p0: record.name, p1: record.sourceFormat || 'external' }));
      }
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
