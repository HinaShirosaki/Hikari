import {
  buildCircularPreviewHtmlDocument,
  buildRecordGenbankText
} from '../storage.js';
import {
  buildSequenceSignature,
  cleanText,
  normalizeRecordName,
  normalizeTopology
} from '../shared.js';
import {
  LIBRARY_STATUS_SAVED,
  LIBRARY_STATUS_TEMPORARY
} from './config.js';

export function createLibraryPersistenceActions(ctx) {
  const { state, elements, actions, controllers } = ctx;

  async function persistRecordToLibrary(record, persistOptions = {}) {
    const bridge = actions.getBridge();
    const storagePath = actions.getStoragePath();
    if (!storagePath) {
      throw new Error('Set Storage Folder Path in Settings before saving sequence entries.');
    }
    if (!bridge?.sequenceLibraryUpsert) {
      throw new Error('Sequence library storage API unavailable.');
    }

    const safeRecord = record && typeof record === 'object' ? record : null;
    if (!safeRecord?.sequence?.length) {
      throw new Error('No sequence record available to persist.');
    }

    const status = String(persistOptions?.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY).toLowerCase() === LIBRARY_STATUS_SAVED
      ? LIBRARY_STATUS_SAVED
      : LIBRARY_STATUS_TEMPORARY;
    const name = normalizeRecordName(persistOptions?.name || elements.saveNameInput?.value || safeRecord.name || 'sequence', 'sequence');
    const gbkText = buildRecordGenbankText(safeRecord);
    if (!gbkText.trim()) {
      throw new Error('Failed to generate GenBank text for sequence entry.');
    }

    const response = await bridge.sequenceLibraryUpsert({
      storagePath,
      id: cleanText(persistOptions?.id || state.activeEntryId, 200),
      name,
      status,
      sourceFormat: String(safeRecord.sourceFormat || ''),
      topology: normalizeTopology(safeRecord.topology || 'linear'),
      sequenceLength: safeRecord.sequence.length,
      featureCount: Array.isArray(safeRecord.features) ? safeRecord.features.length : 0,
      sequence: safeRecord.sequence,
      features: Array.isArray(safeRecord.features) ? safeRecord.features : [],
      gbkText,
      htmlText: buildCircularPreviewHtmlDocument(safeRecord),
      alignmentSessions: Array.isArray(persistOptions?.alignmentSessions) ? persistOptions.alignmentSessions : undefined
    });
    if (!response?.ok || !response?.entry) {
      throw new Error(response?.error || 'Failed to persist sequence entry.');
    }

    state.activeEntryId = cleanText(response.entry.id, 200);
    state.activeEntryStatus = String(response.entry.status || status).toLowerCase();
    if (Array.isArray(response.alignments)) {
      actions.setAlignmentSessions(response.alignments);
    }
    if (elements.saveNameInput) {
      elements.saveNameInput.value = response.entry.name || name;
    }
    return {
      ...response.entry,
      alignments: Array.isArray(response.alignments) ? response.alignments : []
    };
  }

  async function persistFeatureMutation(record, actionLabel) {
    if (!state.activeEntryId) {
      actions.setStatus(`${actionLabel} Save the record to persist changes.`);
      return;
    }
    try {
      const entry = await persistRecordToLibrary(record, {
        id: state.activeEntryId,
        status: state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
        name: elements.saveNameInput?.value || record.name || 'sequence'
      });
      await controllers.home?.refreshLibraryEntries({ selectedId: entry.id, filter: entry.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY, silent: true });
      actions.setStatus(`${actionLabel} Saved to ${entry.name}.`);
    } catch (error) {
      actions.setStatus(`${actionLabel} Changes remain local: ${error?.message || 'Failed to save.'}`, true);
    }
  }

  async function saveCurrentRecordAsSaved() {
    const record = actions.getSelectedRecord();
    if (!record?.sequence?.length) {
      actions.setStatus('Load a record before saving.', true);
      return;
    }
    try {
      const entry = await persistRecordToLibrary(record, {
        id: state.activeEntryId,
        status: LIBRARY_STATUS_SAVED,
        name: elements.saveNameInput?.value || record.name || 'sequence'
      });
      state.activeEntryId = cleanText(entry.id, 200);
      state.activeEntryStatus = LIBRARY_STATUS_SAVED;
      await controllers.home?.refreshLibraryEntries({ selectedId: entry.id, filter: entry.status || LIBRARY_STATUS_SAVED, silent: true });
      actions.setProteinBuilderConfirmation(null, { render: false });
      controllers.detail?.renderActiveRecord?.();
      actions.setStatus(`Saved sequence as ${entry.name}.`);
      controllers.home?.setHomeStatus(`Saved sequence entry: ${entry.name}.`);
    } catch (error) {
      actions.setStatus(error?.message || 'Failed to save sequence.', true);
    }
  }

  async function persistAlignmentSession(payload = {}) {
    const referenceRecord = payload?.referenceRecord;
    const session = payload?.session;
    const safeReferenceRecord = referenceRecord && typeof referenceRecord === 'object' ? referenceRecord : null;
    if (!safeReferenceRecord?.sequence?.length || !session || typeof session !== 'object') {
      return { session: null, sessions: Array.isArray(state.alignmentSessions) ? state.alignmentSessions : [] };
    }
    const scopedSession = {
      ...session,
      referenceRecordKey: buildSequenceSignature(safeReferenceRecord.sequence, 'ref'),
      referenceRecordName: normalizeRecordName(safeReferenceRecord.name || 'reference', 'reference')
    };
    if (!actions.hasStoragePath()) {
      const nextSessions = [scopedSession, ...(Array.isArray(state.alignmentSessions) ? state.alignmentSessions.filter((item) => String(item?.id || '') !== String(session?.id || '')) : [])];
      actions.setAlignmentSessions(nextSessions);
      return { session: scopedSession, sessions: nextSessions };
    }
    const entry = await persistAlignmentSessionToLibrary(safeReferenceRecord, scopedSession);
    const resolvedSessions = Array.isArray(entry.alignments) ? entry.alignments : [scopedSession];
    const resolvedSession = resolvedSessions.find((item) => String(item?.id || '') === String(scopedSession?.id || '')) || resolvedSessions[0] || scopedSession;
    return { session: resolvedSession, sessions: resolvedSessions };
  }

  async function persistAlignmentSessionToLibrary(referenceRecord, scopedSession) {
    let entryId = cleanText(state.activeEntryId, 200);
    if (!entryId) {
      const entry = await persistRecordToLibrary(referenceRecord, {
        status: LIBRARY_STATUS_TEMPORARY,
        name: elements.saveNameInput?.value || referenceRecord.name || 'sequence',
        alignmentSessions: []
      });
      entryId = cleanText(entry.id, 200);
      await controllers.home?.refreshLibraryEntries({ selectedId: entryId, filter: entry.status || LIBRARY_STATUS_TEMPORARY, silent: true });
    }
    const existingSessions = Array.isArray(state.alignmentSessions) ? state.alignmentSessions : [];
    const nextSessions = [scopedSession, ...existingSessions.filter((item) => String(item?.id || '') !== String(scopedSession?.id || ''))];
    const entry = await persistRecordToLibrary(referenceRecord, {
      id: entryId,
      status: state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
      name: elements.saveNameInput?.value || referenceRecord.name || 'sequence',
      alignmentSessions: nextSessions
    });
    await controllers.home?.refreshLibraryEntries({ selectedId: entry.id, filter: entry.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY, silent: true });
    return entry;
  }

  return {
    persistAlignmentSession,
    persistFeatureMutation,
    persistRecordToLibrary,
    saveCurrentRecordAsSaved
  };
}
