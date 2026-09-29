'use strict';

const fs = require('fs/promises');
const path = require('path');
const { cleanText, ensureObject } = require('../storage-utils');
const { buildEntryFolderName, buildNotebookPageFolderName } = require('./folder-names.js');
const { isPathInside } = require('../../lib/path-safety.js');
const { writeFileAtomic } = require('../../lib/shared-json-file.js');

async function ensureFolder(targetPath) {
  if (!targetPath) {
    return;
  }
  await fs.mkdir(targetPath, { recursive: true });
}

async function writeJsonFile(targetPath, payload) {
  await ensureFolder(path.dirname(targetPath));
  await writeFileAtomic(fs, targetPath, JSON.stringify(payload, null, 2));
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

module.exports = {
  buildNotebookStorageFolder,
  ensureFolder,
  writeJsonFile
};
