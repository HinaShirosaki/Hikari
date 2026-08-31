import { alignSequenceToReference } from './alignment.js';
import {
  buildReferenceRecordKey,
  buildSessionName,
  cloneJson,
  coerceArrayBuffer,
  createEmptySourceState,
  describeSelectedRecord,
  parseAlignmentInput,
  upsertAlignmentSessionInList
} from './alignment-input.js';
import { resolveStoredAlignmentForReference } from './alignment-session-match.js';

// Loading the reference/query sequences, running the alignment, persisting the
// finished session, and re-selecting a saved one.
function createAlignmentOperations({
  state,
  elements,
  viewerState,
  setStatus,
  persistAlignmentSession,
  readFileAsText,
  readFileAsArrayBuffer,
  getSelectedReferenceRecord,
  getSelectedRecord,
  getSelectedStoredAlignments,
  setAlignmentStatus,
  setQueryMode,
  applyAlignmentToViewer,
  clearAppliedAlignment,
  syncReferenceFromViewer,
  closeSequencingAlignmentWorkspace,
  render
} = {}) {
  async function loadSource(role, input) {
    const label = role === 'query' ? 'query' : 'reference';
    setAlignmentStatus(`Loading ${label} input...`);

    try {
      const parsed = await parseAlignmentInput(role, input, {
        readFileAsText,
        readFileAsArrayBuffer
      });
      const fileName = String(input?.name || input?.fileName || input?.file?.name || '').trim();
      const next = {
        role,
        fileName: fileName || (role === 'reference' ? 'Current reference' : `Loaded ${label}`),
        format: parsed.format,
        records: Array.isArray(parsed.records) ? parsed.records : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        errors: Array.isArray(parsed.errors) ? parsed.errors : [],
        selectedRecordIndex: 0,
        rawText: typeof parsed.rawText === 'string' ? parsed.rawText : '',
        rawBinary: coerceArrayBuffer(parsed.rawBinary),
        sourceKind: String(input?.sourceKind || (fileName ? 'file' : 'paste')).trim() || (fileName ? 'file' : 'paste'),
        originalFileName: fileName,
        sourceSessionId: String(input?.sourceSessionId || '').trim()
      };

      if (role === 'reference') {
        state.referenceAutoLoaded = false;
        state.referenceSignature = '';
      }

      state[role] = next;
      state.result = null;
      if (role === 'query') {
        setQueryMode(next.sourceKind === 'paste' ? 'paste' : 'file');
      }

      if (next.errors.length) {
        setAlignmentStatus(next.errors[0], true);
      } else if (!next.records.length) {
        setAlignmentStatus(`No ${label} records were loaded.`, true);
      } else {
        setAlignmentStatus(`Loaded ${label} input: ${describeSelectedRecord(next.records[0])}`);
        setStatus(`Loaded sequencing ${label} input.`);
      }
    } catch (error) {
      state[role] = {
        ...createEmptySourceState(role),
        fileName: String(input?.name || input?.fileName || input?.file?.name || '').trim()
      };
      state.result = null;
      setAlignmentStatus(error?.message || `Failed to load ${label} input.`, true);
    }

    render();
    return getSelectedRecord(role);
  }

  async function loadSequencingAlignmentReference(input) {
    return await loadSource('reference', input);
  }

  async function loadSequencingAlignmentQuery(input) {
    return await loadSource('query', input);
  }

  async function loadQueryFromPasteInput() {
    const rawText = String(elements.alignmentQueryTextarea?.value || '');
    return await loadSequencingAlignmentQuery({
      name: 'pasted_alignment_sequence.txt',
      text: rawText,
      rawText,
      sourceKind: 'paste'
    });
  }

  async function persistCompletedAlignment(referenceRecord, queryRecord, result) {
    if (typeof persistAlignmentSession !== 'function') {
      return {
        session: null,
        sessions: getSelectedStoredAlignments()
      };
    }

    const nextSession = {
      id: String(state.query.sourceSessionId || '').trim() || `alignment_local_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      name: buildSessionName(queryRecord, state.query),
      referenceRecordKey: buildReferenceRecordKey(referenceRecord),
      referenceRecordName: String(referenceRecord?.name || '').trim() || 'reference',
      sourceKind: state.query.sourceKind || (state.query.originalFileName ? 'file' : 'paste'),
      sourceFormat: String(queryRecord?.sourceFormat || state.query.format || 'unknown').trim() || 'unknown',
      originalFileName: state.query.originalFileName || state.query.fileName || '',
      queryRecord: cloneJson(queryRecord, queryRecord),
      result: cloneJson(result, result),
      rawText: state.query.rawText || '',
      rawBinary: coerceArrayBuffer(state.query.rawBinary)
    };

    const response = await persistAlignmentSession({
      referenceRecord,
      session: nextSession
    });
    return {
      session: response?.session || nextSession,
      sessions: Array.isArray(response?.sessions)
        ? response.sessions
        : upsertAlignmentSessionInList(getSelectedStoredAlignments(), nextSession)
    };
  }

  async function runSequencingAlignment() {
    if (state.queryMode === 'paste' && (state.query.sourceKind === 'paste' || !state.query.records.length)) {
      const currentPasteText = String(elements.alignmentQueryTextarea?.value || '');
      if (!state.query.records.length || currentPasteText !== state.query.rawText) {
        await loadQueryFromPasteInput();
      }
    }

    const referenceRecord = getSelectedRecord('reference');
    const queryRecord = getSelectedRecord('query');
    if (!referenceRecord?.sequence?.length || !queryRecord?.sequence?.length) {
      setAlignmentStatus('Load both a reference and a query before running the alignment.', true);
      render();
      return null;
    }

    state.isRunning = true;
    setAlignmentStatus('Running sequencing alignment...');
    render();

    try {
      state.result = alignSequenceToReference(referenceRecord, queryRecord);
      const persistence = await persistCompletedAlignment(referenceRecord, queryRecord, state.result);
      viewerState.alignmentSessions = Array.isArray(persistence.sessions)
        ? persistence.sessions
        : getSelectedStoredAlignments();

      const appliedSession = persistence.session
        ? {
          ...persistence.session,
          queryRecord: persistence.session.queryRecord || cloneJson(queryRecord, queryRecord),
          result: persistence.session.result || cloneJson(state.result, state.result)
        }
        : {
          id: '',
          name: buildSessionName(queryRecord, state.query),
          queryRecord: cloneJson(queryRecord, queryRecord),
          result: cloneJson(state.result, state.result)
        };
      state.query.sourceSessionId = String(appliedSession.id || '');
      applyAlignmentToViewer(appliedSession, { enableView: true });

      setAlignmentStatus(
        `Best ${state.result.orientation} alignment: ${state.result.identityPercent.toFixed(2)}% identity across ${state.result.queryCoveragePercent.toFixed(2)}% query coverage.`
      );
      setStatus(`Sequencing alignment complete for ${state.result.queryName}.`);
      closeSequencingAlignmentWorkspace({ silent: true });
    } catch (error) {
      state.result = null;
      setAlignmentStatus(error?.message || 'Sequencing alignment failed.', true);
    } finally {
      state.isRunning = false;
      render();
    }

    return state.result;
  }

  function resetSequencingAlignment() {
    syncReferenceFromViewer({ force: true, silent: true });
    state.query = createEmptySourceState('query');
    state.result = null;
    state.isRunning = false;
    state.statusMessage = 'Paste a sequence or choose a file to align against the current record.';
    state.statusIsError = false;
    if (elements.alignmentQueryInput) {
      elements.alignmentQueryInput.value = '';
    }
    if (elements.alignmentQueryTextarea) {
      elements.alignmentQueryTextarea.value = '';
    }
    render();
    setStatus('Cleared sequencing alignment query.');
  }

  function selectSavedAlignmentSession(sessionId, options = {}) {
    const session = getSelectedStoredAlignments().find((item) => String(item?.id || '') === String(sessionId || ''));
    if (!session) {
      state.result = null;
      clearAppliedAlignment();
      render();
      return null;
    }

    const referenceRecord = getSelectedRecord('reference') || getSelectedReferenceRecord();
    const resolved = resolveStoredAlignmentForReference(session, referenceRecord);
    const resolvedSession = resolved.session || session;
    const queryRecord = resolvedSession.queryRecord && typeof resolvedSession.queryRecord === 'object'
      ? cloneJson(resolvedSession.queryRecord, resolvedSession.queryRecord)
      : null;
    const result = resolved.result && typeof resolved.result === 'object'
      ? cloneJson(resolved.result, resolved.result)
      : null;

    if (resolved.wasRealigned) {
      viewerState.alignmentSessions = upsertAlignmentSessionInList(
        viewerState.alignmentSessions,
        resolvedSession
      );
    }

    state.result = result;
    state.query.sourceSessionId = String(resolvedSession.id || '').trim();

    if (options.populateQuery === true) {
      state.query = {
        ...createEmptySourceState('query'),
        fileName: String(session.originalFileName || session.name || 'Stored alignment').trim(),
        format: String(session.sourceFormat || queryRecord?.sourceFormat || 'unknown').trim() || 'unknown',
        records: queryRecord ? [queryRecord] : [],
        selectedRecordIndex: 0,
        rawText: typeof session.rawText === 'string' ? session.rawText : '',
        rawBinary: coerceArrayBuffer(session.rawBinary),
        sourceKind: String(session.sourceKind || 'file').trim() || 'file',
        originalFileName: String(session.originalFileName || '').trim(),
        sourceSessionId: String(session.id || '').trim()
      };
      if (state.query.sourceKind === 'paste' && elements.alignmentQueryTextarea) {
        elements.alignmentQueryTextarea.value = state.query.rawText || queryRecord?.sequence || '';
        setQueryMode('paste');
      } else {
        setQueryMode('file');
      }
    }

    applyAlignmentToViewer({
      ...resolvedSession,
      queryRecord: queryRecord || null,
      result
    }, { enableView: options.enableView !== false });

    if (options.silent !== true) {
      const sessionName = resolvedSession.name || queryRecord?.name || 'alignment';
      const status = resolved.wasRealigned
        ? `Re-aligned stored read ${sessionName} to the current reference.`
        : `Loaded stored alignment ${sessionName}.`;
      setAlignmentStatus(status);
      setStatus(status);
    }
    render();
    return {
      ...resolvedSession,
      queryRecord,
      result
    };
  }

  function handleReferenceRecordChanged() {
    syncReferenceFromViewer({ force: true, silent: true });
    state.query = createEmptySourceState('query');
    state.result = null;
    if (elements.alignmentQueryInput) {
      elements.alignmentQueryInput.value = '';
    }
    if (elements.alignmentQueryTextarea) {
      elements.alignmentQueryTextarea.value = '';
    }

    const nextSession = getSelectedStoredAlignments()[0] || null;
    if (nextSession?.id) {
      selectSavedAlignmentSession(nextSession.id, {
        enableView: false,
        silent: true
      });
    } else {
      clearAppliedAlignment();
    }
    render();
  }

  return {
    loadSource,
    loadSequencingAlignmentReference,
    loadSequencingAlignmentQuery,
    loadQueryFromPasteInput,
    persistCompletedAlignment,
    runSequencingAlignment,
    resetSequencingAlignment,
    selectSavedAlignmentSession,
    handleReferenceRecordChanged
  };
}

export { createAlignmentOperations };
