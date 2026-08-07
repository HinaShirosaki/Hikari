import { escapeHtml } from '../../lib/html.js';
import { DEFAULT_MAX_RECORDS } from './constants.js';
import { parseInputRecords } from './parsing.js';
import { cleanText } from './shared.js';
import { attachMapHoverLabel } from './vector-builder/map-hover.js';
import { attachMapZoomGestures } from './vector-builder/map-zoom.js';
import { buildSequenceMapSvg } from './vector-builder/sequence-map.js';
import { bindFileDropTarget } from '../../lib/file-drop.js';
import { showTransientNotice } from '../../lib/notify.js';

export function createSequenceViewerHomeController(config = {}) {
  const rootDocument = config?.rootDocument || globalThis?.document || null;
  const elements = config?.elements || {};
  const state = config?.state || {};
  const libraryStatusSaved = config?.libraryStatusSaved || 'saved';
  const libraryStatusTemporary = config?.libraryStatusTemporary || 'temporary';
  const fileAccept = config?.fileAccept || '';

  const getBridge = config?.getBridge || (() => null);
  const getStoragePath = config?.getStoragePath || (() => '');
  const hasStoragePath = config?.hasStoragePath || (() => false);
  const setMode = config?.setMode || (() => {});
  const setInputComposerVisible = config?.setInputComposerVisible || (() => {});
  const setRecords = config?.setRecords || (() => {});
  const setStatus = config?.setStatus || (() => {});
  const readFileAsText = config?.readFileAsText || (async () => '');
  const readFileAsArrayBuffer = config?.readFileAsArrayBuffer || null;
  const pluginServices = config?.pluginServices || null;
  const hideFeatureContextMenu = config?.hideFeatureContextMenu || (() => {});
  const hideFeatureEditor = config?.hideFeatureEditor || (() => {});
  const onNavigateHome = typeof config?.onNavigateHome === 'function' ? config.onNavigateHome : null;
  const onNavigateDetail = typeof config?.onNavigateDetail === 'function' ? config.onNavigateDetail : null;
  const onClearAll = config?.onClearAll || (() => {});
  const onParsedRecordsOpened = config?.onParsedRecordsOpened || (async () => null);
  const onRenameLibraryEntry = config?.onRenameLibraryEntry || (async () => null);
  const onCreateLibraryFolder = config?.onCreateLibraryFolder || (async () => null);
  const onRenameLibraryFolder = config?.onRenameLibraryFolder || (async () => null);
  const onDeleteLibraryFolder = config?.onDeleteLibraryFolder || (async () => null);
  const onMoveLibraryEntry = config?.onMoveLibraryEntry || (async () => null);
  const onLibraryEntryLoaded = typeof config?.onLibraryEntryLoaded === 'function'
    ? config.onLibraryEntryLoaded
    : () => {};
  const libraryPreviewDelayMs = 320;
  let libraryPreviewTimer = null;
  let previewedEntryId = '';
  let libraryContextType = '';
  let libraryContextId = '';
  let draggedLibraryEntryId = '';
  let activeFolderDropTarget = null;

  function compactElementList(...items) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
  }

  function getLibraryListElements() {
    return compactElementList(elements.libraryList, elements.detailLibraryList);
  }

  function getLibrarySavedFilterButtons() {
    return compactElementList(elements.libraryFilterSavedBtn, elements.detailLibraryFilterSavedBtn);
  }

  function getLibraryTemporaryFilterButtons() {
    return compactElementList(elements.libraryFilterTemporaryBtn, elements.detailLibraryFilterTemporaryBtn);
  }

  function getLibraryContextMenus() {
    return compactElementList(elements.libraryContextMenu, elements.detailLibraryContextMenu);
  }

  function hideLibraryContextMenus() {
    getLibraryContextMenus().forEach((menu) => {
      menu.hidden = true;
    });
    libraryContextType = '';
    libraryContextId = '';
  }

  function showLibraryContextMenu(menu, contextType, contextId, event) {
    if (!menu) {
      return;
    }
    hideLibraryContextMenus();
    libraryContextType = contextType;
    libraryContextId = contextId;
    const visibleActions = contextType === 'entry'
      ? new Set(['new-folder', 'rename', 'move-entry'])
      : contextType === 'folder'
        ? new Set(['new-folder', 'rename-folder', 'delete-folder'])
        : new Set(['new-folder']);
    menu.querySelectorAll?.('[data-sequence-library-action]')?.forEach?.((button) => {
      button.hidden = !visibleActions.has(cleanText(button?.dataset?.sequenceLibraryAction, 40));
    });
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Number(event?.clientX) || 0)}px`;
    menu.style.top = `${Math.max(8, Number(event?.clientY) || 0)}px`;
  }

  async function renameLibraryEntryFromContextMenu() {
    const entryId = libraryContextType === 'entry' ? cleanText(libraryContextId, 200) : '';
    const entry = (Array.isArray(state.libraryEntries) ? state.libraryEntries : [])
      .find((item) => cleanText(item?.id, 200) === entryId);
    hideLibraryContextMenus();
    if (!entry) {
      return;
    }
    const promptFn = rootDocument?.defaultView?.prompt || globalThis?.prompt;
    if (typeof promptFn !== 'function') {
      setHomeStatus('Rename prompt unavailable.', true);
      return;
    }
    const requestedName = promptFn('Rename sequence', String(entry.name || 'sequence'));
    if (requestedName === null) {
      return;
    }
    const nextName = normalizePromptName(requestedName);
    if (!nextName) {
      setHomeStatus('Enter a sequence name.', true);
      return;
    }
    try {
      await onRenameLibraryEntry(entryId, nextName);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to rename sequence entry.', true);
    }
  }

  function normalizePromptName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  }

  function getPromptFunction() {
    return rootDocument?.defaultView?.prompt || globalThis?.prompt;
  }

  async function createLibraryFolderFromPrompt() {
    hideLibraryContextMenus();
    const promptFn = getPromptFunction();
    if (typeof promptFn !== 'function') {
      setHomeStatus('Folder prompt unavailable.', true);
      return;
    }
    const requestedName = promptFn('New sequence folder', 'New Folder');
    if (requestedName === null) {
      return;
    }
    const nextName = normalizePromptName(requestedName);
    if (!nextName) {
      setHomeStatus('Enter a folder name.', true);
      return;
    }
    try {
      const folder = await onCreateLibraryFolder(nextName);
      setHomeStatus(`Created folder: ${folder?.name || nextName}.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to create sequence folder.', true);
    }
  }

  async function renameLibraryFolderFromContextMenu() {
    const folderId = libraryContextType === 'folder' ? cleanText(libraryContextId, 200) : '';
    const folder = (Array.isArray(state.libraryFolders) ? state.libraryFolders : [])
      .find((item) => cleanText(item?.id, 200) === folderId);
    hideLibraryContextMenus();
    if (!folder) {
      return;
    }
    const promptFn = getPromptFunction();
    if (typeof promptFn !== 'function') {
      setHomeStatus('Folder prompt unavailable.', true);
      return;
    }
    const requestedName = promptFn('Rename sequence folder', String(folder.name || 'Folder'));
    if (requestedName === null) {
      return;
    }
    const nextName = normalizePromptName(requestedName);
    if (!nextName) {
      setHomeStatus('Enter a folder name.', true);
      return;
    }
    try {
      const renamed = await onRenameLibraryFolder(folderId, nextName);
      setHomeStatus(`Renamed folder to ${renamed?.name || nextName}.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to rename sequence folder.', true);
    }
  }

  async function deleteLibraryFolderFromContextMenu() {
    const folderId = libraryContextType === 'folder' ? cleanText(libraryContextId, 200) : '';
    const folder = (Array.isArray(state.libraryFolders) ? state.libraryFolders : [])
      .find((item) => cleanText(item?.id, 200) === folderId);
    hideLibraryContextMenus();
    if (!folder) {
      return;
    }
    const confirmFn = rootDocument?.defaultView?.confirm || globalThis?.confirm;
    if (typeof confirmFn === 'function' && !confirmFn(`Delete folder "${folder.name}"? Its sequences will become unfiled.`)) {
      return;
    }
    try {
      await onDeleteLibraryFolder(folderId);
      setHomeStatus(`Deleted folder ${folder.name}. Its sequences are now unfiled.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to delete sequence folder.', true);
    }
  }

  async function moveLibraryEntryFromContextMenu() {
    const entryId = libraryContextType === 'entry' ? cleanText(libraryContextId, 200) : '';
    const entry = (Array.isArray(state.libraryEntries) ? state.libraryEntries : [])
      .find((item) => cleanText(item?.id, 200) === entryId);
    const folders = Array.isArray(state.libraryFolders) ? state.libraryFolders : [];
    hideLibraryContextMenus();
    if (!entry) {
      return;
    }
    if (!folders.length) {
      setHomeStatus('Create a folder before moving sequences.', true);
      return;
    }
    const promptFn = getPromptFunction();
    if (typeof promptFn !== 'function') {
      setHomeStatus('Folder prompt unavailable.', true);
      return;
    }
    const currentFolder = folders.find((folder) => cleanText(folder?.id, 200) === cleanText(entry.folderId, 200));
    const requestedName = promptFn(
      `Move "${entry.name || 'sequence'}" to folder (${folders.map((folder) => folder.name).join(', ')}). Leave blank to remove from its folder.`,
      currentFolder?.name || ''
    );
    if (requestedName === null) {
      return;
    }
    const normalizedName = normalizePromptName(requestedName).toLowerCase();
    const folder = normalizedName
      ? folders.find((item) => String(item?.name || '').trim().toLowerCase() === normalizedName)
      : null;
    if (normalizedName && !folder) {
      setHomeStatus(`Folder "${normalizePromptName(requestedName)}" was not found.`, true);
      return;
    }
    await moveLibraryEntry(entryId, folder?.id || '');
  }

  async function moveLibraryEntry(entryId, folderId) {
    try {
      const moved = await onMoveLibraryEntry(entryId, folderId);
      const folder = (Array.isArray(state.libraryFolders) ? state.libraryFolders : [])
        .find((item) => cleanText(item?.id, 200) === cleanText(folderId, 200));
      setHomeStatus(folder
        ? `Moved ${moved?.name || 'sequence'} to ${folder.name}.`
        : `Moved ${moved?.name || 'sequence'} out of its folder.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to move sequence entry.', true);
    }
  }

  function clearLibraryPreviewTimer() {
    if (!libraryPreviewTimer) {
      return;
    }
    globalThis?.clearTimeout?.(libraryPreviewTimer);
    libraryPreviewTimer = null;
  }

  function setHomeStatus(message, isError = false) {
    if (isError && message) {
      showTransientNotice(message, { type: 'error' });
    }
    compactElementList(elements.homeStatusNote, elements.detailLibraryStatusNote).forEach((statusNode) => {
      statusNode.textContent = message;
      statusNode.style.color = isError ? 'var(--theme-danger)' : '';
    });
  }

  function setLocalWorkspaceVisibility(mode) {
    const next = mode === 'detail'
      ? 'detail'
      : mode === 'alignment'
        ? 'alignment'
        : mode === 'builder'
          ? 'builder'
          : mode === 'cloning'
            ? 'cloning'
            : mode === 'vector'
              ? 'vector'
              : 'home';
    state.localWorkspaceMode = next;
    rootDocument?.body?.classList?.toggle?.('sequence-viewer-fixed-scroll', next === 'builder' || next === 'alignment');
    if (elements.homeWorkspace) {
      elements.homeWorkspace.hidden = next !== 'home';
    }
    if (elements.proteinBuilderWorkspace) {
      elements.proteinBuilderWorkspace.hidden = next !== 'builder';
    }
    if (elements.detailWorkspace) {
      elements.detailWorkspace.hidden = next !== 'detail' && next !== 'alignment';
    }
    if (elements.cloningDesignWorkspace) {
      elements.cloningDesignWorkspace.hidden = next !== 'cloning';
    }
    if (elements.vectorBuilderWorkspace) {
      elements.vectorBuilderWorkspace.hidden = next !== 'vector';
    }
    if (elements.alignmentWorkspace) {
      elements.alignmentWorkspace.hidden = next !== 'alignment';
    }
  }

  function navigateToHome() {
    hideFeatureContextMenu();
    hideFeatureEditor();
    setLocalWorkspaceVisibility('home');
    if (onNavigateHome) {
      onNavigateHome();
    }
  }

  function navigateToDetail() {
    hideFeatureContextMenu();
    hideFeatureEditor();
    setLocalWorkspaceVisibility('detail');
    if (onNavigateDetail) {
      onNavigateDetail();
    }
  }

  function setLibraryFilter(status) {
    state.libraryFilter = status === libraryStatusTemporary ? libraryStatusTemporary : libraryStatusSaved;
    getLibrarySavedFilterButtons().forEach((button) => {
      button.classList.toggle(
        'sequence-viewer-library-switch-btn-active',
        state.libraryFilter === libraryStatusSaved
      );
    });
    getLibraryTemporaryFilterButtons().forEach((button) => {
      button.classList.toggle(
        'sequence-viewer-library-switch-btn-active',
        state.libraryFilter === libraryStatusTemporary
      );
    });
  }

  function syncHomeControlsState() {
    const hasStorage = hasStoragePath();
    getLibrarySavedFilterButtons().forEach((button) => {
      button.disabled = !hasStorage;
    });
    getLibraryTemporaryFilterButtons().forEach((button) => {
      button.disabled = !hasStorage;
    });
    if (elements.librarySearchInput) {
      elements.librarySearchInput.disabled = !hasStorage;
    }
  }

  const previewHover = attachMapHoverLabel({
    host: () => elements.previewHost,
    rootDocument
  });

  const previewZoom = attachMapZoomGestures({
    host: () => elements.previewHost,
    getZoom: () => state.previewZoom,
    setZoom: (value) => {
      state.previewZoom = value;
    }
  });

  // The preview is drawn straight from the entry's stored GenBank text as inline
  // SVG. No iframe, so it inherits the app theme and needs no height syncing,
  // and no preview document has to be generated or kept on disk.
  function renderPreview(record) {
    if (!elements.previewHost) {
      return;
    }
    if (!record?.sequence?.length) {
      elements.previewHost.innerHTML = '<p class="small-note">Select a sequence in the library to preview.</p>';
      return;
    }
    elements.previewHost.innerHTML = buildSequenceMapSvg(record, {
      features: Array.isArray(record.features) ? record.features : []
    });
    // Redrawing replaces the SVG, so the current zoom has to be re-applied.
    previewZoom.apply();
  }

  function renderLibraryList() {
    const libraryLists = getLibraryListElements();
    if (!libraryLists.length) {
      return;
    }

    const entries = Array.isArray(state.libraryEntries) ? state.libraryEntries : [];
    const folders = Array.isArray(state.libraryFolders) ? state.libraryFolders : [];
    if (!entries.length && !folders.length) {
      const noun = state.libraryFilter === libraryStatusSaved ? 'saved' : 'unsaved';
      libraryLists.forEach((libraryList) => {
        libraryList.innerHTML = `<p class="small-note">No ${noun} sequence entries.</p>`;
      });
      return;
    }

    const query = cleanText(state.librarySearchQuery, 200).toLowerCase();
    const matchingEntries = query
      ? entries.filter((entry) => String(entry?.name || '').toLowerCase().includes(query))
      : entries;
    const matchingFolders = query
      ? folders.filter((folder) => {
        const folderMatches = String(folder?.name || '').toLowerCase().includes(query);
        const childMatches = matchingEntries.some((entry) => cleanText(entry?.folderId, 200) === cleanText(folder?.id, 200));
        return folderMatches || childMatches;
      })
      : folders;
    const folderIds = new Set(folders.map((folder) => cleanText(folder?.id, 200)).filter(Boolean));
    const unfiledEntries = matchingEntries.filter((entry) => {
      const folderId = cleanText(entry?.folderId, 200);
      return !folderId || !folderIds.has(folderId);
    });
    if (!unfiledEntries.length && !matchingFolders.length) {
      libraryLists.forEach((libraryList) => {
        libraryList.innerHTML = `<p class="small-note">No sequences match "${escapeHtml(query)}".</p>`;
      });
      return;
    }

    const entryHtml = (entry) => {
      const active = cleanText(entry.id, 200) === cleanText(state.selectedLibraryEntryId, 200);
      return `
        <button
          type="button"
          class="sequence-viewer-library-item${active ? ' sequence-viewer-library-item-active' : ''}"
          data-sequence-entry-id="${escapeHtml(entry.id)}"
          draggable="true"
          title="${escapeHtml(entry.name || 'sequence')}"
        >
          <span class="sequence-viewer-library-item-name">${escapeHtml(entry.name || 'sequence')}</span>
        </button>
      `;
    };
    const html = [
      unfiledEntries.map(entryHtml).join(''),
      matchingFolders.map((folder) => {
        const folderId = cleanText(folder?.id, 200);
        const folderNameMatches = query && String(folder?.name || '').toLowerCase().includes(query);
        const folderEntries = entries.filter((entry) => cleanText(entry?.folderId, 200) === folderId);
        const visibleFolderEntries = query && !folderNameMatches
          ? matchingEntries.filter((entry) => cleanText(entry?.folderId, 200) === folderId)
          : folderEntries;
        const expanded = query ? true : isLibraryFolderExpanded(folderId);
        return `
          <div class="sequence-viewer-library-folder-group${expanded ? ' is-expanded' : ''}">
            <button
              type="button"
              class="sequence-viewer-library-folder-row${expanded ? ' is-expanded' : ''}"
              data-sequence-folder-id="${escapeHtml(folderId)}"
              data-sequence-folder-drop="${escapeHtml(folderId)}"
              aria-expanded="${expanded ? 'true' : 'false'}"
              title="${escapeHtml(folder.name || 'Folder')}"
            >
              <span class="sequence-viewer-library-folder-chevron" aria-hidden="true"></span>
              <span class="left-rail-folder-glyph sequence-viewer-library-folder-glyph" aria-hidden="true"></span>
              <span class="sequence-viewer-library-folder-name">${escapeHtml(folder.name || 'Folder')}</span>
              <span class="sequence-viewer-library-folder-count">${folderEntries.length}</span>
            </button>
            ${expanded ? `
              <div class="sequence-viewer-library-folder-children">
                ${visibleFolderEntries.length
                  ? visibleFolderEntries.map(entryHtml).join('')
                  : '<p class="sequence-viewer-library-folder-empty">No sequences.</p>'}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')
    ].join('');
    libraryLists.forEach((libraryList) => {
      libraryList.innerHTML = html;
    });
  }

  function isLibraryFolderExpanded(folderId) {
    return (Array.isArray(state.expandedLibraryFolderIds) ? state.expandedLibraryFolderIds : [])
      .some((id) => cleanText(id, 200) === cleanText(folderId, 200));
  }

  function toggleLibraryFolder(folderId) {
    const safeFolderId = cleanText(folderId, 200);
    if (!safeFolderId) {
      return;
    }
    const expanded = new Set(Array.isArray(state.expandedLibraryFolderIds) ? state.expandedLibraryFolderIds : []);
    if (expanded.has(safeFolderId)) {
      expanded.delete(safeFolderId);
    } else {
      expanded.add(safeFolderId);
    }
    state.expandedLibraryFolderIds = [...expanded];
    renderLibraryList();
  }

  async function loadSelectedLibraryPreview() {
    const entryId = cleanText(state.selectedLibraryEntryId, 200);
    const storagePath = getStoragePath();
    // Start a newly previewed entry at fit, but leave the zoom alone when the
    // same entry is just being redrawn after a silent library refresh.
    if (entryId !== previewedEntryId) {
      previewedEntryId = entryId;
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
      setHomeStatus('Use New or Open to continue. Set Storage Folder Path in Settings to enable the saved/unsaved library.');
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
        status: state.libraryFilter
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
      if (!options.silent) {
        setHomeStatus(`Loaded ${entries.length} ${state.libraryFilter} sequence entr${entries.length === 1 ? 'y' : 'ies'}.`);
      }
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
      libraryPreviewTimer = null;
      if (options.navigateHome === true) {
        navigateToHome();
      }
      await setSelectedLibraryEntry(resolvedEntryId);
    };

    if (typeof globalThis?.setTimeout === 'function') {
      libraryPreviewTimer = globalThis.setTimeout(() => {
        void preview();
      }, libraryPreviewDelayMs);
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

  function fileExtension(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return match ? match[1].toLowerCase() : '';
  }

  // A service plugin may register a converter for a format the viewer cannot
  // parse natively (e.g. SnapGene .dna -> GenBank). If one is installed for
  // this file's extension, hand it the raw bytes and continue with the text it
  // returns; otherwise read the file as text as usual.
  async function readSequenceFileText(file) {
    const converter = pluginServices?.getConverter?.(fileExtension(file.name));
    if (!converter) {
      return readFileAsText(file);
    }
    if (typeof readFileAsArrayBuffer !== 'function') {
      throw new Error(`Cannot read .${converter.from} files in this environment.`);
    }
    setHomeStatus(`Converting ${file.name} with the ${converter.pluginId} service...`);
    const buffer = await readFileAsArrayBuffer(file);
    const { text } = await pluginServices.convert({
      extension: converter.from,
      filename: file.name,
      bytes: new Uint8Array(buffer)
    });
    return text;
  }

  async function openSequenceFileInDetail(file) {
    if (!file) {
      return;
    }

    try {
      setHomeStatus(`Reading ${file.name}...`);
      const text = await readSequenceFileText(file);
      const parsed = parseInputRecords(text, { maxRecords: DEFAULT_MAX_RECORDS });
      await openParsedRecordsInDetail(parsed, text, 'Loaded');
      setStatus(`Opened ${file.name} in detail workspace.`);
    } catch (error) {
      setHomeStatus(error?.message || 'Failed to open selected file.', true);
    }
  }

  function openNewSequenceDetail() {
    onClearAll();
    navigateToDetail();
    setMode('paste');
    setInputComposerVisible(true);
    setStatus('Paste sequence text, then click Load.');
    elements.inputTextarea?.focus?.();
    setHomeStatus('Opened a new sequence detail page.');
  }

  function openSequenceFilePicker(input = elements.homeOpenInput) {
    input?.click?.();
  }

  async function openSelectedSequenceFile(input) {
    const file = input?.files?.[0];
    await openSequenceFileInDetail(file);
    if (input) {
      input.value = '';
    }
  }

  function bindEvents() {
    previewZoom.bind();
    previewHover.bind();

    // Widen the picker to whatever installed service plugins can convert, so a
    // SnapGene .dna file is selectable alongside the native formats.
    const serviceAccept = pluginServices?.acceptExtensions?.() || '';
    const combinedAccept = [fileAccept, serviceAccept].filter(Boolean).join(',');
    if (elements.homeOpenInput && typeof elements.homeOpenInput.setAttribute === 'function') {
      elements.homeOpenInput.setAttribute('accept', combinedAccept);
    }
    if (elements.detailOpenInput && typeof elements.detailOpenInput.setAttribute === 'function') {
      elements.detailOpenInput.setAttribute('accept', combinedAccept);
    }

    elements.homePasteBtn?.addEventListener('click', () => {
      openNewSequenceDetail();
    });

    elements.homeOpenBtn?.addEventListener('click', () => {
      openSequenceFilePicker(elements.homeOpenInput);
    });

    elements.homeOpenInput?.addEventListener('change', async () => {
      await openSelectedSequenceFile(elements.homeOpenInput);
    });

    elements.detailNewBtn?.addEventListener('click', () => {
      openNewSequenceDetail();
    });

    elements.detailOpenBtn?.addEventListener('click', () => {
      openSequenceFilePicker(elements.detailOpenInput || elements.homeOpenInput);
    });

    elements.detailOpenInput?.addEventListener('change', async () => {
      await openSelectedSequenceFile(elements.detailOpenInput);
    });

    bindFileDropTarget({
      target: elements.homeWorkspace || elements.homeOpenBtn,
      accept: combinedAccept,
      onFiles: ([file]) => openSequenceFileInDetail(file),
      onRejected: () => {
        setHomeStatus('Drop a supported GBK, FASTA, FASTQ, or sequence text file.', true);
      },
      onError: (error) => {
        setHomeStatus(String(error?.message || error || 'Failed to open dropped sequence file.'), true);
      }
    });

    getLibrarySavedFilterButtons().forEach((button) => {
      button.addEventListener('click', () => {
        clearLibraryPreviewTimer();
        setLibraryFilter(libraryStatusSaved);
        void refreshLibraryEntries({ silent: true });
      });
    });

    getLibraryTemporaryFilterButtons().forEach((button) => {
      button.addEventListener('click', () => {
        clearLibraryPreviewTimer();
        setLibraryFilter(libraryStatusTemporary);
        void refreshLibraryEntries({ silent: true });
      });
    });

    const bindLibraryList = (libraryList, options = {}) => {
      if (!libraryList) {
        return;
      }
      libraryList.addEventListener('click', (event) => {
        const entryId = resolveLibraryEntryIdFromEvent(event);
        if (!entryId) {
          const folderId = resolveLibraryFolderIdFromEvent(event);
          if (folderId) {
            toggleLibraryFolder(folderId);
          }
          return;
        }
        if (Number.isFinite(Number(event?.detail)) && Number(event.detail) > 1) {
          return;
        }

        previewLibraryEntryFromList(entryId, {
          navigateHome: options.navigateHome === true
        });
      });

      libraryList.addEventListener('dblclick', (event) => {
        const entryId = resolveLibraryEntryIdFromEvent(event);
        if (!entryId) {
          return;
        }
        openLibraryEntryFromList(entryId);
      });

      libraryList.addEventListener('contextmenu', (event) => {
        const entryId = resolveLibraryEntryIdFromEvent(event);
        const folderId = entryId ? '' : resolveLibraryFolderIdFromEvent(event);
        event.preventDefault?.();
        clearLibraryPreviewTimer();
        if (entryId) {
          state.selectedLibraryEntryId = entryId;
          renderLibraryList();
          showLibraryContextMenu(options.contextMenu, 'entry', entryId, event);
          return;
        }
        showLibraryContextMenu(options.contextMenu, folderId ? 'folder' : 'library', folderId, event);
      });

      libraryList.addEventListener('dragstart', (event) => {
        const entryId = resolveLibraryEntryIdFromEvent(event);
        if (!entryId) {
          return;
        }
        draggedLibraryEntryId = entryId;
        const entryRow = event?.target?.closest?.('[data-sequence-entry-id]')
          || (event?.target?.dataset?.sequenceEntryId ? event.target : null);
        entryRow?.classList?.add?.('is-dragging');
        event?.dataTransfer?.setData?.('text/plain', entryId);
        if (event?.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
        }
      });

      libraryList.addEventListener('dragover', (event) => {
        const folderId = resolveLibraryFolderDropIdFromEvent(event);
        if (!draggedLibraryEntryId || !folderId) {
          return;
        }
        event.preventDefault?.();
        if (event?.dataTransfer) {
          event.dataTransfer.dropEffect = 'move';
        }
        const dropTarget = event?.target?.closest?.('[data-sequence-folder-drop]')
          || (event?.target?.dataset?.sequenceFolderDrop ? event.target : null);
        if (activeFolderDropTarget && activeFolderDropTarget !== dropTarget) {
          activeFolderDropTarget.classList?.remove?.('is-sequence-drop-target');
        }
        activeFolderDropTarget = dropTarget;
        activeFolderDropTarget?.classList?.add?.('is-sequence-drop-target');
      });

      libraryList.addEventListener('drop', (event) => {
        const folderId = resolveLibraryFolderDropIdFromEvent(event);
        const entryId = cleanText(draggedLibraryEntryId || event?.dataTransfer?.getData?.('text/plain'), 200);
        if (!entryId || !folderId) {
          return;
        }
        event.preventDefault?.();
        activeFolderDropTarget?.classList?.remove?.('is-sequence-drop-target');
        activeFolderDropTarget = null;
        draggedLibraryEntryId = '';
        void moveLibraryEntry(entryId, folderId);
      });

      libraryList.addEventListener('dragend', (event) => {
        const entryRow = event?.target?.closest?.('[data-sequence-entry-id]')
          || (event?.target?.dataset?.sequenceEntryId ? event.target : null);
        entryRow?.classList?.remove?.('is-dragging');
        activeFolderDropTarget?.classList?.remove?.('is-sequence-drop-target');
        activeFolderDropTarget = null;
        draggedLibraryEntryId = '';
      });
    };

    bindLibraryList(elements.libraryList, { contextMenu: elements.libraryContextMenu });
    bindLibraryList(elements.detailLibraryList, {
      contextMenu: elements.detailLibraryContextMenu,
      navigateHome: true
    });

    getLibraryContextMenus().forEach((menu) => {
      menu.addEventListener('click', (event) => {
        const action = cleanText(
          event?.target?.closest?.('[data-sequence-library-action]')?.dataset?.sequenceLibraryAction,
          40
        );
        if (action === 'rename') {
          void renameLibraryEntryFromContextMenu();
        } else if (action === 'new-folder') {
          void createLibraryFolderFromPrompt();
        } else if (action === 'rename-folder') {
          void renameLibraryFolderFromContextMenu();
        } else if (action === 'delete-folder') {
          void deleteLibraryFolderFromContextMenu();
        } else if (action === 'move-entry') {
          void moveLibraryEntryFromContextMenu();
        }
      });
    });

    rootDocument?.addEventListener?.('click', (event) => {
      if (!event?.target?.closest?.('.sequence-viewer-context-menu')) {
        hideLibraryContextMenus();
      }
    });
    rootDocument?.addEventListener?.('keydown', (event) => {
      if (String(event?.key || '') === 'Escape') {
        hideLibraryContextMenus();
      }
    });

    elements.librarySearchInput?.addEventListener('input', () => {
      state.librarySearchQuery = cleanText(elements.librarySearchInput.value, 200);
      renderLibraryList();
    });
  }

  return {
    bindEvents,
    navigateToHome,
    navigateToDetail,
    openNewSequenceDetail,
    openSequenceFileInDetail,
    openLibraryEntryInDetail,
    openParsedRecordsInDetail,
    refreshLibraryEntries,
    setHomeStatus,
    setLibraryFilter,
    setLocalWorkspaceVisibility,
    setSelectedLibraryEntry,
    syncHomeControlsState
  };
}
