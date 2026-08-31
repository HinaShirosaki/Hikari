import { buildFolderKey, updatePaperAvailability } from './model.js';
import { buildPaperStorageFolder, fileToBytes } from './storage.js';
import { showTransientNotice } from '../../lib/notify.js';

// Adding a PDF to the library: resolve the destination folder, copy the bytes
// into storage, and kick off the automatic intake pipeline.
function createPaperUploadActions({
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
} = {}) {
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

  return {
    startPaperAutoIngest,
    resolvePaperUploadTarget,
    uploadPaperFile,
    reportPaperIntakeFailures,
    uploadPaperFiles,
    uploadAndViewPaperFile
  };
}

export { createPaperUploadActions };
