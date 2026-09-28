'use strict';

const fs = require('fs/promises');
const path = require('path');
const { cleanText, ensureObject, keepLatestById, readJsonFile, readRecordFile } = require('../storage-utils');
const { NOTEBOOK_PAGE_FILE_NAME, TEMPLATE_METADATA_FILE_NAME, WORKFLOW_METADATA_FILE_NAME } = require('./constants.js');
const { isPermissionDeniedError } = require('./folder-names.js');

// Workflow/<template folder>/template.json and
// Workflow/<template folder>/<run folder>/workflow.json are the only copy of
// templates and runs; a save removes the record file of a deleted one.
async function readWorkflowFolders(workflowRootPath) {
  const templates = new Map();
  const workflowRows = new Map();
  const warnings = [];
  const result = (exists) => ({
    exists,
    templates: [...templates.values()].map((entry) => entry.value),
    workflowRows: [...workflowRows.values()].map((entry) => entry.value),
    warnings
  });
  const readFolders = async (folderPath) => {
    try {
      return (await fs.readdir(folderPath, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const reason = isPermissionDeniedError(error) ? 'Permission denied reading' : 'Could not read';
        warnings.push(`${reason} workflow folder ${folderPath}: ${String(error?.message || error)}`);
      }
      return null;
    }
  };

  const templateFolders = await readFolders(workflowRootPath);
  if (!templateFolders) {
    return result(false);
  }
  for (const templateFolder of templateFolders) {
    const templateFolderPath = path.join(workflowRootPath, templateFolder.name);
    const template = await readRecordFile(path.join(templateFolderPath, TEMPLATE_METADATA_FILE_NAME), 'template', warnings);
    if (template) {
      keepLatestById(templates, template);
    }
    for (const runFolder of (await readFolders(templateFolderPath)) || []) {
      const run = await readRecordFile(path.join(templateFolderPath, runFolder.name, WORKFLOW_METADATA_FILE_NAME), 'workflow', warnings);
      if (run) {
        keepLatestById(workflowRows, run, { relativeFolderPath: `${templateFolder.name}/${runFolder.name}`, workflow: run.record });
      }
    }
  }
  return result(true);
}

async function readNotebookEntriesForWorkflowFolder(workflowFolderPath) {
  const notebookRoot = path.join(workflowFolderPath, 'Notebook');
  const out = [];
  async function walk(currentPath) {
    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== NOTEBOOK_PAGE_FILE_NAME) {
        continue;
      }
      const payload = await readJsonFile(absPath);
      if (!payload.ok) {
        continue;
      }
      const notebookEntry = ensureObject(payload.data?.notebookEntry);
      const notebookId = cleanText(notebookEntry.id, 220);
      if (!notebookId) {
        continue;
      }
      out.push({
        ...notebookEntry,
        storageFolder: path.dirname(absPath)
      });
    }
  }
  await walk(notebookRoot);
  return out;
}

module.exports = {
  readNotebookEntriesForWorkflowFolder,
  readWorkflowFolders
};
