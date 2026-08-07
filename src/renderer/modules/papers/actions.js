import {
  buildFolderKey,
  formatLinkedTarget,
  getLibraryFolders,
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
  buildPdfDataUrlFromBase64,
  decodeBase64Pdf,
  fileToBytes,
  normalizePdfBytePayload,
  openPdfDataUrl,
  parsePdfDataUrl,
  resolveStoredPaperPath
} from './storage.js';
import {
  normalizeMethodsExtract,
  normalizePaperSummary
} from './normalizers.js';
import { showTransientNotice } from '../../lib/notify.js';

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
      showTransientNotice('Set Storage Folder Path in Settings before uploading papers.', { type: 'error' });
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

    const pdfBytes = await fileToBytes(file);
    if (!pdfBytes?.byteLength) {
      showTransientNotice('Cannot read the selected PDF.', { type: 'error' });
      return null;
    }

    if (!windowRef?.hikariApi?.storeImportedFile) {
      showTransientNotice('Imported file storage API is unavailable.', { type: 'error' });
      return null;
    }

    let storedFile = null;
    try {
      const result = await windowRef.hikariApi.storeImportedFile({
        storagePath: rootPath,
        targetFolder: buildPaperStorageFolder({
          rootPath,
          linkedType,
          linkedName: linked.name
        }),
        fileName: file.name,
        dataBytes: pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
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
      showTransientNotice(String(error?.message || error || 'Failed to store uploaded PDF.'), { type: 'error' });
      return null;
    }

    const now = new Date().toISOString();
    const paperIntakeError = String(
      storedFile.paperIntakeError
        || storedFile.knowledgeDatabase?.paper_intake_error
        || ''
    ).trim();
    const paper = {
      id: createId(),
      title: elements.paperTitleInput?.value?.trim() || file.name.replace(/\.pdf$/i, ''),
      fileName: storedFile.fileName || file.name,
      pdfDataUrl: '',
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
      ingestionStatus: paperIntakeError ? 'error' : 'uploaded',
      ingestionUpdatedAt: now,
      ingestionErrors: paperIntakeError ? [paperIntakeError] : [],
      createdAt: now,
      updatedAt: now
    };

    updatePaperAvailability(paper);

    state.papers.push(paper);
    persist();
    libraryState.selectedFolderKey = buildFolderKey(paper.linkedType, paper.linkedId);
    context.library?.ensureFolderExpanded?.(libraryState.selectedFolderKey);
    context.render?.();
    // Intake failures are reported once per batch by uploadPaperFiles; they are
    // correlated (missing key, offline model), so alerting here would stack one
    // blocking modal per dropped PDF.
    return paper;
  }

  const MAX_LISTED_INTAKE_FAILURES = 5;

  function reportPaperIntakeFailures(papers = []) {
    const failed = papers.filter((paper) => paper?.ingestionStatus === 'error');
    if (!failed.length) {
      return;
    }
    const listed = failed.slice(0, MAX_LISTED_INTAKE_FAILURES).map((paper) => (
      `- ${paper.fileName}: ${paper.ingestionErrors?.[0] || 'Unknown intake error.'}`
    ));
    const remaining = failed.length - listed.length;
    showTransientNotice([
      `${failed.length} PDF${failed.length === 1 ? ' was' : 's were'} stored, but automatic paper intake failed:`,
      ...listed,
      ...(remaining > 0 ? [`- and ${remaining} more.`] : [])
    ].join('\n'), { type: 'error', durationMs: 12000 });
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
    reportPaperIntakeFailures(uploaded);
    return uploaded;
  }

  async function uploadAndViewPaperFile(file) {
    const uploaded = await uploadPaperFiles(file ? [file] : []);
    const paper = uploaded[0] || null;
    if (paper?.id) {
      await viewPaperPdf(paper.id);
    }
    return paper;
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
        pdfDataUrl: await resolvePaperPdfDataUrl(paper),
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
        pdfDataUrl: await resolvePaperPdfDataUrl(paper),
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
        pdfDataUrl: await resolvePaperPdfDataUrl(paper),
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
    if (candidatePath && windowRef?.hikariApi?.openFilePath) {
      const result = await windowRef.hikariApi.openFilePath(candidatePath);
      if (result?.ok) {
        return;
      }
    }

    if (openPdfDataUrl(paper.pdfDataUrl, windowRef)) {
      return;
    }

    showTransientNotice('Unable to open this PDF. Re-upload the paper to restore the local file path.', { type: 'error' });
  }

  async function resolvePaperPdfBytes(paper) {
    const candidatePath = resolveStoredPaperPath(paper, state.settings?.storagePath);
    if (candidatePath && windowRef?.hikariApi?.readFileBytes) {
      const result = await windowRef.hikariApi.readFileBytes(candidatePath);
      const bytes = normalizePdfBytePayload(result?.bytes);
      if (result?.ok && bytes?.byteLength) {
        return bytes;
      }
    }

    if (candidatePath && windowRef?.hikariApi?.readFileBase64) {
      const result = await windowRef.hikariApi.readFileBase64(candidatePath);
      const dataBase64 = String(result?.dataBase64 || '').trim();
      if (result?.ok && dataBase64) {
        return decodeBase64Pdf(dataBase64);
      }
    }

    const embeddedBase64 = parsePdfDataUrl(paper?.pdfDataUrl);
    if (embeddedBase64) {
      return decodeBase64Pdf(embeddedBase64);
    }

    throw new Error('Unable to load this PDF from app storage.');
  }

  async function resolvePaperPdfDataUrl(paper) {
    const embeddedBase64 = parsePdfDataUrl(paper?.pdfDataUrl);
    if (embeddedBase64) {
      return buildPdfDataUrlFromBase64(embeddedBase64);
    }

    const candidatePath = resolveStoredPaperPath(paper, state.settings?.storagePath);
    if (candidatePath && windowRef?.hikariApi?.readFileBase64) {
      const result = await windowRef.hikariApi.readFileBase64(candidatePath);
      const dataBase64 = String(result?.dataBase64 || '').trim();
      if (result?.ok && dataBase64) {
        return buildPdfDataUrlFromBase64(dataBase64);
      }
    }

    return '';
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
      context.renderCommentSidebar?.();
    } catch (error) {
      showTransientNotice(String(error?.message || error || 'Failed to load the PDF viewer.'), { type: 'error' });
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
    resolvePaperPdfDataUrl
  };
}
