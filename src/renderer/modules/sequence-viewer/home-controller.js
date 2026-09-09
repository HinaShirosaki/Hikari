import { cleanText } from './shared.js';
import { attachMapHoverLabel } from './vector-builder/map-hover.js';
import { attachMapZoomGestures } from './vector-builder/map-zoom.js';
import { bindFileDropTarget } from '../../lib/file-drop.js';
import { showTransientNotice } from '../../lib/notify.js';
import { createLibraryMenus } from './home/library-menus.js';
import { createLibraryOpen } from './home/library-open.js';
import { createLibraryRendering } from './home/library-rendering.js';
import { createHomeFileOpen } from './home/file-open.js';
import { createHomeNavigation } from './home/navigation.js';

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
  const getProjects = config?.getProjects || (() => []);
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
  let draggedLibraryEntryId = '';
  let activeFolderDropTarget = null;

  const {
    compactElementList,
    getLibraryListElements,
    getLibrarySavedFilterButtons,
    getLibraryTemporaryFilterButtons,
    getLibraryContextMenus,
    hideLibraryContextMenus,
    showLibraryContextMenu,
    beginLibraryRename,
    createLibraryFolderFromContextMenu,
    deleteLibraryFolderFromContextMenu,
    moveLibraryEntryFromContextMenu,
    moveLibraryEntry,
    getLibraryContextId
  } = createLibraryMenus({
    rootDocument,
    elements,
    state,
    setHomeStatus: (message, isError) => setHomeStatus(message, isError),
    renderLibraryList: () => renderLibraryList(),
    onRenameLibraryEntry,
    onCreateLibraryFolder,
    onRenameLibraryFolder,
    onDeleteLibraryFolder,
    onMoveLibraryEntry
  });


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
      statusNode.classList.toggle('is-error', Boolean(isError));
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

  // Held so the hover readout can resolve an arc back to its feature.
  let previewedRecord = null;
  const previewHover = attachMapHoverLabel({
    host: () => elements.previewHost,
    rootDocument,
    getFeature: (index) => (Array.isArray(previewedRecord?.features) ? previewedRecord.features[index] : null) || null,
    getSequence: () => previewedRecord?.sequence || ''
  });

  const previewZoom = attachMapZoomGestures({
    host: () => elements.previewHost,
    getZoom: () => state.previewZoom,
    setZoom: (value) => {
      state.previewZoom = value;
    }
  });



  const {
    setLocalWorkspaceVisibility,
    navigateToHome,
    navigateToDetail,
    setLibraryFilter
  } = createHomeNavigation({
    rootDocument,
    elements,
    state,
    libraryStatusSaved,
    libraryStatusTemporary,
    hideFeatureContextMenu,
    hideFeatureEditor,
    onNavigateHome,
    onNavigateDetail,
    getLibrarySavedFilterButtons,
    getLibraryTemporaryFilterButtons
  });

  const {
    renderPreview,
    renderLibraryList,
    toggleLibraryFolder
  } = createLibraryRendering({
    elements,
    state,
    libraryStatusSaved,
    previewZoom,
    setPreviewedRecord: (next) => { previewedRecord = next; },
    getLibraryListElements
  });

  const {
    refreshLibraryEntries,
    setSelectedLibraryEntry,
    resolveLibraryEntryIdFromEvent,
    resolveLibraryFolderIdFromEvent,
    resolveLibraryFolderDropIdFromEvent,
    openParsedRecordsInDetail,
    openLibraryEntryInDetail,
    previewLibraryEntryFromList,
    openLibraryEntryFromList
  } = createLibraryOpen({
    elements,
    state,
    libraryStatusSaved,
    libraryStatusTemporary,
    libraryPreviewDelayMs,
    getBridge,
    getStoragePath,
    getProjects,
    setMode,
    setRecords,
    setStatus,
    setInputComposerVisible,
    setHomeStatus: (message, isError) => setHomeStatus(message, isError),
    onParsedRecordsOpened,
    onLibraryEntryLoaded,
    clearLibraryPreviewTimer: () => clearLibraryPreviewTimer(),
    setLibraryPreviewTimer: (next) => { libraryPreviewTimer = next; },
    getPreviewedEntryId: () => previewedEntryId,
    setPreviewedEntryId: (next) => { previewedEntryId = next; },
    previewZoom,
    renderPreview: (record) => renderPreview(record),
    renderLibraryList: () => renderLibraryList(),
    syncHomeControlsState: () => syncHomeControlsState(),
    setLibraryFilter: (status) => setLibraryFilter(status),
    navigateToHome: () => navigateToHome(),
    navigateToDetail: () => navigateToDetail()
  });

  const {
    openSequenceFileInDetail,
    openNewSequenceDetail,
    openNewSequenceDialog,
    closeNewSequenceDialog,
    submitNewSequenceDialog,
    openSequenceFilePicker,
    openSelectedSequenceFile
  } = createHomeFileOpen({
    elements,
    pluginServices,
    readFileAsText,
    readFileAsArrayBuffer,
    onClearAll,
    setMode,
    setStatus,
    setInputComposerVisible,
    setHomeStatus: (message, isError) => setHomeStatus(message, isError),
    navigateToDetail: () => navigateToDetail(),
    openParsedRecordsInDetail: (parsed, rawText, statusPrefix) => openParsedRecordsInDetail(parsed, rawText, statusPrefix)
  });

  function bindEvents() {
    previewZoom.bind();
    previewHover.bind();
    if (elements.newSequenceOverlay) {
      elements.newSequenceOverlay.hidden = true;
    }

    // Widen the picker to whatever installed service plugins can convert, so a
    // .dna file is selectable alongside the native formats.
    const serviceAccept = pluginServices?.acceptExtensions?.() || '';
    const combinedAccept = [fileAccept, serviceAccept].filter(Boolean).join(',');
    if (elements.homeOpenInput && typeof elements.homeOpenInput.setAttribute === 'function') {
      elements.homeOpenInput.setAttribute('accept', combinedAccept);
    }
    if (elements.detailOpenInput && typeof elements.detailOpenInput.setAttribute === 'function') {
      elements.detailOpenInput.setAttribute('accept', combinedAccept);
    }

    elements.homePasteBtn?.addEventListener('click', () => {
      openNewSequenceDialog(elements.homePasteBtn);
    });

    elements.homeOpenBtn?.addEventListener('click', () => {
      openSequenceFilePicker(elements.homeOpenInput);
    });

    elements.homeOpenInput?.addEventListener('change', async () => {
      await openSelectedSequenceFile(elements.homeOpenInput);
    });

    elements.detailNewBtn?.addEventListener('click', () => {
      openNewSequenceDialog(elements.detailNewBtn);
    });

    elements.newSequenceForm?.addEventListener('submit', (event) => {
      event.preventDefault?.();
      void submitNewSequenceDialog();
    });

    elements.newSequenceCloseBtn?.addEventListener('click', () => {
      closeNewSequenceDialog();
    });

    elements.newSequenceCancelBtn?.addEventListener('click', () => {
      closeNewSequenceDialog();
    });

    elements.newSequenceOverlay?.addEventListener('click', (event) => {
      if (event.target === elements.newSequenceOverlay) {
        closeNewSequenceDialog();
      }
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

      // Entries keep double-click to open; folders have nothing else to do with
      // it, so it starts the rename there.
      libraryList.addEventListener('dblclick', (event) => {
        const entryId = resolveLibraryEntryIdFromEvent(event);
        if (entryId) {
          openLibraryEntryFromList(entryId);
          return;
        }
        const folderId = resolveLibraryFolderIdFromEvent(event);
        if (folderId) {
          event.preventDefault?.();
          beginLibraryRename('folder', folderId, libraryList);
        }
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
        const libraryList = menu === elements.detailLibraryContextMenu
          ? elements.detailLibraryList
          : elements.libraryList;
        if (action === 'rename') {
          beginLibraryRename('entry', getLibraryContextId(), libraryList);
        } else if (action === 'new-folder') {
          void createLibraryFolderFromContextMenu(libraryList);
        } else if (action === 'rename-folder') {
          beginLibraryRename('folder', getLibraryContextId(), libraryList);
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
        if (elements.newSequenceOverlay && !elements.newSequenceOverlay.hidden) {
          closeNewSequenceDialog();
        }
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
    openNewSequenceDialog,
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
