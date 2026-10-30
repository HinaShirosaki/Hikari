import { buildFolderKey } from './model.js';
import { bindFileDropTarget } from '../../lib/file-drop.js';
import { showTransientNotice } from '../../lib/notify.js';

// DOM wiring for the papers library rail: uploads, folder clicks and renames,
// paper drag-and-drop, and the view-activation observer.
function createLibraryEvents({
  documentRef,
  windowRef,
  elements,
  context,
  libraryState,
  paperDragState,
  PAPER_DRAG_MIME,
  getSelectedFolder,
  isFolderExpanded,
  setFolderExpanded,
  renderLibrarySidebar,
  schedulePapersEdgeBleedSync,
  folderMenu
} = {}) {
  const {
    getDraggedPaperId,
    getDropFolderTarget,
    canDropPaperOnFolder,
    clearPaperDropTarget,
    setPaperDropTarget,
    hideLibraryContextMenu,
    beginFolderRename,
    onGlobalKeydown,
    onLibraryContextMenu,
    onLibraryContextMenuClick,
    onCreateJournalClubFromMenuClick,
    onRenameJournalClubFromMenuClick,
    onDeleteJournalClubFromMenuClick
  } = folderMenu;

  function onUploadTriggerClick() {
    const selectedFolder = getSelectedFolder();
    if (!selectedFolder) {
      showTransientNotice('Create or select a folder before uploading a paper.', { type: 'error' });
      return;
    }
    if (elements.paperTitleInput) {
      elements.paperTitleInput.value = '';
    }
    elements.paperPdfInput?.click?.();
  }

  function onPaperFileChange() {
    if (!elements.paperPdfInput?.files?.length) {
      return;
    }
    if (typeof elements.paperForm?.requestSubmit === 'function') {
      elements.paperForm.requestSubmit();
      return;
    }
    context.actions?.onPaperSubmit({
      preventDefault() {}
    });
  }

  function onFolderListClick(event) {
    const toggleBtn = event.target?.closest?.('[data-folder-tree-toggle]');
    if (toggleBtn) {
      const folderKey = String(toggleBtn.dataset.folderTreeToggle || '').trim();
      if (folderKey) {
        setFolderExpanded(folderKey, !isFolderExpanded(folderKey));
        renderLibrarySidebar(libraryState.selectedFolderKey);
      }
      return;
    }

    const selectBtn = event.target?.closest?.('[data-folder-select]');
    if (!selectBtn) {
      return;
    }
    hideLibraryContextMenu();
    const folderKey = String(selectBtn.dataset.folderSelect || '').trim();
    libraryState.selectedFolderKey = folderKey;
    if (folderKey) {
      setFolderExpanded(folderKey, true);
    }
    renderLibrarySidebar(libraryState.selectedFolderKey);
  }

  function onPaperDragStart(event) {
    const paperTarget = event.target?.closest?.('[data-paper-drag]');
    const paperId = String(paperTarget?.dataset?.paperDrag || '').trim();
    if (!paperId) {
      return;
    }
    paperDragState.paperId = paperId;
    paperTarget?.classList?.add?.('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.dropEffect = 'move';
      event.dataTransfer.setData?.(PAPER_DRAG_MIME, paperId);
      event.dataTransfer.setData?.('text/plain', paperId);
    }
  }

  function onPaperDragEnd(event) {
    event.target?.closest?.('[data-paper-drag]')?.classList?.remove?.('is-dragging');
    paperDragState.paperId = '';
    clearPaperDropTarget();
  }

  function onPaperDragOver(event) {
    const folderTarget = getDropFolderTarget(event);
    const folderKey = String(folderTarget?.dataset?.folderDrop || '').trim();
    const paperId = getDraggedPaperId(event);
    if (!folderTarget || !canDropPaperOnFolder(paperId, folderKey)) {
      clearPaperDropTarget();
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setPaperDropTarget(folderTarget);
  }

  function onPaperDragLeave(event) {
    const folderTarget = getDropFolderTarget(event);
    if (folderTarget && folderTarget === paperDragState.activeDropTarget) {
      clearPaperDropTarget();
    }
  }

  function onPaperDrop(event) {
    const folderTarget = getDropFolderTarget(event);
    const folderKey = String(folderTarget?.dataset?.folderDrop || '').trim();
    const paperId = getDraggedPaperId(event);
    if (!folderTarget || !canDropPaperOnFolder(paperId, folderKey)) {
      clearPaperDropTarget();
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    clearPaperDropTarget();
    paperDragState.paperId = '';
    void context.actions?.movePaperToFolder?.(paperId, folderKey);
  }

  function onFolderListDoubleClick(event) {
    const selectBtn = event.target?.closest?.('[data-folder-select]');
    if (!selectBtn) {
      return;
    }
    event.preventDefault?.();
    beginFolderRename(String(selectBtn.dataset.folderSelect || '').trim());
  }

  function onPaperListClick(event) {
    const viewBtn = event.target?.closest?.('[data-paper-view]');
    if (viewBtn) {
      void context.actions?.viewPaperPdf(viewBtn.dataset.paperView);
      return;
    }

    const openBtn = event.target?.closest?.('[data-paper-open]');
    if (openBtn) {
      void context.actions?.openPaperPdf(openBtn.dataset.paperOpen);
      return;
    }

    const summarizeBtn = event.target?.closest?.('[data-paper-summarize]');
    if (summarizeBtn) {
      void context.actions?.summarizePaper(summarizeBtn.dataset.paperSummarize);
      return;
    }

    const deleteBtn = event.target?.closest?.('[data-paper-delete]');
    if (deleteBtn) {
      context.actions?.deletePaper(deleteBtn.dataset.paperDelete);
      return;
    }

    const extractMethodsBtn = event.target?.closest?.('[data-paper-extract-methods]');
    if (extractMethodsBtn) {
      void context.actions?.extractMethods(extractMethodsBtn.dataset.paperExtractMethods);
      return;
    }

    const extractReagentsBtn = event.target?.closest?.('[data-paper-extract-reagents]');
    if (extractReagentsBtn) {
      void context.actions?.extractReagents(extractReagentsBtn.dataset.paperExtractReagents);
      return;
    }

    const protocolBtn = event.target?.closest?.('[data-paper-method-to-protocol]');
    if (protocolBtn) {
      context.actions?.handleMethodToProtocol(protocolBtn.dataset.paperId, Number(protocolBtn.dataset.methodIndex));
    }
  }

  function renderLinkTargets() {
    renderLibrarySidebar(buildFolderKey(elements.paperLinkTypeSelect?.value, elements.paperLinkTargetSelect?.value));
  }

  function observeViewActivation() {
    if (!elements.papersView || typeof MutationObserver !== 'function') {
      return null;
    }
    const papersViewObserver = new MutationObserver(() => {
      if (elements.papersView.classList?.contains('is-active')) {
        schedulePapersEdgeBleedSync();
      }
    });
    papersViewObserver.observe(elements.papersView, {
      attributes: true,
      attributeFilter: ['class']
    });
    return papersViewObserver;
  }

  function bindEvents() {
    elements.paperLinkTypeSelect?.addEventListener('change', renderLinkTargets);
    elements.paperUploadTrigger?.addEventListener('click', onUploadTriggerClick);
    elements.paperPdfInput?.addEventListener('change', onPaperFileChange);
    elements.journalClubList?.addEventListener('click', onFolderListClick);
    elements.journalClubList?.addEventListener('dblclick', onFolderListDoubleClick);
    elements.journalClubList?.addEventListener('dragstart', onPaperDragStart);
    elements.journalClubList?.addEventListener('dragend', onPaperDragEnd);
    elements.journalClubList?.addEventListener('dragover', onPaperDragOver);
    elements.journalClubList?.addEventListener('dragleave', onPaperDragLeave);
    elements.journalClubList?.addEventListener('drop', onPaperDrop);
    elements.journalClubList?.addEventListener('click', onPaperListClick);
    elements.papersLibraryRail?.addEventListener('contextmenu', onLibraryContextMenu);
    elements.papersLibraryContextMenu?.addEventListener('click', onLibraryContextMenuClick);
    elements.paperList?.addEventListener('click', onPaperListClick);
    elements.papersContextNewFolderBtn?.addEventListener('click', onCreateJournalClubFromMenuClick);
    elements.papersContextRenameFolderBtn?.addEventListener('click', onRenameJournalClubFromMenuClick);
    elements.papersContextDeleteFolderBtn?.addEventListener('click', onDeleteJournalClubFromMenuClick);
    bindFileDropTarget({
      target: elements.papersLibraryRail || elements.journalClubList,
      accept: elements.paperPdfInput?.getAttribute?.('accept') || 'application/pdf,.pdf',
      multiple: true,
      onFiles: async (files) => {
        const selectedFolder = getSelectedFolder();
        if (!selectedFolder) {
          showTransientNotice('Create or select a folder before uploading a paper.', { type: 'error' });
          return;
        }
        await context.actions?.uploadPaperFiles?.(files);
      },
      onRejected: () => {
        showTransientNotice('Drop PDF files to add them to the selected paper folder.', { type: 'error' });
      },
      onError: (error) => {
        showTransientNotice(String(error?.message || error || 'Failed to upload dropped PDF files.'), { type: 'error' });
      }
    });
    if (typeof windowRef?.addEventListener === 'function') {
      windowRef.addEventListener('resize', schedulePapersEdgeBleedSync);
      windowRef.addEventListener('resize', hideLibraryContextMenu);
    }
    if (typeof documentRef?.addEventListener === 'function') {
      documentRef.addEventListener('click', hideLibraryContextMenu);
      documentRef.addEventListener('keydown', onGlobalKeydown);
    }
  }



  return {
    renderLinkTargets,
    bindEvents,
    observeViewActivation
  };
}

export { createLibraryEvents };
