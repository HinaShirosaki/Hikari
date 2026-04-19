import { escapeHtml } from '../tool-box/common.js';
import {
  DEFAULT_MAX_RECORDS,
  DEFAULT_SEQUENCE_LINE_LENGTH,
  FALLBACK_CHAR_ADVANCE_PX,
  FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
  DEFAULT_STRAND_MARKER_COLUMN_PX,
  DEFAULT_STRAND_COLUMN_GAP_PX,
  DEFAULT_RESTRICTION_VENDOR_FILTER
} from './constants.js';
import { normalizeExternalPayload, parseInputRecords } from './parsing.js';
import { buildSequenceSignature, cleanText, clamp, normalizeRecordName, normalizeTopology } from './shared.js';
import {
  buildCircularPreviewHtmlDocument,
  buildRecordGenbankText,
  readStoragePathFromLocalState
} from './storage.js';
import {
  normalizeOrfStopCodonVisibility
} from './translation-style.js';
import { getSequenceViewerElements } from './dom.js';
import { createSequenceViewerAnnotationController } from './annotation.js';
import { createSequenceViewerHomeController } from './home-controller.js';
import { createSequenceViewerDetailController } from './detail-controller.js';
import { createSequenceViewerAlignmentController } from './alignment-controller.js';
import { createSequenceViewerProteinBuilderController } from './protein-builder.js';

export function initSequenceViewer(options = {}) {
  const LIBRARY_STATUS_SAVED = 'saved';
  const LIBRARY_STATUS_TEMPORARY = 'temporary';
  const FEATURE_SOURCE_BACKBONE_RECOGNITION = 'backbone_recognition';
  const FILE_ACCEPT = '.gbk,.gb,.gbff,.fasta,.fa,.fas,.fna,.fastq,.fq,.txt,.seq';
  const rootDocument = options?.document || globalThis?.document || null;
  const elements = getSequenceViewerElements(rootDocument);

  const state = {
    mode: 'paste',
    fileName: '',
    fileText: '',
    records: [],
    selectedRecordIndex: 0,
    selectedFeatureIndex: -1,
    warnings: [],
    errors: [],
    isAnnotating: false,
    isRecognizingBackbone: false,
    orfViewEnabled: false,
    orfStopVisibility: normalizeOrfStopCodonVisibility({
      TAG: Boolean(elements.orfStopTagToggle?.checked),
      TAA: Boolean(elements.orfStopTaaToggle?.checked),
      TGA: Boolean(elements.orfStopTgaToggle?.checked)
    }),
    restrictionVendorFilter: {
      ...DEFAULT_RESTRICTION_VENDOR_FILTER
    },
    inputComposerVisible: true,
    libraryFilter: LIBRARY_STATUS_SAVED,
    libraryEntries: [],
    selectedLibraryEntryId: '',
    activeEntryId: '',
    activeEntryStatus: '',
    alignmentSessions: [],
    activeAlignmentSessionId: '',
    activeAlignmentSessionName: '',
    activeAlignmentResult: null,
    activeAlignmentQueryRecord: null,
    alignmentViewEnabled: false,
    featureSearchQuery: '',
    featureSearchResults: [],
    isSearchingFeatures: false,
    lastLibraryClickEntryId: '',
    lastLibraryClickAt: 0,
    sequenceSelectionAnchor: null,
    sequenceSelectionFocus: null,
    sequenceCursorBase: null,
    isSelectingSequence: false,
    sequenceLayout: {
      lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
      charAdvancePx: FALLBACK_CHAR_ADVANCE_PX,
      lineHeightPx: FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
      lineFeatureOffsetPx: DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX
    }
  };

  const onNavigateHome = typeof options?.onNavigateHome === 'function'
    ? options.onNavigateHome
    : null;
  const onNavigateDetail = typeof options?.onNavigateDetail === 'function'
    ? options.onNavigateDetail
    : null;

  function getBridge() {
    return options?.apiBridge
      || options?.bridge
      || globalThis?.window?.enanaApi
      || globalThis?.enanaApi
      || null;
  }

  function getStoragePath() {
    return String(options?.storagePath || '').trim() || readStoragePathFromLocalState();
  }

  function hasStoragePath() {
    return Boolean(getStoragePath());
  }

  function resetAlignmentState(options = {}) {
    const preserveSessions = options?.preserveSessions === true;
    if (!preserveSessions) {
      state.alignmentSessions = [];
    }
    state.activeAlignmentSessionId = '';
    state.activeAlignmentSessionName = '';
    state.activeAlignmentResult = null;
    state.activeAlignmentQueryRecord = null;
    state.alignmentViewEnabled = false;
  }

  function setAlignmentSessions(sessions) {
    state.alignmentSessions = Array.isArray(sessions) ? sessions : [];
    if (!state.activeAlignmentSessionId) {
      detailController?.syncAlignmentControlsState?.();
      return;
    }

    const activeSession = state.alignmentSessions.find((session) => String(session?.id || '') === String(state.activeAlignmentSessionId));
    if (!activeSession) {
      resetAlignmentState({ preserveSessions: true });
    } else {
      state.activeAlignmentSessionName = String(activeSession?.name || activeSession?.queryRecord?.name || '').trim();
      state.activeAlignmentResult = activeSession?.result || state.activeAlignmentResult;
      state.activeAlignmentQueryRecord = activeSession?.queryRecord || state.activeAlignmentQueryRecord;
    }
    detailController?.syncAlignmentControlsState?.();
  }

  function isBackboneRecognitionFeature(feature) {
    return String(feature?.source || '').toLowerCase() === FEATURE_SOURCE_BACKBONE_RECOGNITION;
  }

  function removeBackboneRecognitionFeatures(features) {
    return (Array.isArray(features) ? features : []).filter((feature) => !isBackboneRecognitionFeature(feature));
  }

  function buildBackboneRecognitionFeatureId(role, match) {
    const safeRole = cleanText(role, 32).toLowerCase() || 'feature';
    const safeHostId = cleanText(match?.hostVectorId, 120) || 'vector';
    return `${FEATURE_SOURCE_BACKBONE_RECOGNITION}_${safeRole}_${safeHostId}`;
  }

  function normalizeRecognitionSegments(segments, sequenceLength) {
    const safeLength = Math.max(0, Number(sequenceLength) || 0);
    return (Array.isArray(segments) ? segments : [])
      .map((segment) => {
        const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
        const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
        if (end <= start) {
          return null;
        }
        return { start, end };
      })
      .filter(Boolean);
  }

  function getRecognitionDisplayMatch(match) {
    const safeMatch = match && typeof match === 'object' ? match : null;
    if (!safeMatch) {
      return null;
    }

    const gibsonVariant = safeMatch.variants?.gibson;
    if (!gibsonVariant || typeof gibsonVariant !== 'object') {
      return safeMatch;
    }

    return {
      ...safeMatch,
      backboneLength: Math.max(0, Number(gibsonVariant.backboneLength) || 0),
      insertLength: Math.max(0, Number(gibsonVariant.insertLength) || 0),
      backboneSegments: Array.isArray(gibsonVariant.backboneSegments)
        ? gibsonVariant.backboneSegments
        : safeMatch.backboneSegments,
      insertSegments: Array.isArray(gibsonVariant.insertSegments)
        ? gibsonVariant.insertSegments
        : safeMatch.insertSegments
    };
  }

  function buildBackboneRecognitionFeatures(match, sequenceLength) {
    const safeMatch = getRecognitionDisplayMatch(match);
    if (!safeMatch) {
      return [];
    }

    const hostName = cleanText(safeMatch.hostVectorName, 140) || 'vector';
    const hostStatus = String(safeMatch.hostVectorStatus || '').toLowerCase() === LIBRARY_STATUS_SAVED
      ? 'saved'
      : 'temporary';
    const orientationText = safeMatch.orientation === 'reverse' ? 'reverse-complement' : 'forward';
    const hostCoveragePercent = Math.max(0, Number(safeMatch.hostCoverage) || 0) * 100;
    const backboneSegments = normalizeRecognitionSegments(safeMatch.backboneSegments, sequenceLength);
    const insertSegments = normalizeRecognitionSegments(safeMatch.insertSegments, sequenceLength);

    const features = [];
    if (backboneSegments.length) {
      features.push({
        id: buildBackboneRecognitionFeatureId('backbone', safeMatch),
        name: `Backbone (${hostName})`,
        type: 'backbone',
        strand: 1,
        source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
        description: `${hostName} ${hostStatus} vector recognized with ${Math.max(0, Number(safeMatch.backboneLength) || 0).toLocaleString()} bp exact backbone coverage (${hostCoveragePercent.toFixed(1)}% of host, ${orientationText} orientation).`,
        locationText: '',
        segments: backboneSegments
      });
    }

    if (insertSegments.length) {
      features.push({
        id: buildBackboneRecognitionFeatureId('insert', safeMatch),
        name: `Insert (${hostName})`,
        type: 'insert',
        strand: 1,
        source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
        description: `${Math.max(0, Number(safeMatch.insertLength) || 0).toLocaleString()} bp sequence not explained by stored vector ${hostName}.`,
        locationText: '',
        segments: insertSegments
      });
    }

    return features;
  }

  function setMode(mode) {
    const resolved = mode === 'file' ? 'file' : 'paste';
    state.mode = resolved;

    if (elements.modePasteBtn) {
      elements.modePasteBtn.classList.toggle('sequence-viewer-mode-btn-active', resolved === 'paste');
    }
    if (elements.modeFileBtn) {
      elements.modeFileBtn.classList.toggle('sequence-viewer-mode-btn-active', resolved === 'file');
    }
    if (elements.pastePanel) {
      elements.pastePanel.hidden = !state.inputComposerVisible || resolved !== 'paste';
    }
    if (elements.filePanel) {
      elements.filePanel.hidden = !state.inputComposerVisible || resolved !== 'file';
    }
  }

  function setInputComposerVisible(visible) {
    const shouldShow = visible !== false;
    state.inputComposerVisible = shouldShow;

    if (elements.modePasteBtn) {
      elements.modePasteBtn.hidden = !shouldShow;
    }
    if (elements.modeFileBtn) {
      elements.modeFileBtn.hidden = !shouldShow;
    }
    if (elements.loadBtn) {
      elements.loadBtn.hidden = !shouldShow;
    }
    if (elements.pastePanel) {
      elements.pastePanel.hidden = !shouldShow || state.mode !== 'paste';
    }
    if (elements.filePanel) {
      elements.filePanel.hidden = !shouldShow || state.mode !== 'file';
    }
  }

  function setStatus(message, isError = false) {
    if (!elements.statusNote) {
      return;
    }
    elements.statusNote.textContent = message;
    elements.statusNote.style.color = isError ? 'var(--danger)' : '';
  }

  function updateMessages() {
    if (!elements.messageBox) {
      return;
    }
    const rows = [
      ...state.errors.map((text) => `<p class="small-note" style="color:var(--danger);">${escapeHtml(text)}</p>`),
      ...state.warnings.map((text) => `<p class="small-note">${escapeHtml(text)}</p>`)
    ];

    elements.messageBox.innerHTML = rows.length
      ? rows.join('')
      : '<p class="small-note">No parser warnings.</p>';
  }

  function getSelectedRecord() {
    const index = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    return state.records[index] || null;
  }

  let homeController = null;
  let detailController = null;
  let annotationController = null;
  let alignmentController = null;
  let proteinBuilderController = null;

  function showProteinBuilderWorkspace() {
    detailController?.hideFeatureContextMenu();
    detailController?.hideFeatureEditor();
    homeController?.setLocalWorkspaceVisibility('builder');
    if (onNavigateHome) {
      onNavigateHome();
    }
  }

  function setRecords(result, statusPrefix = 'Loaded') {
    state.records = Array.isArray(result.records) ? result.records : [];
    state.warnings = Array.isArray(result.warnings) ? result.warnings : [];
    state.errors = Array.isArray(result.errors) ? result.errors : [];
    state.isAnnotating = false;
    state.isRecognizingBackbone = false;
    state.selectedRecordIndex = 0;
    state.selectedFeatureIndex = -1;
    resetAlignmentState();
    detailController?.clearSequenceSelection();
    detailController?.hideFeatureContextMenu();
    detailController?.hideFeatureEditor();

    detailController?.updateRecordSelect();
    detailController?.renderActiveRecord();
    proteinBuilderController?.render();
    if (elements.saveNameInput && state.records.length) {
      elements.saveNameInput.value = normalizeRecordName(state.records[0].name || 'sequence', 'sequence');
    }
    homeController?.syncHomeControlsState();

    if (state.records.length) {
      setStatus(`${statusPrefix}: ${state.records.length} record(s).`);
    } else {
      setStatus(state.errors[0] || 'No records loaded.', true);
    }
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected file.'));
      reader.readAsText(file);
    });
  }

  async function readFileAsArrayBuffer(file) {
    if (!file) {
      throw new Error('No file selected.');
    }
    if (typeof file.arrayBuffer === 'function') {
      return await file.arrayBuffer();
    }
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }
        reject(new Error('Failed to read selected file as binary data.'));
      };
      reader.onerror = () => reject(new Error('Failed to read selected file as binary data.'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function loadCurrentInput() {
    const raw = state.mode === 'file'
      ? state.fileText
      : (elements.inputTextarea?.value || '');

    if (!String(raw || '').trim()) {
      setRecords({ records: [], warnings: [], errors: ['Provide sequence input first.'] }, 'Idle');
      return;
    }

    const parsed = parseInputRecords(raw, { maxRecords: DEFAULT_MAX_RECORDS });
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    setRecords(parsed, 'Loaded');
    setInputComposerVisible(!(Array.isArray(parsed.records) && parsed.records.length > 0));
    await maybePersistImportedGenbankRecord(parsed);
  }

  async function persistRecordToLibrary(record, persistOptions = {}) {
    const bridge = getBridge();
    const storagePath = getStoragePath();
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

    const status = String(
      persistOptions?.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY
    ).toLowerCase() === LIBRARY_STATUS_SAVED
      ? LIBRARY_STATUS_SAVED
      : LIBRARY_STATUS_TEMPORARY;
    const name = normalizeRecordName(
      persistOptions?.name || elements.saveNameInput?.value || safeRecord.name || 'sequence',
      'sequence'
    );
    const gbkText = buildRecordGenbankText(safeRecord);
    if (!gbkText.trim()) {
      throw new Error('Failed to generate GenBank text for sequence entry.');
    }

    const htmlText = buildCircularPreviewHtmlDocument(safeRecord);
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
      htmlText,
      alignmentSessions: Array.isArray(persistOptions?.alignmentSessions)
        ? persistOptions.alignmentSessions
        : undefined
    });
    if (!response?.ok || !response?.entry) {
      throw new Error(response?.error || 'Failed to persist sequence entry.');
    }

    state.activeEntryId = cleanText(response.entry.id, 200);
    state.activeEntryStatus = String(response.entry.status || status).toLowerCase();
    if (Array.isArray(response.alignments)) {
      setAlignmentSessions(response.alignments);
    }
    if (elements.saveNameInput) {
      elements.saveNameInput.value = response.entry.name || name;
    }
    return {
      ...response.entry,
      alignments: Array.isArray(response.alignments) ? response.alignments : []
    };
  }

  async function persistAlignmentSession(payload = {}) {
    const referenceRecord = payload?.referenceRecord;
    const session = payload?.session;
    const safeReferenceRecord = referenceRecord && typeof referenceRecord === 'object' ? referenceRecord : null;
    if (!safeReferenceRecord?.sequence?.length || !session || typeof session !== 'object') {
      return {
        session: null,
        sessions: Array.isArray(state.alignmentSessions) ? state.alignmentSessions : []
      };
    }

    if (!hasStoragePath()) {
      const scopedSession = {
        ...session,
        referenceRecordKey: buildSequenceSignature(safeReferenceRecord.sequence, 'ref'),
        referenceRecordName: normalizeRecordName(safeReferenceRecord.name || 'reference', 'reference')
      };
      const nextSessions = [
        scopedSession,
        ...(Array.isArray(state.alignmentSessions) ? state.alignmentSessions.filter((item) => String(item?.id || '') !== String(session?.id || '')) : [])
      ];
      setAlignmentSessions(nextSessions);
      return {
        session: scopedSession,
        sessions: nextSessions
      };
    }

    let entryId = cleanText(state.activeEntryId, 200);
    if (!entryId) {
      const entry = await persistRecordToLibrary(safeReferenceRecord, {
        status: LIBRARY_STATUS_TEMPORARY,
        name: elements.saveNameInput?.value || safeReferenceRecord.name || 'sequence',
        alignmentSessions: []
      });
      entryId = cleanText(entry.id, 200);
      await homeController?.refreshLibraryEntries({
        selectedId: entryId,
        filter: entry.status || LIBRARY_STATUS_TEMPORARY,
        silent: true
      });
    }

    const scopedSession = {
      ...session,
      referenceRecordKey: buildSequenceSignature(safeReferenceRecord.sequence, 'ref'),
      referenceRecordName: normalizeRecordName(safeReferenceRecord.name || 'reference', 'reference')
    };
    const existingSessions = Array.isArray(state.alignmentSessions) ? state.alignmentSessions : [];
    const nextSessions = [
      scopedSession,
      ...existingSessions.filter((item) => String(item?.id || '') !== String(scopedSession?.id || ''))
    ];
    const entry = await persistRecordToLibrary(safeReferenceRecord, {
      id: entryId,
      status: state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
      name: elements.saveNameInput?.value || safeReferenceRecord.name || 'sequence',
      alignmentSessions: nextSessions
    });
    await homeController?.refreshLibraryEntries({
      selectedId: entry.id,
      filter: entry.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
      silent: true
    });

    const resolvedSessions = Array.isArray(entry.alignments) ? entry.alignments : nextSessions;
    const resolvedSession = resolvedSessions.find((item) => String(item?.id || '') === String(scopedSession?.id || ''))
      || resolvedSessions[0]
      || scopedSession;

    return {
      session: resolvedSession,
      sessions: resolvedSessions
    };
  }

  async function persistFeatureMutation(record, actionLabel) {
    if (!state.activeEntryId) {
      setStatus(`${actionLabel} Save the record to persist changes.`);
      return;
    }

    try {
      const entry = await persistRecordToLibrary(record, {
        id: state.activeEntryId,
        status: state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
        name: elements.saveNameInput?.value || record.name || 'sequence'
      });
      await homeController?.refreshLibraryEntries({
        selectedId: entry.id,
        filter: entry.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
        silent: true
      });
      setStatus(`${actionLabel} Saved to ${entry.name}.`);
    } catch (error) {
      setStatus(`${actionLabel} Changes remain local: ${error?.message || 'Failed to save.'}`, true);
    }
  }

  async function maybePersistImportedGenbankRecord(parsed) {
    const format = String(parsed?.format || '').toLowerCase();
    if (format !== 'genbank' || state.activeEntryId) {
      return null;
    }

    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    if (records.length !== 1) {
      return null;
    }

    const record = records[0];
    if (!record?.sequence?.length) {
      return null;
    }

    const storagePath = getStoragePath();
    const bridge = getBridge();
    if (!storagePath || !bridge?.sequenceLibraryUpsert) {
      return null;
    }

    try {
      const entry = await persistRecordToLibrary(record, {
        status: LIBRARY_STATUS_TEMPORARY,
        name: record.name || 'sequence'
      });
      await homeController?.refreshLibraryEntries({
        selectedId: entry.id,
        filter: entry.status || LIBRARY_STATUS_TEMPORARY,
        silent: true
      });
      return entry;
    } catch {
      return null;
    }
  }

  async function saveCurrentRecordAsSaved() {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before saving.', true);
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
      await homeController?.refreshLibraryEntries({
        selectedId: entry.id,
        filter: entry.status || LIBRARY_STATUS_SAVED,
        silent: true
      });
      setStatus(`Saved sequence as ${entry.name}.`);
      homeController?.setHomeStatus(`Saved sequence entry: ${entry.name}.`);
    } catch (error) {
      setStatus(error?.message || 'Failed to save sequence.', true);
    }
  }

  async function recognizeCurrentBackboneInsert() {
    if (state.isRecognizingBackbone) {
      return;
    }

    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before backbone recognition.', true);
      return;
    }

    const storagePath = getStoragePath();
    if (!storagePath) {
      setStatus('Set Storage Folder Path in Settings before recognizing vector backbone.', true);
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryRecognizeBackbone) {
      setStatus('Backbone recognition API unavailable.', true);
      return;
    }

    state.isRecognizingBackbone = true;
    detailController?.syncActionButtonsState();
    setStatus(`Recognizing vector backbone for ${record.name || 'record'}...`);

    try {
      const response = await bridge.sequenceLibraryRecognizeBackbone({
        storagePath,
        sequence: record.sequence,
        excludeEntryId: state.activeEntryId
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Backbone recognition failed.');
      }

      const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
      const nextRecords = [...state.records];
      const current = nextRecords[selectedIndex];
      if (!current) {
        throw new Error('Selected record no longer exists.');
      }

      const previousFeatures = Array.isArray(current.features) ? current.features : [];
      const retainedFeatures = removeBackboneRecognitionFeatures(previousFeatures);
      const hadRecognitionFeatures = retainedFeatures.length !== previousFeatures.length;
      const recognizedFeatures = buildBackboneRecognitionFeatures(response.match, current.sequence.length);

      current.features = [...retainedFeatures, ...recognizedFeatures];
      state.records = nextRecords;
      detailController?.clearSequenceSelection();
      detailController?.hideFeatureContextMenu();
      detailController?.hideFeatureEditor();

      if (!recognizedFeatures.length) {
        state.selectedFeatureIndex = -1;
        detailController?.renderActiveRecord();
        if (hadRecognitionFeatures && state.activeEntryId) {
          await persistFeatureMutation(current, 'Cleared auto-detected backbone/insert features.');
        }
        setStatus('No stored vector backbone matched this sequence.');
        return;
      }

      const preferredFeature = recognizedFeatures.find((feature) => feature.type === 'insert') || recognizedFeatures[0];
      state.selectedFeatureIndex = detailController?.findFeatureIndexByIdentity(
        detailController?.getVisibleFeaturesForRecord(current),
        preferredFeature
      ) ?? -1;

      detailController?.renderActiveRecord();

      const displayMatch = getRecognitionDisplayMatch(response.match);
      const matchedHostName = cleanText(displayMatch?.hostVectorName, 140) || 'vector';
      const insertLength = Math.max(0, Number(displayMatch?.insertLength) || 0);
      const summary = insertLength > 0
        ? `Recognized ${matchedHostName} backbone with a ${insertLength.toLocaleString()} bp insert.`
        : `Recognized ${matchedHostName} backbone.`;

      if (state.activeEntryId) {
        await persistFeatureMutation(current, `Recognized backbone ${matchedHostName}.`);
      } else {
        setStatus(`${summary} Save the record to persist changes.`);
      }
    } catch (error) {
      setStatus(error?.message || 'Backbone recognition failed.', true);
    } finally {
      state.isRecognizingBackbone = false;
      detailController?.syncActionButtonsState();
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
    setMode('paste');
    setInputComposerVisible(true);
    detailController?.hideFeatureContextMenu();
    detailController?.hideFeatureEditor();
    setRecords({ records: [], warnings: [], errors: [] }, 'Cleared');
    setStatus('Idle');
    if (elements.saveNameInput) {
      elements.saveNameInput.value = '';
    }
  }

  homeController = createSequenceViewerHomeController({
    rootDocument,
    elements,
    state,
    fileAccept: FILE_ACCEPT,
    libraryStatusSaved: LIBRARY_STATUS_SAVED,
    libraryStatusTemporary: LIBRARY_STATUS_TEMPORARY,
    getBridge,
    getStoragePath,
    hasStoragePath,
    getSelectedRecord,
    setMode,
    setInputComposerVisible,
    setRecords,
    setStatus,
    readFileAsText,
    onParsedRecordsOpened: maybePersistImportedGenbankRecord,
    onLibraryEntryLoaded: ({ alignments }) => {
      setAlignmentSessions(alignments);
      alignmentController?.handleReferenceRecordChanged?.();
    },
    hideFeatureContextMenu: () => detailController?.hideFeatureContextMenu(),
    hideFeatureEditor: () => detailController?.hideFeatureEditor(),
    onNavigateHome,
    onNavigateDetail,
    onClearAll: clearAll
  });

  detailController = createSequenceViewerDetailController({
    rootDocument,
    elements,
    state,
    getSelectedRecord,
    updateMessages,
    setStatus,
    hasStoragePath,
    persistFeatureMutation,
    onRequestAnnotate: () => annotationController?.annotateCurrentRecord?.(),
    onRequestRecognizeBackbone: recognizeCurrentBackboneInsert,
    onRequestClear: clearAll,
    onRequestSave: saveCurrentRecordAsSaved,
    onRequestAlignment: () => alignmentController?.openSequencingAlignmentWorkspace?.(),
    onSelectAlignmentSession: (sessionId) => alignmentController?.selectSavedAlignmentSession?.(sessionId, { enableView: true }),
    onNavigateHome: homeController.navigateToHome,
    onRefreshLibraryEntries: homeController.refreshLibraryEntries,
    onReferenceRecordChanged: () => {
      resetAlignmentState({ preserveSessions: true });
      alignmentController?.handleReferenceRecordChanged?.();
    }
  });

  annotationController = createSequenceViewerAnnotationController({
    state,
    getSelectedRecord,
    getStoragePath,
    getBridge,
    detailController,
    persistFeatureMutation,
    setStatus
  });

  alignmentController = createSequenceViewerAlignmentController({
    elements,
    viewerState: state,
    setStatus,
    setLocalWorkspaceVisibility: homeController.setLocalWorkspaceVisibility,
    onNavigateDetail,
    onAlignmentStateChange: () => detailController?.renderActiveRecord?.(),
    getSelectedReferenceRecord: getSelectedRecord,
    persistAlignmentSession,
    readFileAsText,
    readFileAsArrayBuffer
  });

  proteinBuilderController = createSequenceViewerProteinBuilderController({
    elements,
    getBridge,
    getStoragePath,
    hasStoragePath,
    setStatus,
    onNavigateHome: homeController.navigateToHome,
    onNavigateBuilder: showProteinBuilderWorkspace
  });

  function loadFromExternal(payload) {
    const record = normalizeExternalPayload(payload);
    const hasSequence = Boolean(record.sequence.length);

    setMode('paste');
    if (elements.inputTextarea) {
      elements.inputTextarea.value = record.sequence;
    }
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    if (elements.saveNameInput) {
      elements.saveNameInput.value = record.name || 'sequence';
    }

    setRecords({
      records: hasSequence ? [record] : [],
      warnings: hasSequence ? [] : ['External payload had no sequence.'],
      errors: hasSequence ? [] : ['Failed to load external payload.']
    }, 'Imported');
    setInputComposerVisible(!hasSequence);

    if (hasSequence) {
      homeController.navigateToDetail();
      setStatus(`Imported ${record.name} from ${record.sourceFormat || 'external'}.`);
    }
  }

  function render() {
    detailController.updateRecordSelect();
    detailController.renderActiveRecord();
    alignmentController?.render?.();
    proteinBuilderController?.render();
    homeController.syncHomeControlsState();
    void homeController.refreshLibraryEntries({ silent: true });
  }

  elements.modePasteBtn?.addEventListener('click', () => {
    setMode('paste');
  });

  elements.modeFileBtn?.addEventListener('click', () => {
    setMode('file');
  });

  elements.fileChooseBtn?.addEventListener('click', () => {
    elements.fileInput?.click();
  });

  elements.fileInput?.addEventListener('change', async () => {
    const file = elements.fileInput.files?.[0];
    if (!file) {
      return;
    }

    try {
      setStatus('Loading file...');
      state.fileText = await readFileAsText(file);
      state.fileName = String(file.name || '');
      if (elements.fileNameLabel) {
        elements.fileNameLabel.textContent = state.fileName || 'No file selected';
      }
      setStatus(`Loaded file: ${state.fileName || 'input'}`);
    } catch (error) {
      state.fileText = '';
      state.fileName = '';
      if (elements.fileNameLabel) {
        elements.fileNameLabel.textContent = 'No file selected';
      }
      setStatus(error.message || 'Failed to load file.', true);
    }
  });

  elements.loadBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void loadCurrentInput();
  });

  homeController.bindEvents();
  detailController.bindEvents();
  alignmentController?.bindEvents?.();
  proteinBuilderController?.bindEvents?.();

  homeController.setLibraryFilter(LIBRARY_STATUS_SAVED);
  homeController.setLocalWorkspaceVisibility('home');
  setMode('paste');
  setInputComposerVisible(true);
  setStatus('Paste sequence text, then click Load.');
  homeController.setHomeStatus('');
  render();

  return {
    render,
    loadFromExternal,
    openSequencingAlignmentWorkspace: () => alignmentController?.openSequencingAlignmentWorkspace?.(),
    closeSequencingAlignmentWorkspace: () => alignmentController?.closeSequencingAlignmentWorkspace?.(),
    loadSequencingAlignmentReference: async (input) => await alignmentController?.loadSequencingAlignmentReference?.(input),
    loadSequencingAlignmentQuery: async (input) => await alignmentController?.loadSequencingAlignmentQuery?.(input),
    runSequencingAlignment: async () => await alignmentController?.runSequencingAlignment?.()
  };
}
