import { escapeHtml } from '../../lib/html.js';
import {
  clampIndex,
  cloneJson,
  createEmptySourceState,
  describeSelectedRecord
} from './alignment-input.js';
import { getAlignmentSessionsForRecord } from './detail-alignment.js';
import { showTransientNotice } from '../../lib/notify.js';
import { createAlignmentOperations } from './alignment-operations.js';
import { buildReferenceSignature } from './alignment-session-match.js';

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

  // Painting the stored status is separate from setting it: render() re-asserts
  // the current status on every pass, and only the set path may raise a notice —
  // otherwise a re-render would re-toast the same failure once the flag faded.
  function applyAlignmentStatus() {
    if (!elements.alignmentStatus) {
      return;
    }
    elements.alignmentStatus.textContent = state.statusMessage;
    elements.alignmentStatus.classList.toggle('is-error', Boolean(state.statusIsError));
  }

  function setAlignmentStatus(message, isError = false) {
    if (isError && message) {
      showTransientNotice(message, { type: 'error' });
    }
    state.statusMessage = String(message || '').trim() || 'Idle';
    state.statusIsError = isError === true;
    applyAlignmentStatus();
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
      } else if (state.query.warnings.length) {
        elements.alignmentQueryStatus.textContent = state.query.warnings.join(' | ');
      } else if (state.query.records.length) {
        const sourceFormat = String(state.query.format || state.query.records[0]?.sourceFormat || 'unknown').toUpperCase();
        elements.alignmentQueryStatus.textContent = `Loaded ${state.query.records.length} ${sourceFormat} record${state.query.records.length === 1 ? '' : 's'}.`;
      } else {
        elements.alignmentQueryStatus.textContent = state.queryMode === 'paste'
          ? 'Paste a query sequence, then run alignment.'
          : 'Query parser idle.';
      }
      elements.alignmentQueryStatus.classList.toggle('is-error', state.query.errors.length > 0);
    }
  }

  function render() {
    syncReferenceFromViewer({ silent: true });
    setQueryMode(state.queryMode);
    renderQuerySource();
    syncButtons();
    applyAlignmentStatus();
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


  const {
    loadSequencingAlignmentReference,
    loadSequencingAlignmentQuery,
    runSequencingAlignment,
    resetSequencingAlignment,
    selectSavedAlignmentSession,
    handleReferenceRecordChanged
  } = createAlignmentOperations({
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
    render: () => render()
  });

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

export { resolveStoredAlignmentForReference } from './alignment-session-match.js';
