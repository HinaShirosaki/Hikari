import {
  buildFolderKey,
  getLibraryFolders,
  updatePaperAvailability
} from './model.js';
import {
  buildPaperStorageFolder,
  resolveStoredPaperPath
} from './storage.js';
import { showTransientNotice } from '../../lib/notify.js';
import { createPaperUploadActions } from './actions-upload.js';
import { createPaperAnalysisActions } from './actions-analysis.js';

export function createPapersActions(context) {
  const {
    state,
    persist,
    createId,
    onCreateProtocolDraft,
    paperViewer,
    window: windowRef,
    libraryState,
    elements
  } = context;

  function getPaperById(paperId) {
    return (state.papers || []).find((paper) => paper.id === paperId) || null;
  }

  function getPathFileName(value = '') {
    const parts = String(value || '').split(/[\\/]+/).filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  function getPaperFolderByKey(folderKey = '') {
    const normalizedKey = String(folderKey || '').trim();
    if (!normalizedKey) {
      return null;
    }
    return getLibraryFolders(state).find((folder) => folder.key === normalizedKey) || null;
  }


  async function movePaperToFolder(paperId, folderKey) {
    const paper = getPaperById(paperId);
    const targetFolder = getPaperFolderByKey(folderKey);
    if (!paper || !targetFolder) {
      return { ok: false, error: 'Paper or target folder was not found.' };
    }

    const targetFolderKey = buildFolderKey(targetFolder.type, targetFolder.id);
    if (buildFolderKey(paper.linkedType, paper.linkedId) === targetFolderKey) {
      return { ok: true, skipped: true, paper };
    }

    const rootPath = String(state.settings?.storagePath || '').trim();
    if (!rootPath) {
      showTransientNotice('Set Storage Folder Path in Settings before moving papers.', { type: 'error' });
      return { ok: false, error: 'Missing storage path.' };
    }
    if (typeof windowRef?.hikariApi?.moveStoredFile !== 'function') {
      showTransientNotice('Stored file move API is unavailable.', { type: 'error' });
      return { ok: false, error: 'Stored file move API is unavailable.' };
    }

    const sourcePath = resolveStoredPaperPath(paper, rootPath);
    if (!sourcePath) {
      showTransientNotice('This paper does not have a stored PDF file to move.', { type: 'error' });
      return { ok: false, error: 'Missing stored PDF path.' };
    }

    try {
      const result = await windowRef.hikariApi.moveStoredFile({
        storagePath: rootPath,
        sourcePath,
        sourceRelativePath: paper.storedRelativePath || '',
        targetFolder: buildPaperStorageFolder({
          rootPath,
          linkedType: targetFolder.type,
          linkedName: targetFolder.name
        }),
        fileName: paper.fileName || getPathFileName(sourcePath)
      });
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to move stored PDF.');
      }

      const now = new Date().toISOString();
      paper.linkedType = targetFolder.type;
      paper.linkedId = targetFolder.id;
      paper.linkedName = targetFolder.name;
      paper.fileName = result.fileName || paper.fileName || getPathFileName(sourcePath);
      paper.storedFilePath = result.filePath || '';
      paper.storedRelativePath = result.relativePath || paper.storedRelativePath || '';
      paper.updatedAt = now;
      updatePaperAvailability(paper);

      libraryState.selectedFolderKey = targetFolderKey;
      context.library?.ensureFolderExpanded?.(targetFolderKey);
      // The PDF has already moved on disk and undo cannot move it back; undoing
      // past this point would leave the stored paths pointing at the old
      // location. Drop history instead of corrupting the file references.
      persist({ barrier: true });
      context.render?.();
      context.onActivePaperChanged?.(context.getActivePaper?.() || null);
      return { ok: true, paper };
    } catch (error) {
      const message = String(error?.message || error || 'Failed to move stored PDF.');
      showTransientNotice(message, { type: 'error' });
      return { ok: false, error: message };
    }
  }

  async function onPaperSubmit(event) {
    event?.preventDefault?.();
    const file = elements.paperPdfInput?.files?.[0];
    await uploadPaperFiles(file ? [file] : []);
  }

  function deleteJournalClub(journalClubId) {
    state.journalClubs = (state.journalClubs || []).filter((item) => item.id !== journalClubId);
    state.papers = (state.papers || []).filter((paper) => !(paper.linkedType === 'journal-club' && paper.linkedId === journalClubId));
    if (paperViewer.getActivePaperId() && !context.getActivePaper?.()) {
      context.comments?.resetCommentComposer({
        message: ''
      });
      void paperViewer.resetViewer('The open paper was removed.');
    }
    persist();
    context.render?.();
  }

  function deletePaper(paperId) {
    state.papers = (state.papers || []).filter((item) => item.id !== paperId);
    state.paperExperimentLinks = (state.paperExperimentLinks || []).filter((item) => item.paperId !== paperId);
    if (paperViewer.getActivePaperId() === paperId) {
      context.comments?.resetCommentComposer({
        message: ''
      });
      void paperViewer.resetViewer('The open paper was deleted.');
    }
    persist();
    context.renderLibrarySidebar?.();
    context.renderCommentSidebar?.();
  }


  const {
    summarizePaper,
    extractMethods,
    extractReagents,
    openPaperPdf,
    resolvePaperPdfBytes,
    resolvePaperPdfDataUrl,
    saveFilledPaperPdf,
    viewPaperPdf,
    handleMethodToProtocol
  } = createPaperAnalysisActions({
    state,
    persist,
    createId,
    onCreateProtocolDraft,
    paperViewer,
    windowRef,
    libraryState,
    context,
    getPaperById
  });

  const {
    startPaperAutoIngest,
    uploadPaperFiles,
    uploadAndViewPaperFile
  } = createPaperUploadActions({
    state,
    persist,
    createId,
    windowRef,
    libraryState,
    elements,
    context,
    getPaperById,
    summarizePaper,
    extractMethods,
    extractReagents,
    viewPaperPdf
  });

  function bindEvents() {
    elements.paperForm?.addEventListener('submit', onPaperSubmit);
  }

  return {
    bindEvents,
    startPaperAutoIngest,
    onPaperSubmit,
    uploadPaperFiles,
    uploadAndViewPaperFile,
    movePaperToFolder,
    deleteJournalClub,
    deletePaper,
    summarizePaper,
    extractMethods,
    extractReagents,
    openPaperPdf,
    viewPaperPdf,
    handleMethodToProtocol,
    resolvePaperPdfBytes,
    resolvePaperPdfDataUrl,
    saveFilledPaperPdf
  };
}
