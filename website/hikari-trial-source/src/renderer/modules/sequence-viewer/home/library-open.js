import { DEFAULT_MAX_RECORDS } from '../constants.js';
import { parseInputRecords } from '../parsing.js';
import { cleanText } from '../shared.js';

// Reading library entries from storage, previewing one on hover, and opening a
// record (or a dropped file's parse result) in the detail page.
function createLibraryOpen({
  elements,
  state,
  libraryStatusSaved,
  libraryStatusTemporary,
  libraryPreviewDelayMs,
  getBridge,
  getStoragePath,
  getProjects = () => [],
  setMode,
  setRecords,
  setStatus,
  setInputComposerVisible,
  setHomeStatus,
  onParsedRecordsOpened,
  onLibraryEntryLoaded,
  clearLibraryPreviewTimer,
  setLibraryPreviewTimer,
  getPreviewedEntryId,
  setPreviewedEntryId,
  previewZoom,
  renderPreview,
  renderLibraryList,
  syncHomeControlsState,
  setLibraryFilter,
  navigateToHome,
  navigateToDetail
} = {}) {
  async function loadSelectedLibraryPreview() {
    const entryId = cleanText(state.selectedLibraryEntryId, 200);
    const storagePath = getStoragePath();
    // Start a newly previewed entry at fit, but leave the zoom alone when the
    // same entry is just being redrawn after a silent library refresh.
    if (entryId !== getPreviewedEntryId()) {
      setPreviewedEntryId(entryId);
      previewZoom.reset();
    }
    if (!entryId || !storagePath) {
      renderPreview(null);
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryGet) {
      renderPreview(null);
      return;
    }

    try {
      const response = await bridge.sequenceLibraryGet({
        storagePath,
        id: entryId,
        includeGbk: true
      });
      if (!response?.ok || !response?.entry) {
        throw new Error(response?.error || 'Failed to load preview.');
      }
      const parsed = parseInputRecords(String(response.gbkText || ''));
      const record = Array.isArray(parsed?.records) ? parsed.records[0] : null;
      if (!record?.sequence?.length) {
        throw new Error(parsed?.errors?.[0] || 'Stored sequence entry contains no valid record.');
      }
      renderPreview({ ...record, name: cleanText(response.entry.name, 200) || record.name });
    } catch (error) {
      renderPreview(null);
      setHomeStatus(error?.message || 'Failed to load preview.', true);
    }
  }

  async function refreshLibraryEntries(options = {}) {
    const requestedFilter = cleanText(options.filter || options.status, 40);
    if (requestedFilter === libraryStatusSaved || requestedFilter === libraryStatusTemporary) {
      setLibraryFilter(requestedFilter);
    }

    const storagePath = getStoragePath();
    syncHomeControlsState();
    if (!storagePath) {
      state.libraryEntries = [];
      state.libraryFolders = [];
      state.expandedLibraryFolderIds = [];
      state.libraryFolderExpansionInitialized = false;
      state.libraryStoragePath = '';
      state.selectedLibraryEntryId = '';
      renderLibraryList();
      renderPreview(null);
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryList) {
      setHomeStatus('Sequence library storage API unavailable.', true);
      return;
    }

    try {
      const response = await bridge.sequenceLibraryList({
        storagePath,
        status: state.libraryFilter,
        // Main process mirrors these into rail folders and `Project/<Name>/Sequence`.
        projects: getProjects().map((project) => ({ id: project?.id, name: project?.name }))
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to list sequence entries.');
      }

      const entries = Array.isArray(response.entries) ? response.entries : [];
      const folders = Array.isArray(response.folders) ? response.folders : [];
      const storageChanged = cleanText(state.libraryStoragePath, 2000) !== cleanText(storagePath, 2000);
      if (storageChanged) {
        state.libraryStoragePath = storagePath;
        state.libraryFolderExpansionInitialized = false;
        state.expandedLibraryFolderIds = [];
      }
      state.libraryEntries = entries;
      state.libraryFolders = folders;

      const validFolderIds = new Set(folders.map((folder) => cleanText(folder?.id, 200)).filter(Boolean));
      const expanded = state.libraryFolderExpansionInitialized
        ? new Set((Array.isArray(state.expandedLibraryFolderIds) ? state.expandedLibraryFolderIds : [])
          .filter((folderId) => validFolderIds.has(cleanText(folderId, 200))))
        : new Set(validFolderIds);
      const requestedExpandedFolderId = cleanText(options.expandFolderId, 200);
      if (requestedExpandedFolderId && validFolderIds.has(requestedExpandedFolderId)) {
        expanded.add(requestedExpandedFolderId);
      }
      state.expandedLibraryFolderIds = [...expanded];
      state.libraryFolderExpansionInitialized = true;

      const preferred = cleanText(options.selectedId, 200) || cleanText(state.selectedLibraryEntryId, 200);
      const nextSelected = entries.some((entry) => cleanText(entry.id, 200) === preferred)
        ? preferred
        : (entries[0]?.id || '');
      state.selectedLibraryEntryId = cleanText(nextSelected, 200);

      renderLibraryList();
      await loadSelectedLibraryPreview();
    } catch (error) {
      state.libraryEntries = [];
      state.libraryFolders = [];
      state.selectedLibraryEntryId = '';
      renderLibraryList();
      renderPreview(null);
      setHomeStatus(error?.message || 'Failed to load sequence library.', true);
    }
  }

  async function setSelectedLibraryEntry(entryId) {
    state.selectedLibraryEntryId = cleanText(entryId, 200);
    renderLibraryList();
    await loadSelectedLibraryPreview();
  }

  function resolveLibraryEntryIdFromEvent(event) {
    return resolveLibraryDatasetIdFromEvent(event, 'sequenceEntryId', '[data-sequence-entry-id]');
  }

  function resolveLibraryFolderIdFromEvent(event) {
    return resolveLibraryDatasetIdFromEvent(event, 'sequenceFolderId', '[data-sequence-folder-id]');
  }

  function resolveLibraryFolderDropIdFromEvent(event) {
    return resolveLibraryDatasetIdFromEvent(event, 'sequenceFolderDrop', '[data-sequence-folder-drop]');
  }

  function resolveLibraryDatasetIdFromEvent(event, datasetKey, selector) {
    const target = event?.target;
    const direct = cleanText(target?.dataset?.[datasetKey], 200);
    if (direct) {
      return direct;
    }

    const viaClosest = cleanText(
      target?.closest?.(selector)?.dataset?.[datasetKey],
      200
    );
    if (viaClosest) {
      return viaClosest;
    }

    let cursor = target?.parentElement || target?.parentNode || null;
    while (cursor) {
      const resolved = cleanText(cursor?.dataset?.[datasetKey], 200);
      if (resolved) {
        return resolved;
      }
      cursor = cursor.parentElement || cursor.parentNode || null;
    }

    return '';
  }

  async function openParsedRecordsInDetail(parsed, rawText = '', statusPrefix = 'Loaded') {
    const hasRecords = Array.isArray(parsed?.records) && parsed.records.length > 0;
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    if (elements.inputTextarea) {
      elements.inputTextarea.value = rawText || '';
    }
    setMode('paste');
    setInputComposerVisible(!hasRecords);
    setRecords(parsed, statusPrefix);
    navigateToDetail();
    await onParsedRecordsOpened(parsed);
  }

  async function openLibraryEntryInDetail(entryId) {
    clearLibraryPreviewTimer();
    const storagePath = getStoragePath();
    if (!storagePath) {
      setHomeStatus('Set Storage Folder Path in Settings before opening library entries.', true);
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryGet) {
      setHomeStatus('Sequence library storage API unavailable.', true);
      return;
    }

    try {
      const response = await bridge.sequenceLibraryGet({
        storagePath,
        id: cleanText(entryId, 200),
        includeGbk: true,
        includeAlignments: true
      });
      if (!response?.ok || !response?.entry) {
        throw new Error(response?.error || 'Failed to load sequence entry.');
      }

      const parsed = parseInputRecords(String(response.gbkText || ''), { maxRecords: DEFAULT_MAX_RECORDS });
      if (!Array.isArray(parsed.records) || !parsed.records.length) {
        throw new Error(parsed?.errors?.[0] || 'Stored sequence entry contains no valid records.');
      }

      state.activeEntryId = cleanText(response.entry.id, 200);
      state.activeEntryStatus = String(response.entry.status || '').toLowerCase();
      parsed.records[0].name = response.entry.name || parsed.records[0].name || 'sequence';
      if (elements.inputTextarea) {
        elements.inputTextarea.value = String(response.gbkText || '');
      }
      setMode('paste');
      setInputComposerVisible(false);
      setRecords(parsed, 'Loaded');
      onLibraryEntryLoaded({
        entry: response.entry,
        alignments: Array.isArray(response.alignments) ? response.alignments : []
      });
      navigateToDetail();
      setStatus('');
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to open sequence entry.', true);
    }
  }

  function previewLibraryEntryFromList(entryId, options = {}) {
    const resolvedEntryId = cleanText(entryId, 200);
    if (!resolvedEntryId) {
      return;
    }
    clearLibraryPreviewTimer();
    const preview = async () => {
      setLibraryPreviewTimer(null);
      if (options.navigateHome === true) {
        navigateToHome();
      }
      await setSelectedLibraryEntry(resolvedEntryId);
    };

    if (typeof globalThis?.setTimeout === 'function') {
      setLibraryPreviewTimer(globalThis.setTimeout(() => {
        void preview();
      }, libraryPreviewDelayMs));
      return;
    }

    void preview();
  }

  function openLibraryEntryFromList(entryId) {
    const resolvedEntryId = cleanText(entryId, 200);
    if (!resolvedEntryId) {
      return;
    }
    clearLibraryPreviewTimer();
    void (async () => {
      await setSelectedLibraryEntry(resolvedEntryId);
      await openLibraryEntryInDetail(resolvedEntryId);
    })();
  }

  return {
    loadSelectedLibraryPreview,
    refreshLibraryEntries,
    setSelectedLibraryEntry,
    resolveLibraryEntryIdFromEvent,
    resolveLibraryFolderIdFromEvent,
    resolveLibraryFolderDropIdFromEvent,
    resolveLibraryDatasetIdFromEvent,
    openParsedRecordsInDetail,
    openLibraryEntryInDetail,
    previewLibraryEntryFromList,
    openLibraryEntryFromList
  };
}

export { createLibraryOpen };
