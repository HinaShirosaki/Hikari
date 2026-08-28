'use strict';

const { asArray, cleanText, ensureObject } = require('../storage-utils');

function normalizeStepStatus(stepState) {
  const source = ensureObject(stepState);
  const status = cleanText(source.status, 40).toLowerCase();
  if (status === 'completed' || status === 'failed' || status === 'pending') {
    return status;
  }
  return 'not_done';
}

function normalizePortableFileRecord(record) {
  const source = ensureObject(record);
  const name = cleanText(source.name, 320);
  if (!name) {
    return null;
  }
  return {
    name,
    path: '',
    relativePath: cleanText(source.relativePath, 2000),
    size: Number(source.size) || 0,
    importedAt: cleanText(source.importedAt, 80)
  };
}

function compactNotebookEntry(entry) {
  const source = ensureObject(entry);
  const resultFileRecords = asArray(source.resultFileRecords)
    .map((record) => normalizePortableFileRecord(record))
    .filter(Boolean);
  return {
    ...source,
    storageFolder: '',
    resultFileRecords,
    resultFiles: resultFileRecords.length
      ? resultFileRecords.map((record) => record.name)
      : asArray(source.resultFiles).map((item) => cleanText(item, 320)).filter(Boolean)
  };
}

function compactWorkflowRecord(workflow) {
  const source = ensureObject(workflow);
  return {
    ...source,
    entries: asArray(source.entries).map((entry) => {
      const normalizedEntry = {
        ...ensureObject(entry),
        stepStates: {}
      };
      const stepStates = entry && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
        ? entry.stepStates
        : {};
      Object.entries(stepStates).forEach(([blockId, rawStepState]) => {
        const stepState = ensureObject(rawStepState);
        const resultFileRecords = asArray(stepState.resultFileRecords)
          .map((record) => normalizePortableFileRecord(record))
          .filter(Boolean);
        normalizedEntry.stepStates[blockId] = {
          ...stepState,
          resultFileRecords,
          resultFiles: resultFileRecords.length
            ? resultFileRecords.map((record) => record.name)
            : asArray(stepState.resultFiles).map((item) => cleanText(item, 320)).filter(Boolean)
        };
      });
      return normalizedEntry;
    })
  };
}

function compactPaperRecord(paper) {
  const source = ensureObject(paper);
  const compact = {
    ...source,
    pdfDataUrl: '',
    storedFilePath: ''
  };
  if (!cleanText(compact.storedRelativePath, 2000) && cleanText(source.storedFilePath, 2400)) {
    compact.storedRelativePath = '';
  }
  return compact;
}

function collectWorkflowSummary(workflow) {
  const source = ensureObject(workflow);
  const blocks = asArray(source.blocks);
  const entries = asArray(source.entries);
  let totalSteps = 0;
  let completedSteps = 0;
  let failedSteps = 0;
  let pendingSteps = 0;
  let resultFileCount = 0;
  let linkedNotebookCount = 0;
  const linkedNotebookIds = new Set();

  if (!entries.length) {
    totalSteps = blocks.length;
  }

  entries.forEach((entry) => {
    const stepStates = entry && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
      ? entry.stepStates
      : {};
    blocks.forEach((block) => {
      totalSteps += 1;
      const stepState = ensureObject(stepStates[block?.id]);
      const status = normalizeStepStatus(stepState);
      if (status === 'completed') {
        completedSteps += 1;
      } else if (status === 'failed') {
        failedSteps += 1;
      } else if (status === 'pending') {
        pendingSteps += 1;
      }
      const notebookEntryId = cleanText(stepState.notebookEntryId, 220);
      if (notebookEntryId) {
        linkedNotebookIds.add(notebookEntryId);
      }
      resultFileCount += asArray(stepState.resultFileRecords).length || asArray(stepState.resultFiles).length;
    });
  });

  linkedNotebookCount = linkedNotebookIds.size;
  const percentComplete = totalSteps
    ? Math.round((completedSteps / totalSteps) * 100)
    : 0;
  const overallStatus = totalSteps && completedSteps === totalSteps
    ? 'completed'
    : (failedSteps > 0
      ? 'failed'
      : ((pendingSteps > 0 || completedSteps > 0) ? 'pending' : 'not_done'));

  return {
    overallStatus,
    totalSteps,
    completedSteps,
    failedSteps,
    pendingSteps,
    percentComplete,
    resultFileCount,
    linkedNotebookCount
  };
}

function collectRelatedPaperData(snapshot, workflow, notebookIds = []) {
  const safeSnapshot = ensureObject(snapshot);
  const workflowRecord = ensureObject(workflow);
  const notebookIdSet = new Set(asArray(notebookIds).map((id) => cleanText(id, 220)).filter(Boolean));
  const paperIds = new Set();

  asArray(safeSnapshot.papers).forEach((paper) => {
    const normalized = ensureObject(paper);
    if (
      cleanText(normalized.linkedType, 60).toLowerCase() === 'project'
      && cleanText(normalized.linkedId, 220) === cleanText(workflowRecord.projectId, 220)
    ) {
      const paperId = cleanText(normalized.id, 220);
      if (paperId) {
        paperIds.add(paperId);
      }
    }
  });

  const links = asArray(safeSnapshot.paperExperimentLinks).filter((rawLink) => {
    const link = ensureObject(rawLink);
    const paperId = cleanText(link.paperId, 220);
    const entryId = cleanText(link.entryId, 220);
    const projectId = cleanText(link.projectId, 220);
    const matchesNotebook = entryId && notebookIdSet.has(entryId);
    const matchesProject = projectId && projectId === cleanText(workflowRecord.projectId, 220);
    if ((matchesNotebook || matchesProject) && paperId) {
      paperIds.add(paperId);
      return true;
    }
    return false;
  }).map((rawLink) => ({ ...ensureObject(rawLink) }));

  const papers = asArray(safeSnapshot.papers)
    .filter((paper) => paperIds.has(cleanText(paper?.id, 220)))
    .map((paper) => compactPaperRecord(paper));

  return {
    papers,
    paperExperimentLinks: links
  };
}

function resolveWorkflowTemplateRecord(templateById, workflow) {
  const workflowRecord = ensureObject(workflow);
  const templateId = cleanText(workflowRecord.templateId, 220);
  if (templateId && templateById.has(templateId)) {
    return ensureObject(templateById.get(templateId));
  }
  return {
    id: templateId || 'untemplated',
    name: 'Untemplated Workflow',
    description: ''
  };
}

module.exports = {
  collectRelatedPaperData,
  collectWorkflowSummary,
  compactNotebookEntry,
  compactWorkflowRecord,
  resolveWorkflowTemplateRecord
};
