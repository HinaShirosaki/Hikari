import { notebookPageFolderPath } from '../../shared/storage-layout.mjs';

export function buildNotebookFolderPath({ storagePath, projectName, protocolName, entryId } = {}) {
  const rootPath = String(storagePath || '').trim();
  if (!rootPath) {
    return '';
  }
  return `${rootPath}/${notebookPageFolderPath({ projectName, protocolName, id: entryId })}`;
}

export function normalizeStoragePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
}

export function joinStoragePath(rootPath, relativePath) {
  const root = normalizeStoragePath(rootPath);
  const relative = String(relativePath || '').trim().replace(/\\/g, '/').replace(/^\/+/g, '');
  if (!root || !relative) {
    return '';
  }
  return `${root}/${relative}`;
}

// Compares with a trailing "/" so "/data/root2" is not inside "/data/root".
export function isPathInsideRoot(rootPath, targetPath) {
  const root = normalizeStoragePath(rootPath);
  const target = normalizeStoragePath(targetPath);
  if (!root || !target) {
    return false;
  }
  return target === root || target.startsWith(`${root}/`);
}
