import { buildRecordGenbankText } from '../storage.js';
import { parseInputRecords } from '../parsing.js';
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
  const { state, actions, controllers } = ctx;

  // Every library write sends the record rendered as GenBank text (the .gbk
  // on disk is the durable copy) plus summary fields for the library index.
  // Entries are 'temporary' (auto-kept, e.g. opened files) until the user
  // explicitly saves them, which marks them 'saved'.
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
    const name = normalizeRecordName(persistOptions?.name || safeRecord.name || 'sequence', 'sequence');
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
    return {
      ...response.entry,
      alignments: Array.isArray(response.alignments) ? response.alignments : []
    };
  }

  // Feature edits autosave only for records already in the library; an
  // unsaved record keeps them in memory until the user saves.
  async function persistFeatureMutation(record, actionLabel, mutationOptions = {}) {
    if (!state.activeEntryId) {
      actions.setStatus(`${actionLabel} Save the record to persist changes.`);
      return;
    }
    try {
      const entry = await persistRecordToLibrary(record, {
        id: state.activeEntryId,
        status: state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
        name: record.name || 'sequence'
      });
      await controllers.home?.refreshLibraryEntries({ selectedId: entry.id, filter: entry.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY, silent: true });
      actions.setStatus(mutationOptions?.silentSuccess ? '' : `${actionLabel} Saved to ${entry.name}.`);
    } catch (error) {
      actions.setStatus(`${actionLabel} Changes remain local: ${error?.message || 'Failed to save.'}`, true);
    }
  }

  async function saveCurrentRecordToLibrary() {
    const record = actions.getSelectedRecord();
    if (!record?.sequence?.length) {
      actions.setStatus('Load a sequence before saving.', true);
      return;
    }
    try {
      const entry = await persistRecordToLibrary(record, {
        id: state.activeEntryId,
        status: LIBRARY_STATUS_SAVED,
        name: record.name || 'sequence'
      });
      await controllers.home?.refreshLibraryEntries({ selectedId: entry.id, filter: LIBRARY_STATUS_SAVED, silent: true });
      controllers.detail?.syncActionButtonsState?.();
      actions.setStatus(`Saved ${entry.name} to the library.`);
    } catch (error) {
      actions.setStatus(`Failed to save: ${error?.message || 'Unknown error.'}`, true);
    }
  }

  async function renameLibraryEntry(entryId, requestedName) {
    const bridge = actions.getBridge();
    const storagePath = actions.getStoragePath();
    const safeEntryId = cleanText(entryId, 200);
    const nextName = normalizeRecordName(requestedName, '');
    if (!storagePath || !safeEntryId || !nextName) {
      throw new Error('Enter a sequence name.');
    }
    if (!bridge?.sequenceLibraryGet || !bridge?.sequenceLibraryUpsert) {
      throw new Error('Sequence library storage API unavailable.');
    }

    const current = await bridge.sequenceLibraryGet({
      storagePath,
      id: safeEntryId,
      includeGbk: true,
      includeAlignments: true
    });
    if (!current?.ok || !current?.entry) {
      throw new Error(current?.error || 'Sequence entry not found.');
    }
    const parsed = parseInputRecords(String(current.gbkText || ''));
    const record = Array.isArray(parsed.records) ? parsed.records[0] : null;
    if (!record?.sequence?.length) {
      throw new Error(parsed?.errors?.[0] || 'Stored sequence entry contains no valid record.');
    }
    record.name = nextName;
    const response = await bridge.sequenceLibraryUpsert({
      storagePath,
      id: safeEntryId,
      name: nextName,
      status: current.entry.status,
      sourceFormat: record.sourceFormat || current.entry.sourceFormat,
      topology: normalizeTopology(record.topology || current.entry.topology || 'linear'),
      sequenceLength: record.sequence.length,
      featureCount: Array.isArray(record.features) ? record.features.length : 0,
      sequence: record.sequence,
      features: Array.isArray(record.features) ? record.features : [],
      gbkText: buildRecordGenbankText(record),
      alignmentSessions: Array.isArray(current.alignments) ? current.alignments : []
    });
    if (!response?.ok || !response?.entry) {
      throw new Error(response?.error || 'Failed to rename sequence entry.');
    }

    if (cleanText(state.activeEntryId, 200) === safeEntryId) {
      const activeRecord = actions.getSelectedRecord();
      if (activeRecord) {
        activeRecord.name = response.entry.name || nextName;
      }
      controllers.detail?.updateRecordSelect?.();
      controllers.detail?.renderActiveRecord?.();
    }
    await controllers.home?.refreshLibraryEntries({
      selectedId: safeEntryId,
      filter: response.entry.status || current.entry.status,
      silent: true
    });
    actions.setStatus(`Renamed sequence to ${response.entry.name}.`);
    return response.entry;
  }

  async function upsertLibraryFolder(folderId, requestedName) {
    const bridge = actions.getBridge();
    const storagePath = actions.getStoragePath();
    const safeFolderId = cleanText(folderId, 200);
    const nextName = normalizeRecordName(requestedName, '');
    if (!storagePath || !nextName) {
      throw new Error('Enter a folder name.');
    }
    if (!bridge?.sequenceLibraryUpsertFolder) {
      throw new Error('Sequence folder storage API unavailable.');
    }

    const response = await bridge.sequenceLibraryUpsertFolder({
      storagePath,
      id: safeFolderId,
      name: nextName
    });
    if (!response?.ok || !response?.folder) {
      throw new Error(response?.error || 'Failed to save sequence folder.');
    }
    await controllers.home?.refreshLibraryEntries({
      expandFolderId: response.folder.id,
      silent: true
    });
    return response.folder;
  }

  async function deleteLibraryFolder(folderId) {
    const bridge = actions.getBridge();
    const storagePath = actions.getStoragePath();
    const safeFolderId = cleanText(folderId, 200);
    if (!storagePath || !safeFolderId) {
      throw new Error('Sequence folder not found.');
    }
    if (!bridge?.sequenceLibraryDeleteFolder) {
      throw new Error('Sequence folder storage API unavailable.');
    }

    const response = await bridge.sequenceLibraryDeleteFolder({
      storagePath,
      id: safeFolderId
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to delete sequence folder.');
    }
    await controllers.home?.refreshLibraryEntries({ silent: true });
    return response;
  }

  async function moveLibraryEntryToFolder(entryId, folderId = '') {
    const bridge = actions.getBridge();
    const storagePath = actions.getStoragePath();
    const safeEntryId = cleanText(entryId, 200);
    const safeFolderId = cleanText(folderId, 200);
    if (!storagePath || !safeEntryId) {
      throw new Error('Sequence entry not found.');
    }
    if (!bridge?.sequenceLibraryMoveEntry) {
      throw new Error('Sequence folder storage API unavailable.');
    }

    const response = await bridge.sequenceLibraryMoveEntry({
      storagePath,
      id: safeEntryId,
      folderId: safeFolderId
    });
    if (!response?.ok || !response?.entry) {
      throw new Error(response?.error || 'Failed to move sequence entry.');
    }
    await controllers.home?.refreshLibraryEntries({
      selectedId: safeEntryId,
      expandFolderId: safeFolderId,
      silent: true
    });
    return response.entry;
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
        name: referenceRecord.name || 'sequence',
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
      name: referenceRecord.name || 'sequence',
      alignmentSessions: nextSessions
    });
    await controllers.home?.refreshLibraryEntries({ selectedId: entry.id, filter: entry.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY, silent: true });
    return entry;
  }

  return {
    deleteLibraryFolder,
    moveLibraryEntryToFolder,
    persistAlignmentSession,
    persistFeatureMutation,
    persistRecordToLibrary,
    renameLibraryEntry,
    saveCurrentRecordToLibrary,
    upsertLibraryFolder
  };
}
