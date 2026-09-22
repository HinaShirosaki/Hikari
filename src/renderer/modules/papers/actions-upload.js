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
        dataBytes: pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength)
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
      knowledgeMarkdownRelativePath: '',
      knowledgeExtractedTextRelativePath: '',
      knowledgeMetaRelativePath: '',
      knowledgeStatus: '',
      knowledgeGenerationMethod: '',
      deepReadReady: false,
      availabilityStatus: 'uploaded_pdf',
      ingestionStatus: 'running',
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

  // Intake reads the PDF, writes Markdown and figures, and asks a model for the
  // structured record - minutes of work on a real paper. It runs after the row
  // is already in the library so an upload never looks like it did nothing, and
  // failures are reported once per batch because they are correlated (missing
  // key, offline model) rather than per-file. 'running' drives the Processing
  // badge in the rail; a quit mid-intake is cleared on the next boot.
  async function runPaperIntake(papers = [], uploadTarget = null) {
    const rootPath = String(uploadTarget?.rootPath || state.settings?.storagePath || '').trim();
    if (!rootPath || typeof windowRef?.hikariApi?.transformStoredPaperPdf !== 'function') {
      return;
    }

    for (const uploaded of papers) {
      const result = await windowRef.hikariApi.transformStoredPaperPdf({
        storagePath: rootPath,
        filePath: uploaded.storedFilePath,
        relativePath: uploaded.storedRelativePath,
        paperTitle: uploaded.title,
        linkedType: uploaded.linkedType,
        linkedName: uploaded.linkedName
      }).catch((error) => ({ ok: false, error: String(error?.message || error) }));

      // The paper may have been deleted while intake was running.
      const paper = getPaperById(uploaded.id);
      if (!paper) {
        continue;
      }

      const intakeError = String(
        (result?.ok ? '' : result?.error)
          || result?.paperIntakeError
          || result?.knowledgeDatabase?.paper_intake_error
          || ''
      ).trim();
      paper.knowledgeMarkdownRelativePath = result?.knowledgeMarkdownRelativePath || '';
      paper.knowledgeExtractedTextRelativePath = result?.knowledgeExtractedTextRelativePath || '';
      paper.knowledgeMetaRelativePath = result?.knowledgeMetaRelativePath || '';
      paper.knowledgeStatus = result?.knowledgeStatus || '';
      paper.knowledgeGenerationMethod = result?.knowledgeDatabase?.wiki_generation_method || '';
      paper.ingestionStatus = intakeError ? 'error' : 'uploaded';
      paper.ingestionErrors = intakeError ? [intakeError] : [];
      paper.ingestionUpdatedAt = new Date().toISOString();
      updatePaperAvailability(paper);
      persist();
      context.render?.();
    }

    reportPaperIntakeFailures(papers.map((uploaded) => getPaperById(uploaded.id)).filter(Boolean));
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
    void runPaperIntake(uploaded, uploadTarget);
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
    runPaperIntake,
    reportPaperIntakeFailures,
    uploadPaperFiles,
    uploadAndViewPaperFile
  };
}

export { createPaperUploadActions };
