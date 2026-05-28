import {
  buildFolderKey,
  formatLinkedTarget,
  updatePaperAvailability
} from './model.js';
import {
  requestSummary,
  requestStructuredFromPaper,
  getLlmPrompts,
  requirePrompt
} from './llm.js';
import {
  buildPaperStorageFolder,
  decodeBase64Pdf,
  extractBase64Payload,
  fileToDataUrl,
  openPdfDataUrl,
  parsePdfDataUrl,
  resolveStoredPaperPath
} from './storage.js';
import {
  normalizeMethodsExtract,
  normalizePaperSummary
} from './normalizers.js';

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

  async function startPaperAutoIngest(paperId) {
    const paper = getPaperById(paperId);
    if (!paper || paper.ingestionStatus === 'running') {
      return;
    }

    paper.ingestionStatus = 'running';
    paper.ingestionErrors = [];
    paper.ingestionUpdatedAt = new Date().toISOString();
    updatePaperAvailability(paper);
    persist();
    context.renderLibrarySidebar?.();

    await summarizePaper(paperId);
    await extractMethods(paperId);
    await extractReagents(paperId);

    const refreshed = getPaperById(paperId);
    if (!refreshed) {
      return;
    }

    const errors = [];
    if (refreshed.summaryStatus === 'error') {
      errors.push('summary_failed');
    }
    if (refreshed.methodsStatus === 'error') {
      errors.push('methods_failed');
    }
    if (refreshed.reagentsStatus === 'error') {
      errors.push('reagents_failed');
    }
    refreshed.ingestionErrors = errors;
    refreshed.ingestionStatus = errors.length ? 'error' : 'ready';
    refreshed.ingestionUpdatedAt = new Date().toISOString();
    updatePaperAvailability(refreshed);
    persist();
    context.renderLibrarySidebar?.();
  }

  function resolvePaperUploadTarget() {
    const options = context.library?.getCurrentLinkOptions?.() || [];
    const linkId = elements.paperLinkTargetSelect?.value;
    const linked = options.find((item) => item.id === linkId);

    if (!linkId || !linked) {
      return null;
    }

    const rootPath = String(state.settings?.storagePath || '').trim();
    if (!rootPath) {
      windowRef?.alert?.('Set Storage Folder Path in Settings before uploading papers.');
      return null;
    }

    return {
      rootPath,
      linkId,
      linked,
      linkedType: elements.paperLinkTypeSelect?.value
    };
  }

  async function uploadPaperFile(file, uploadTarget) {
    if (!file || !uploadTarget) {
      return null;
    }

    const {
      rootPath,
      linkId,
      linked,
      linkedType
    } = uploadTarget;

    const pdfDataUrl = await fileToDataUrl(file);
    const dataBase64 = extractBase64Payload(pdfDataUrl);
    if (!dataBase64) {
      windowRef?.alert?.('Cannot read the selected PDF.');
      return null;
    }

    if (!windowRef?.enanaApi?.storeImportedFile) {
      windowRef?.alert?.('Imported file storage API is unavailable.');
      return null;
    }

    let storedFile = null;
    try {
      const result = await windowRef.enanaApi.storeImportedFile({
        storagePath: rootPath,
        targetFolder: buildPaperStorageFolder({
          rootPath,
          linkedType,
          linkedName: linked.name
        }),
        fileName: file.name,
        dataBase64,
        transformPdfToMarkdown: true,
        paperTitle: elements.paperTitleInput?.value?.trim() || file.name.replace(/\.pdf$/i, ''),
        linkedType,
        linkedName: linked.name
      });
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to store uploaded PDF.');
      }
      storedFile = result;
    } catch (error) {
      windowRef?.alert?.(String(error?.message || error || 'Failed to store uploaded PDF.'));
      return null;
    }

    const now = new Date().toISOString();
    const paper = {
      id: createId(),
      title: elements.paperTitleInput?.value?.trim() || file.name.replace(/\.pdf$/i, ''),
      fileName: storedFile.fileName || file.name,
      pdfDataUrl,
      storedFilePath: storedFile.filePath || '',
      storedRelativePath: storedFile.relativePath || '',
      linkedType,
      linkedId: linkId,
      linkedName: linked.name,
      summary: '',
      summaryStructured: null,
      summaryStatus: 'idle',
      methodsExtract: [],
      methodsStatus: 'idle',
      keyReagents: [],
      reagentsStatus: 'idle',
      keyFigures: [],
      highlights: [],
      comments: [],
      knowledgeMarkdownRelativePath: storedFile.knowledgeMarkdownRelativePath || '',
      knowledgeExtractedTextRelativePath: storedFile.knowledgeExtractedTextRelativePath || '',
      knowledgeMetaRelativePath: storedFile.knowledgeMetaRelativePath || '',
      knowledgeStatus: storedFile.knowledgeStatus || '',
      knowledgeGenerationMethod: storedFile.knowledgeDatabase?.wiki_generation_method || '',
      deepReadReady: false,
      availabilityStatus: 'uploaded_pdf',
      ingestionStatus: 'uploaded',
      ingestionUpdatedAt: now,
      ingestionErrors: [],
      createdAt: now,
      updatedAt: now
    };

    updatePaperAvailability(paper);

    state.papers.push(paper);
    persist();
    libraryState.selectedFolderKey = buildFolderKey(paper.linkedType, paper.linkedId);
    context.library?.ensureFolderExpanded?.(libraryState.selectedFolderKey);
    context.render?.();
    return paper;
  }

  async function uploadPaperFiles(files = []) {
    const selectedFiles = (Array.isArray(files) ? files : [files]).filter(Boolean);
    if (!selectedFiles.length) {
      return [];
    }

    const uploadTarget = resolvePaperUploadTarget();
    if (!uploadTarget) {
      return [];
    }

    const uploaded = [];
    for (const file of selectedFiles) {
      const paper = await uploadPaperFile(file, uploadTarget);
      if (paper) {
        uploaded.push(paper);
      }
    }
    elements.paperForm?.reset?.();
    context.render?.();
    return uploaded;
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

  async function summarizePaper(paperId) {
    const paper = getPaperById(paperId);
    if (!paper || paper.summaryStatus === 'running') {
      return;
    }

    paper.summaryStatus = 'running';
    paper.summary = 'Summarizing...';
    paper.summaryStructured = null;
    paper.updatedAt = new Date().toISOString();
    persist();
    context.renderLibrarySidebar?.();

    try {
      const prompts = await getLlmPrompts();
      const summary = await requestSummary({
        llm: state.settings?.llm,
        pdfDataUrl: paper.pdfDataUrl,
        fileName: paper.fileName,
        title: paper.title,
        prompts
      });
      const normalized = normalizePaperSummary(summary);
      paper.summary = normalized.summary;
      paper.summaryStructured = normalized.structured;
      paper.summaryStatus = 'idle';
    } catch (error) {
      paper.summary = `Failed to summarize: ${String(error?.message || error)}`;
      paper.summaryStructured = null;
      paper.summaryStatus = 'error';
    }

    paper.updatedAt = new Date().toISOString();
    updatePaperAvailability(paper);
    persist();
    context.renderLibrarySidebar?.();
  }

  async function extractMethods(paperId) {
    const paper = getPaperById(paperId);
    if (!paper || paper.methodsStatus === 'running') {
      return;
    }

    paper.methodsStatus = 'running';
    paper.updatedAt = new Date().toISOString();
    persist();
    context.renderLibrarySidebar?.();

    try {
      const prompts = await getLlmPrompts();
      const result = await requestStructuredFromPaper({
        llm: state.settings?.llm,
        pdfDataUrl: paper.pdfDataUrl,
        fileName: paper.fileName,
        title: paper.title,
        instruction: requirePrompt(prompts, 'extractMethods'),
        prompts,
        task: 'paper-methods-extraction'
      });

      paper.methodsExtract = normalizeMethodsExtract(result);
      paper.methodsStatus = 'idle';
    } catch {
      paper.methodsStatus = 'error';
      paper.methodsExtract = [];
    }

    paper.updatedAt = new Date().toISOString();
    updatePaperAvailability(paper);
    persist();
    context.renderLibrarySidebar?.();
  }

  async function extractReagents(paperId) {
    const paper = getPaperById(paperId);
    if (!paper || paper.reagentsStatus === 'running') {
      return;
    }

    paper.reagentsStatus = 'running';
    paper.updatedAt = new Date().toISOString();
    persist();
    context.renderLibrarySidebar?.();

    try {
      const prompts = await getLlmPrompts();
      const result = await requestStructuredFromPaper({
        llm: state.settings?.llm,
        pdfDataUrl: paper.pdfDataUrl,
        fileName: paper.fileName,
        title: paper.title,
        instruction: requirePrompt(prompts, 'extractReagents'),
        prompts,
        task: 'paper-reagents-extraction'
      });

      const reagents = Array.isArray(result?.reagents) ? result.reagents : [];
      paper.keyReagents = reagents.map((item) => ({
        name: String(item?.name || '').trim(),
        type: String(item?.type || 'other').trim(),
        identifier: String(item?.identifier || '').trim(),
        notes: String(item?.notes || '').trim(),
        citation: String(item?.citation || '').trim()
      })).filter((item) => item.name);
      paper.reagentsStatus = 'idle';
    } catch {
      paper.reagentsStatus = 'error';
      paper.keyReagents = [];
    }

    paper.updatedAt = new Date().toISOString();
    updatePaperAvailability(paper);
    persist();
    context.renderLibrarySidebar?.();
  }

  async function openPaperPdf(paperId) {
    const paper = getPaperById(paperId);
    if (!paper) {
      return;
    }

    const candidatePath = resolveStoredPaperPath(paper, state.settings?.storagePath);
    if (candidatePath && windowRef?.enanaApi?.openFilePath) {
      const result = await windowRef.enanaApi.openFilePath(candidatePath);
      if (result?.ok) {
        return;
      }
    }

    if (openPdfDataUrl(paper.pdfDataUrl, windowRef)) {
      return;
    }

    windowRef?.alert?.('Unable to open this PDF. Re-upload the paper to restore the local file path.');
  }

  async function resolvePaperPdfBytes(paper) {
    const embeddedBase64 = parsePdfDataUrl(paper?.pdfDataUrl);
    if (embeddedBase64) {
      return decodeBase64Pdf(embeddedBase64);
    }

    const candidatePath = resolveStoredPaperPath(paper, state.settings?.storagePath);
    if (candidatePath && windowRef?.enanaApi?.readFileBase64) {
      const result = await windowRef.enanaApi.readFileBase64(candidatePath);
      const dataBase64 = String(result?.dataBase64 || '').trim();
      if (result?.ok && dataBase64) {
        return decodeBase64Pdf(dataBase64);
      }
    }

    throw new Error('Unable to load this PDF from app storage.');
  }

  function buildPaperViewerSummary(paper) {
    const details = [
      String(paper?.fileName || '').trim(),
      formatLinkedTarget(paper),
      paper?.updatedAt ? `Updated ${new Date(paper.updatedAt).toLocaleString()}` : ''
    ].filter(Boolean);
    return details.join(' | ');
  }

  async function viewPaperPdf(paperId) {
    const paper = getPaperById(paperId);
    if (!paper) {
      return;
    }

    try {
      libraryState.selectedFolderKey = buildFolderKey(paper.linkedType, paper.linkedId);
      context.library?.ensureFolderExpanded?.(libraryState.selectedFolderKey);
      context.comments?.primeForPaperOpen();
      const openPaperPromise = paperViewer.openPaper({
        paper,
        summary: buildPaperViewerSummary(paper),
        resolveBytes: resolvePaperPdfBytes,
        onOpenExternal: openPaperPdf
      });
      context.onActivePaperChanged?.(paper);
      context.renderLibrarySidebar?.(libraryState.selectedFolderKey);
      const opened = await openPaperPromise;
      if (!opened) {
        context.renderLibrarySidebar?.(libraryState.selectedFolderKey);
        return;
      }
      context.comments?.syncViewerComments();
      context.comments?.setCommentStatus('Viewing page 1. Select a comment or place a new pin.');
      context.renderCommentSidebar?.();
    } catch (error) {
      windowRef?.alert?.(String(error?.message || error || 'Failed to load the PDF viewer.'));
    }
  }

  function handleMethodToProtocol(paperId, methodIndex) {
    const paper = getPaperById(paperId);
    const method = paper?.methodsExtract?.[methodIndex];
    if (paper && method && typeof onCreateProtocolDraft === 'function') {
      onCreateProtocolDraft({ method, paper });
    }
  }

  function bindEvents() {
    elements.paperForm?.addEventListener('submit', onPaperSubmit);
  }

  return {
    bindEvents,
    startPaperAutoIngest,
    onPaperSubmit,
    uploadPaperFiles,
    deleteJournalClub,
    deletePaper,
    summarizePaper,
    extractMethods,
    extractReagents,
    openPaperPdf,
    viewPaperPdf,
    handleMethodToProtocol
  };
}
