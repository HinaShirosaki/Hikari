'use strict';

const fs = require('fs/promises');
const path = require('path');
const { cleanText, ensureObject } = require('../storage-utils');
const { buildEntryFolderName, buildNotebookPageFolderName } = require('./folder-names.js');

async function ensureFolder(targetPath) {
  if (!targetPath) {
    return;
  }
  await fs.mkdir(targetPath, { recursive: true });
}

async function writeJsonFile(targetPath, payload) {
  await ensureFolder(path.dirname(targetPath));
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  if (parent === child) {
    return true;
  }
  const prefix = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child.startsWith(prefix);
}

function buildNotebookStorageFolder(runLayout, notebookEntry) {
  const entry = ensureObject(notebookEntry);
  const workflowContext = ensureObject(entry.workflowContext);
  if (cleanText(workflowContext.workflowEntryId, 220) || cleanText(workflowContext.workflowBlockId, 220)) {
    return path.join(
      runLayout.notebookFolderPath,
      buildEntryFolderName(
        workflowContext.workflowEntryName || workflowContext.workflowName || entry.protocolName || entry.id,
        workflowContext.workflowEntryId || entry.id
      ),
      buildNotebookPageFolderName(entry.id)
    );
  }

  const existingStorageFolder = cleanText(entry.storageFolder, 2400);
  if (existingStorageFolder && isPathInside(runLayout.workflowFolderPath, existingStorageFolder)) {
    return existingStorageFolder;
  }

  return path.join(
    runLayout.notebookFolderPath,
    buildNotebookPageFolderName(entry.id)
  );
}

function applyWorkflowStorageSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      raw_json TEXT
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      relative_folder_path TEXT,
      raw_json TEXT
    );
  `);
}

module.exports = {
  applyWorkflowStorageSchema,
  buildNotebookStorageFolder,
  ensureFolder,
  writeJsonFile
};
