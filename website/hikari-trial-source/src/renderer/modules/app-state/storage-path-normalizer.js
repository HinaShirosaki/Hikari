import {
  buildNotebookFolderPath,
  isPathInsideRoot,
  joinStoragePath
} from '../../lib/storage-paths.js';

function cleanPath(value) {
  return String(value || '').trim();
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

// Records store paths relative to the storage folder. When the folder moves
// (or a workspace is opened on another machine), rebuild each absolute path
// from the current root: notebook folders outside it are regenerated, file
// records are re-joined from their relativePath. Runs before every persist.
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
