import { buildNotebookFolderPath } from './biology-notebook/entry-helpers.js';

function cleanPath(value) {
  return String(value || '').trim();
}

function normalizePath(value) {
  return cleanPath(value).replace(/\\/g, '/').replace(/\/+$/g, '');
}

function joinStoragePath(rootPath, relativePath) {
  const root = normalizePath(rootPath);
  const relative = cleanPath(relativePath).replace(/\\/g, '/').replace(/^\/+/g, '');
  if (!root || !relative) {
    return '';
  }
  return `${root}/${relative}`;
}

function isPathInsideRoot(rootPath, targetPath) {
  const root = normalizePath(rootPath);
  const target = normalizePath(targetPath);
  if (!root || !target) {
    return false;
  }
  return target === root || target.startsWith(`${root}/`);
}

function normalizeFileRecordPath(record, storagePath) {
  if (!record || typeof record !== 'object') {
    return record;
  }
  const relativePath = cleanPath(record.relativePath);
  const currentPath = cleanPath(record.path);
  if (!relativePath) {
    return record;
  }
  const nextPath = joinStoragePath(storagePath, relativePath);
  if (!nextPath || currentPath === nextPath) {
    return record;
  }
  return {
    ...record,
    path: nextPath
  };
}

function normalizeNotebookEntryStorage(entry, storagePath) {
  if (!entry || typeof entry !== 'object') {
    return entry;
  }
  const nextEntry = { ...entry };
  if (!isPathInsideRoot(storagePath, nextEntry.storageFolder)) {
    nextEntry.storageFolder = buildNotebookFolderPath({
      storagePath,
      projectName: nextEntry.projectName,
      protocolName: nextEntry.protocolName || nextEntry.experimentName,
      entryId: nextEntry.id
    });
  }
  if (Array.isArray(nextEntry.resultFileRecords)) {
    nextEntry.resultFileRecords = nextEntry.resultFileRecords.map((record) => (
      normalizeFileRecordPath(record, storagePath)
    ));
  }
  return nextEntry;
}

export function normalizeStateStoragePaths(state) {
  const storagePath = cleanPath(state?.settings?.storagePath);
  if (!state || typeof state !== 'object' || !storagePath) {
    return state;
  }
  if (Array.isArray(state.notebookEntries)) {
    state.notebookEntries = state.notebookEntries.map((entry) => (
      normalizeNotebookEntryStorage(entry, storagePath)
    ));
  }
  return state;
}

export { isPathInsideRoot };
