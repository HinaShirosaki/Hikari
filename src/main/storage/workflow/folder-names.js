'use strict';

const path = require('path');
const { asArray, cleanText, ensureObject, sanitizeFolderName } = require('../storage-utils');
const { WORKFLOW_ROOT_FOLDER_NAME, WORKFLOW_STATUS_SQLITE_FILE_NAME } = require('./constants.js');

function isPermissionDeniedError(error) {
  return error?.code === 'EPERM' || error?.code === 'EACCES';
}

function resolveWorkflowStoragePaths(storagePath = '') {
  const resolvedStoragePath = cleanText(storagePath, 2400);
  if (!resolvedStoragePath) {
    return {
      storagePath: '',
      workflowRootPath: '',
      sqlitePath: ''
    };
  }
  const rootPath = path.resolve(resolvedStoragePath);
  const workflowRootPath = path.join(rootPath, WORKFLOW_ROOT_FOLDER_NAME);
  return {
    storagePath: rootPath,
    workflowRootPath,
    sqlitePath: path.join(workflowRootPath, WORKFLOW_STATUS_SQLITE_FILE_NAME)
  };
}

function buildTemplateFolderName(template) {
  const source = ensureObject(template);
  return `${sanitizeFolderName(source.name, 'Untitled_Template')}__${sanitizeFolderName(source.id, 'template')}`;
}

function buildWorkflowFolderName(workflow) {
  const source = ensureObject(workflow);
  return `${sanitizeFolderName(source.name, 'Untitled_Workflow')}__${sanitizeFolderName(source.id, 'workflow')}`;
}

function buildEntryFolderName(entryName = '', entryId = '') {
  return `${sanitizeFolderName(entryName, 'Entry')}__${sanitizeFolderName(entryId, 'entry')}`;
}

function buildNotebookPageFolderName(notebookEntryId = '') {
  return `${sanitizeFolderName('Notebook_Page', 'Notebook_Page')}__${sanitizeFolderName(notebookEntryId, 'page')}`;
}

function buildBlockFolderName(blockName = '', blockId = '') {
  return `${sanitizeFolderName(blockName, 'Step')}__${sanitizeFolderName(blockId, 'step')}`;
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
