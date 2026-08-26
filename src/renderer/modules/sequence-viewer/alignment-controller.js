import { escapeHtml } from '../../lib/html.js';
import { alignSequenceToReference } from './alignment.js';
import {
  buildReferenceRecordKey,
  buildSessionName,
  clampIndex,
  cloneJson,
  coerceArrayBuffer,
  createEmptySourceState,
  describeSelectedRecord,
  parseAlignmentInput,
  upsertAlignmentSessionInList
} from './alignment-input.js';
import { getAlignmentSessionsForRecord } from './detail-alignment.js';
import { showTransientNotice } from '../../lib/notify.js';

function buildReferenceSignature(record) {
  if (!record?.sequence?.length) {
    return '';
  }
  return [
    buildReferenceRecordKey(record),
    String(record?.name || '').trim(),
    String(record?.topology || 'linear').trim(),
    String(record?.sourceFormat || 'external').trim()
  ].join('|');
}

export function resolveStoredAlignmentForReference(session, referenceRecord) {
  const safeSession = session && typeof session === 'object' ? session : null;
  const safeReference = referenceRecord && typeof referenceRecord === 'object' ? referenceRecord : null;
  const queryRecord = safeSession?.queryRecord && typeof safeSession.queryRecord === 'object'
    ? safeSession.queryRecord
    : null;
  const storedResult = safeSession?.result && typeof safeSession.result === 'object'
    ? safeSession.result
    : null;
  const referenceRecordKey = buildReferenceRecordKey(safeReference);
  const storedReferenceRecordKey = String(safeSession?.referenceRecordKey || '').trim();

  if (!safeSession || !safeReference?.sequence?.length || !queryRecord?.sequence?.length) {
    return {
      session: safeSession,
      result: storedResult,
      wasRealigned: false
    };
  }

  if (storedResult && storedReferenceRecordKey && storedReferenceRecordKey === referenceRecordKey) {
    return {
      session: safeSession,
      result: storedResult,
      wasRealigned: false
    };
  }

  const result = alignSequenceToReference(safeReference, queryRecord);
  return {
    session: {
      ...safeSession,
      referenceRecordKey,
      referenceRecordName: String(safeReference.name || '').trim() || 'reference',
      result
    },
    result,
    wasRealigned: true
  };
}

export function createSequenceViewerAlignmentController(config = {}) {
  const elements = config?.elements || {};
  const viewerState = config?.viewerState || {};
  const setStatus = typeof config?.setStatus === 'function' ? config.setStatus : () => {};
  const setLocalWorkspaceVisibility = typeof config?.setLocalWorkspaceVisibility === 'function'
    ? config.setLocalWorkspaceVisibility
    : () => {};
  const onNavigateDetail = typeof config?.onNavigateDetail === 'function' ? config.onNavigateDetail : null;
  const onAlignmentStateChange = typeof config?.onAlignmentStateChange === 'function'
    ? config.onAlignmentStateChange
    : () => {};
  const getSelectedReferenceRecord = typeof config?.getSelectedReferenceRecord === 'function'
    ? config.getSelectedReferenceRecord
    : () => null;
  const persistAlignmentSession = typeof config?.persistAlignmentSession === 'function'
    ? config.persistAlignmentSession
    : null;
  const readFileAsText = typeof config?.readFileAsText === 'function' ? config.readFileAsText : async () => '';
  const readFileAsArrayBuffer = typeof config?.readFileAsArrayBuffer === 'function'
    ? config.readFileAsArrayBuffer
    : async () => new ArrayBuffer(0);

  const state = {
    reference: createEmptySourceState('reference'),
    query: createEmptySourceState('query'),
    result: null,
    isRunning: false,
    statusMessage: 'Paste a sequence or choose a file to align against the current record.',
    statusIsError: false,
    queryMode: 'paste',
    referenceAutoLoaded: true,
    referenceSignature: ''
  };

  function getSelectedRecord(role) {
    const source = role === 'query' ? state.query : state.reference;
    if (!source.records.length) {
      return null;
    }
    const index = clampIndex(source.selectedRecordIndex, source.records.length);
    return source.records[index] || null;
  }

  function getSelectedStoredAlignments() {
    return getAlignmentSessionsForRecord(
      viewerState,
      getSelectedRecord('reference') || getSelectedReferenceRecord()
    );
  }

  function hasPendingPasteQuery() {
    return Boolean(String(elements.alignmentQueryTextarea?.value || '').trim());
  }

  function hasReadyInputs() {
    return Boolean(
      getSelectedRecord('reference')?.sequence?.length
      && (getSelectedRecord('query')?.sequence?.length || (state.queryMode === 'paste' && hasPendingPasteQuery()))
    );
  }

  function setAlignmentStatus(message, isError = false) {
    if (isError && message) {
      showTransientNotice(message, { type: 'error' });
    }
    state.statusMessage = String(message || '').trim() || 'Idle';
    state.statusIsError = isError === true;
    if (elements.alignmentStatus) {
      elements.alignmentStatus.textContent = state.statusMessage;
      elements.alignmentStatus.style.color = isError ? 'var(--theme-danger)' : '';
    }
  }

  function setQueryMode(mode) {
    state.queryMode = mode === 'file' ? 'file' : 'paste';
    if (elements.alignmentQueryModePasteBtn) {
      elements.alignmentQueryModePasteBtn.classList.toggle('sequence-viewer-mode-btn-active', state.queryMode === 'paste');
    }
    if (elements.alignmentQueryModeFileBtn) {
      elements.alignmentQueryModeFileBtn.classList.toggle('sequence-viewer-mode-btn-active', state.queryMode === 'file');
    }
    if (elements.alignmentQueryPastePanel) {
      elements.alignmentQueryPastePanel.hidden = state.queryMode !== 'paste';
    }
    if (elements.alignmentQueryFilePanel) {
      elements.alignmentQueryFilePanel.hidden = state.queryMode !== 'file';
    }
  }

  function applyAlignmentToViewer(session, options = {}) {
    const safeSession = session && typeof session === 'object' ? session : null;
    viewerState.activeAlignmentSessionId = String(safeSession?.id || '');
    viewerState.activeAlignmentSessionName = String(safeSession?.name || safeSession?.queryRecord?.name || '').trim();
    viewerState.activeAlignmentResult = safeSession?.result || null;
    viewerState.activeAlignmentQueryRecord = safeSession?.queryRecord || null;
    viewerState.alignmentViewEnabled = Boolean(safeSession?.result) && options?.enableView !== false;
    state.result = safeSession?.result || null;
    if (safeSession?.id) {
      state.query.sourceSessionId = String(safeSession.id).trim();
    }
    // Picking a session is a navigation, so the viewport may move to it. The
    // re-select that follows a sequence edit passes enableView: false and must
    // leave the reader where they were.
    onAlignmentStateChange({ preserveScroll: options?.enableView === false });
  }

  function clearAppliedAlignment() {
    viewerState.activeAlignmentSessionId = '';
    viewerState.activeAlignmentSessionName = '';
    viewerState.activeAlignmentResult = null;
    viewerState.activeAlignmentQueryRecord = null;
    viewerState.alignmentViewEnabled = false;
    // Nothing is left to scroll to, so hold position.
    onAlignmentStateChange({ preserveScroll: true });
  }

  function syncReferenceFromViewer(options = {}) {
    const record = getSelectedReferenceRecord();
    const nextSignature = buildReferenceSignature(record);

    if (!record?.sequence?.length) {
      if (options.force || state.referenceAutoLoaded) {
        state.reference = createEmptySourceState('reference');
        state.referenceAutoLoaded = true;
        state.referenceSignature = '';
        state.result = null;
      }
      return;
    }

    if (!options.force && !state.referenceAutoLoaded && state.reference.records.length) {
      return;
    }
    if (!options.force && state.referenceSignature === nextSignature) {
      return;
    }

    state.reference = {
      ...createEmptySourceState('reference'),
      fileName: 'Current reference',
      format: String(record.sourceFormat || 'external').trim() || 'external',
      records: [cloneJson(record, record)],
      selectedRecordIndex: 0,
      sourceKind: 'current_reference'
    };
    state.referenceAutoLoaded = true;
    state.referenceSignature = nextSignature;
    state.result = null;
    if (!options.silent) {
      setAlignmentStatus(`Reference ready: ${describeSelectedRecord(record)}`);
    }
  }

  function syncButtons() {
    if (elements.alignmentRunBtn) {
      elements.alignmentRunBtn.disabled = state.isRunning || !hasReadyInputs();
    }
    if (elements.alignmentResetBtn) {
      const hasAnyInput = state.query.records.length || state.result || hasPendingPasteQuery();
      elements.alignmentResetBtn.disabled = !hasAnyInput || state.isRunning;
    }
    if (elements.alignmentQueryRecordSelect) {
      elements.alignmentQueryRecordSelect.disabled = state.query.records.length < 2 || state.isRunning;
    }
  }

  function renderQuerySource() {
    if (elements.alignmentQueryFileName) {
      elements.alignmentQueryFileName.textContent = state.query.fileName || 'No query file selected';
    }

    if (elements.alignmentQuerySummary) {
      elements.alignmentQuerySummary.textContent = state.query.records.length
        ? describeSelectedRecord(getSelectedRecord('query'))
        : 'No query loaded.';
    }

    if (elements.alignmentQueryRecordWrap) {
      elements.alignmentQueryRecordWrap.hidden = state.query.records.length < 2;
    }
    if (elements.alignmentQueryRecordSelect) {
      if (state.query.records.length < 2) {
        elements.alignmentQueryRecordSelect.innerHTML = '<option value="0">Single record</option>';
      } else {
        elements.alignmentQueryRecordSelect.innerHTML = state.query.records
          .map((record, index) => `
            <option value="${index}"${index === clampIndex(state.query.selectedRecordIndex, state.query.records.length) ? ' selected' : ''}>
              ${escapeHtml(`${record.name} (${record.sequence.length.toLocaleString()} bp)`)}
            </option>
          `)
          .join('');
      }
    }

    if (elements.alignmentQueryStatus) {
      if (state.query.errors.length) {
        elements.alignmentQueryStatus.textContent = state.query.errors[0];
        showTransientNotice(state.query.errors[0], { type: 'error' });
        elements.alignmentQueryStatus.style.color = 'var(--theme-danger)';
      } else if (state.query.warnings.length) {
        elements.alignmentQueryStatus.textContent = state.query.warnings.join(' | ');
        elements.alignmentQueryStatus.style.color = '';
      } else if (state.query.records.length) {
        const sourceFormat = String(state.query.format || state.query.records[0]?.sourceFormat || 'unknown').toUpperCase();
        elements.alignmentQueryStatus.textContent = `Loaded ${state.query.records.length} ${sourceFormat} record${state.query.records.length === 1 ? '' : 's'}.`;
        elements.alignmentQueryStatus.style.color = '';
      } else {
        elements.alignmentQueryStatus.textContent = state.queryMode === 'paste'
          ? 'Paste a query sequence, then run alignment.'
          : 'Query parser idle.';
        elements.alignmentQueryStatus.style.color = '';
      }
    }
  }

  function render() {
    syncReferenceFromViewer({ silent: true });
    setQueryMode(state.queryMode);
    renderQuerySource();
    syncButtons();
    setAlignmentStatus(state.statusMessage, state.statusIsError);
  }

  function openSequencingAlignmentWorkspace() {
    syncReferenceFromViewer({ force: true });
    setLocalWorkspaceVisibility('alignment');
    if (onNavigateDetail) {
      onNavigateDetail();
    }
    setStatus('Opened sequencing alignment workspace.');
    render();
  }

  function closeSequencingAlignmentWorkspace(options = {}) {
    setLocalWorkspaceVisibility('detail');
    if (onNavigateDetail) {
      onNavigateDetail();
    }
    if (options.silent !== true) {
      setStatus('Returned to sequence detail.');
    }
  }

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

  function bindEvents() {
    elements.alignmentQueryChooseBtn?.addEventListener('click', () => {
      elements.alignmentQueryInput?.click?.();
    });

    elements.alignmentQueryModePasteBtn?.addEventListener('click', () => {
      setQueryMode('paste');
      render();
    });
    elements.alignmentQueryModeFileBtn?.addEventListener('click', () => {
      setQueryMode('file');
      render();
    });

    elements.alignmentQueryInput?.addEventListener('change', async () => {
      const file = elements.alignmentQueryInput.files?.[0];
      if (!file) {
        return;
      }
      try {
        await loadSequencingAlignmentQuery({
          file,
          name: file.name,
          sourceKind: 'file'
        });
      } finally {
        elements.alignmentQueryInput.value = '';
      }
    });

    elements.alignmentQueryTextarea?.addEventListener('input', () => {
      if (state.queryMode !== 'paste') {
        return;
      }
      state.query = createEmptySourceState('query');
      state.result = null;
      setAlignmentStatus('Pasted query ready. Click Run Alignment to parse and align.');
      render();
    });

    elements.alignmentQueryRecordSelect?.addEventListener('change', () => {
      state.query.selectedRecordIndex = clampIndex(
        Number(elements.alignmentQueryRecordSelect.value),
        state.query.records.length
      );
      state.result = null;
      setAlignmentStatus(`Selected query record: ${getSelectedRecord('query')?.name || '-'}`);
      render();
    });

    elements.alignmentRunBtn?.addEventListener('click', () => {
      void runSequencingAlignment();
    });

    elements.alignmentResetBtn?.addEventListener('click', () => {
      resetSequencingAlignment();
    });

    elements.alignmentCloseBtn?.addEventListener('click', () => {
      closeSequencingAlignmentWorkspace();
    });

    elements.alignmentWorkspace?.addEventListener('click', (event) => {
      if (event.target === elements.alignmentWorkspace) {
        closeSequencingAlignmentWorkspace();
      }
    });
  }

  return {
    bindEvents,
    render,
    openSequencingAlignmentWorkspace,
    closeSequencingAlignmentWorkspace,
    loadSequencingAlignmentReference,
    loadSequencingAlignmentQuery,
    runSequencingAlignment,
    resetSequencingAlignment,
    selectSavedAlignmentSession,
    handleReferenceRecordChanged
  };
}
