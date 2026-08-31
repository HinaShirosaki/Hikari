import { showTransientNotice } from '../../../lib/notify.js';
import { collectProtocolPlaceholderKeys } from '../entry/entry-helpers.js';
import {
  normalizeNotebookSampleLink,
  normalizeNotebookSampleLinks
} from '../samples/sample-helpers.js';
import { mergeFilesIntoInput } from '../../../lib/file-drop.js';

// Result-file attachments on a notebook page, the sample-link drafts that ride
// along with them, and the queue that serializes agent appends into Results.
function createNotebookResultFiles({
  elements,
  resultFileAttachmentController,
  getActiveEntry,
  getSampleLinkDrafts,
  setSampleLinkDrafts,
  getPendingDroppedResultFiles,
  setPendingDroppedResultFiles,
  getAgentAppendQueue,
  setAgentAppendQueue,
  runAgentNotebookAppend
} = {}) {
  const { notebookResult, notebookResultFile } = elements;

  function mergeUniqueFiles(files = []) {
    const seen = new Set();
    return (Array.isArray(files) ? files : [])
      .filter(Boolean)
      .filter((file) => {
        const key = [
          String(file?.name || ''),
          Number(file?.size) || 0,
          Number(file?.lastModified) || 0
        ].join('|');
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function getSelectedNotebookResultFiles() {
    return mergeUniqueFiles([
      ...Array.from(notebookResultFile?.files || []),
      ...getPendingDroppedResultFiles()
    ]);
  }

  function clearPendingNotebookResultFiles() {
    setPendingDroppedResultFiles([]);
    if (notebookResultFile) {
      notebookResultFile.value = '';
    }
  }

  function renderResultFileAttachments(entry = getActiveEntry()) {
    void resultFileAttachmentController.render({
      entry,
      pendingFiles: getSelectedNotebookResultFiles()
    });
  }

  function queueNotebookResultFiles(files = []) {
    const incomingFiles = mergeUniqueFiles(Array.isArray(files) ? files : [files]);
    if (!incomingFiles.length) {
      return;
    }
    const mergedFiles = mergeUniqueFiles([
      ...getSelectedNotebookResultFiles(),
      ...incomingFiles
    ]);
    const mergedIntoInput = mergeFilesIntoInput(notebookResultFile, mergedFiles, { append: false });
    setPendingDroppedResultFiles(mergedIntoInput ? [] : mergedFiles);
    renderResultFileAttachments();
    showTransientNotice(
      `${incomingFiles.length} file${incomingFiles.length === 1 ? '' : 's'} ready to attach on save.`
    );
  }

  function seedSampleLinkDrafts(entry) {
    setSampleLinkDrafts(new Map());
    normalizeNotebookSampleLinks(entry?.sampleLinks).forEach((link) => {
      if (link.placeholderKey) {
        getSampleLinkDrafts().set(link.placeholderKey, link);
      }
    });
  }

  function collectNotebookSampleLinks(existingEntry, protocol) {
    const allowedKeys = collectProtocolPlaceholderKeys(protocol);
    const nonPlaceholderLinks = normalizeNotebookSampleLinks(existingEntry?.sampleLinks)
      .filter((link) => !link.placeholderKey);
    const placeholderLinks = Array.from(getSampleLinkDrafts().values())
      .map((link) => normalizeNotebookSampleLink(link))
      .filter((link) => link?.placeholderKey && allowedKeys.has(link.placeholderKey));
    return nonPlaceholderLinks.concat(placeholderLinks);
  }

  function appendNotebookResultLine(line) {
    if (!notebookResult) {
      return;
    }
    const cleanLine = String(line || '').trim();
    if (!cleanLine) {
      return;
    }
    const current = String(notebookResult.value || '').trim();
    notebookResult.value = current ? `${current}\n${cleanLine}` : cleanLine;
  }

  function normalizeNotebookTargetText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function buildAgentAppendText(proposal = {}) {
    const sectionTitle = String(proposal.section_title || proposal.sectionTitle || '').trim();
    const content = String(proposal.content_markdown || proposal.contentMarkdown || '').trim();
    if (!content) {
      return '';
    }
    const sourceLines = (Array.isArray(proposal.sources) ? proposal.sources : [])
      .map((source) => {
        const payload = source && typeof source === 'object' ? source : {};
        const label = String(payload.label || payload.record_id || payload.recordId || payload.url || '').trim();
        const recordId = String(payload.record_id || payload.recordId || '').trim();
        const detail = String(payload.detail || '').trim();
        const url = String(payload.url || '').trim();
        const identity = [label, recordId && recordId !== label ? `record ${recordId}` : ''].filter(Boolean).join(' — ');
        return [identity, detail, url].filter(Boolean).join(' — ');
      })
      .filter(Boolean);
    return [
      sectionTitle ? `## ${sectionTitle}` : '',
      content,
      sourceLines.length ? '### Sources' : '',
      ...sourceLines.map((line) => `- ${line}`)
    ].filter(Boolean).join('\n');
  }

  // Overlapping appends both read notebookResult.value before either writes it,
  // so a double-click duplicates the text and two proposals lose one of the two.
  // Queued, the second run sees the saved agentAppendProposalIds and no-ops.
  function appendAgentNotebookContent(proposal = {}) {
    const result = getAgentAppendQueue().then(() => runAgentNotebookAppend(proposal));
    setAgentAppendQueue(result.catch(() => {}));
    return result;
  }

  return {
    mergeUniqueFiles,
    getSelectedNotebookResultFiles,
    clearPendingNotebookResultFiles,
    renderResultFileAttachments,
    queueNotebookResultFiles,
    seedSampleLinkDrafts,
    collectNotebookSampleLinks,
    appendNotebookResultLine,
    normalizeNotebookTargetText,
    buildAgentAppendText,
    appendAgentNotebookContent
  };
}

export { createNotebookResultFiles };
