import { buildFolderKey, formatLinkedTarget, updatePaperAvailability } from './model.js';
import {
  getLlmPrompts,
  requestStructuredFromPaper,
  requestSummary,
  requirePrompt
} from './llm.js';
import {
  buildPdfDataUrlFromBase64,
  decodeBase64Pdf,
  normalizePdfBytePayload,
  openPdfDataUrl,
  parsePdfDataUrl,
  resolveStoredPaperPath
} from './storage.js';
import { normalizeMethodsExtract, normalizePaperSummary } from './normalizers.js';
import { showTransientNotice } from '../../lib/notify.js';

// LLM-backed extraction (summary, methods, reagents) plus the PDF resolution
// the viewer and those calls share.
function createPaperAnalysisActions({
  state,
  persist,
  onCreateProtocolDraft,
  paperViewer,
  windowRef,
  libraryState,
  context,
  getPaperById
} = {}) {
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

  return {
    summarizePaper,
    extractMethods,
    extractReagents,
    openPaperPdf,
    resolvePaperPdfBytes,
    resolvePaperPdfDataUrl,
    buildPaperViewerSummary,
    viewPaperPdf,
    handleMethodToProtocol
  };
}

export { createPaperAnalysisActions };
