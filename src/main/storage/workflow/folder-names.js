'use strict';

const path = require('path');
const { asArray, cleanText, ensureObject } = require('../storage-utils');
const { WORKFLOW_ROOT_FOLDER_NAME } = require('./constants.js');
const {
  workflowBlockFolderName: buildBlockFolderName,
  workflowEntryFolderName: buildEntryFolderName,
  workflowFolderName: buildWorkflowFolderName,
  workflowNotebookPageFolderName: buildNotebookPageFolderName,
  workflowTemplateFolderName: buildTemplateFolderName
} = require('../../../shared/storage-layout.mjs');

function isPermissionDeniedError(error) {
  return error?.code === 'EPERM' || error?.code === 'EACCES';
}

function resolveWorkflowStoragePaths(storagePath = '') {
  const resolvedStoragePath = cleanText(storagePath, 2400);
  if (!resolvedStoragePath) {
    return {
      storagePath: '',
      workflowRootPath: ''
    };
  }
  const rootPath = path.resolve(resolvedStoragePath);
  return {
    storagePath: rootPath,
    workflowRootPath: path.join(rootPath, WORKFLOW_ROOT_FOLDER_NAME)
  };
}

function buildWorkflowFolderLayout({ storagePath, template, workflow }) {
  const rootPaths = resolveWorkflowStoragePaths(storagePath);
  if (!rootPaths.workflowRootPath) {
    return {
      ...rootPaths,
      templateFolderPath: '',
      workflowFolderPath: '',
      resultsFolderPath: '',
      notebookFolderPath: '',
      relatedPapersFolderPath: '',
      relativeFolderPath: ''
    };
  }

  const templateFolderName = buildTemplateFolderName(template);
  const workflowFolderName = buildWorkflowFolderName(workflow);
  const templateFolderPath = path.join(rootPaths.workflowRootPath, templateFolderName);
  const workflowFolderPath = path.join(templateFolderPath, workflowFolderName);
  return {
    ...rootPaths,
    templateFolderPath,
    workflowFolderPath,
    resultsFolderPath: path.join(workflowFolderPath, 'Results'),
    notebookFolderPath: path.join(workflowFolderPath, 'Notebook'),
    relatedPapersFolderPath: path.join(workflowFolderPath, 'RelatedPapers'),
    relativeFolderPath: [templateFolderName, workflowFolderName].join('/')
  };
}

function collectLinkedNotebookIds(workflow) {
  const source = ensureObject(workflow);
  const ids = new Set();
  asArray(source.notebookEntryIds).forEach((id) => {
    const normalized = cleanText(id, 220);
    if (normalized) {
      ids.add(normalized);
    }
  });
  asArray(source.entries).forEach((entry) => {
    const stepStates = entry && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
      ? entry.stepStates
      : {};
    Object.values(stepStates).forEach((rawStepState) => {
      const notebookEntryId = cleanText(rawStepState?.notebookEntryId, 220);
      if (notebookEntryId) {
        ids.add(notebookEntryId);
      }
    });
  });
  return [...ids];
}

module.exports = {
  buildBlockFolderName,
  buildEntryFolderName,
  buildNotebookPageFolderName,
  buildTemplateFolderName,
  buildWorkflowFolderLayout,
  buildWorkflowFolderName,
  collectLinkedNotebookIds,
  isPermissionDeniedError,
  resolveWorkflowStoragePaths
};
